use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn resource_dir() -> PathBuf {
    APP_RESOURCE_DIR.get().cloned().unwrap_or_default()
}

// ── Session registry ────────────────────────────────────────────────────────

pub struct Shared {
    attached: AtomicBool,
    /// Output produced before the renderer attaches (preheat replay).
    buffer: Mutex<ReplayBuffer>,
    app: Option<AppHandle>,
    /// Inline-image rows the shell still needs to compensate for (ConPTY
    /// cursor repair). Credited at image-terminator time; claimed by the
    /// shell-integration prompt hook via take_image_rows().
    image_rows: AtomicU32,
    /// True while an IIP image is mid-stream — lets the hook endpoint tell the
    /// shell to retry shortly instead of consuming a partial row count.
    image_pending: AtomicBool,
}

/// Pre-attach output buffer with a running byte total — push/pop are O(1)
/// instead of re-summing every chunk on each push.
#[derive(Default)]
struct ReplayBuffer {
    chunks: std::collections::VecDeque<String>,
    total: usize,
}

pub struct Session {
    pid: u32,
    cwd: Option<String>,
    shell: Option<String>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    shared: Arc<Shared>,
}

static SESSIONS: LazyLock<RwLock<HashMap<String, Arc<Session>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

// Per-id spawn guards: serialize the check-then-spawn sequence in create() and
// warm() for the SAME id only. Startup warming runs on a background thread, so
// without this a renderer create() and a warm() for the same id could both
// pass the map check and spawn two PTYs — the loser leaks and duplicates
// output onto the shared event channel. Unrelated ids spawn concurrently.
static SPAWNING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

struct SpawnGuard(String);

impl Drop for SpawnGuard {
    fn drop(&mut self) {
        SPAWNING.lock().unwrap().remove(&self.0);
    }
}

fn try_begin_spawn(id: &str) -> Option<SpawnGuard> {
    let mut set = SPAWNING.lock().unwrap();
    if set.insert(id.to_string()) {
        Some(SpawnGuard(id.to_string()))
    } else {
        None
    }
}

fn begin_spawn(id: &str) -> SpawnGuard {
    loop {
        if let Some(guard) = try_begin_spawn(id) {
            return guard;
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub(crate) fn emit(app: &Option<AppHandle>, event: &str, payload: impl serde::Serialize + Clone) {
    if let Some(app) = app {
        if let Err(e) = app.emit(event, payload) {
            eprintln!("[pty] emit {event} failed: {e}");
        }
    }
}

// ── Shell resolution ────────────────────────────────────────────────────────

fn shell_paths(name: &str) -> Option<&'static str> {
    match name {
        "powershell" => Some(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
        "cmd" => Some(r"C:\Windows\System32\cmd.exe"),
        "wsl" => Some(r"C:\Windows\System32\wsl.exe"),
        _ => None,
    }
}

// Same probe-once policy as find_pwsh. Git Bash has no fixed install root —
// where.exe finds git.exe wherever it is, and bash.exe lives next to it.
fn find_gitbash() -> Option<PathBuf> {
    static GITBASH: OnceLock<Option<PathBuf>> = OnceLock::new();
    GITBASH
        .get_or_init(|| {
            if let Ok(out) = Command::new("where.exe").arg("git").creation_flags(0x08000000).output() {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    // ...\Git\cmd\git.exe → ...\Git\bin\bash.exe
                    if let Some(git) = stdout.lines().next().map(str::trim) {
                        let bash = PathBuf::from(git)
                            .parent()
                            .and_then(Path::parent)
                            .map(|root| root.join("bin").join("bash.exe"));
                        if let Some(b) = bash.filter(|p| p.exists()) {
                            return Some(b);
                        }
                    }
                }
            }
            let local = std::env::var("LOCALAPPDATA")
                .ok()
                .map(|l| PathBuf::from(l).join(r"Programs\Git\bin\bash.exe"));
            [local, None]
                .into_iter()
                .flatten()
                .chain([
                    PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
                    PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
                ])
                .find(|p| p.exists())
        })
        .clone()
}

// ponytail: the TS version re-probed when the cached path vanished (pwsh
// uninstalled mid-session); we probe once per process.
fn find_pwsh() -> Option<PathBuf> {
    static PWSH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PWSH.get_or_init(|| {
        let out = Command::new("where.exe").arg("pwsh").creation_flags(0x08000000).output().ok()?;
        if !out.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        let first = stdout.lines().next()?.trim();
        let path = PathBuf::from(first);
        path.exists().then_some(path)
    })
    .clone()
}

fn detect_default_shell() -> String {
    find_pwsh()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| shell_paths("powershell").unwrap().to_string())
}

pub fn shell_path(shell_name: Option<&str>) -> String {
    let Some(name) = shell_name else {
        return detect_default_shell();
    };
    let key = name.to_lowercase();
    if key == "pwsh" {
        return find_pwsh()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(detect_default_shell);
    }
    if key == "gitbash" {
        return find_gitbash()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(detect_default_shell);
    }
    if let Some(path) = shell_paths(&key) {
        if Path::new(path).exists() {
            return path.to_string();
        }
    }
    detect_default_shell()
}

fn script_path(file_name: &str) -> PathBuf {
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("shell-integration")
        .join(file_name);
    if dev.exists() {
        return dev;
    }
    let base = APP_RESOURCE_DIR
        .get()
        .cloned()
        .unwrap_or_default();
    base.join("scripts").join("shell-integration").join(file_name)
}

static APP_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_resource_dir(app: &AppHandle) {
    if let Ok(dir) = app.path().resource_dir() {
        let _ = APP_RESOURCE_DIR.set(dir);
    }
}

pub fn shell_spawn_args(shell_path: &str) -> Vec<String> {
    let stem = Path::new(shell_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // Shell integration loaded via -Command so it runs after $PROFILE.
    if stem.starts_with("pwsh") || stem.starts_with("powershell") {
        let script = script_path("pwsh.ps1");
        return vec![
            "-NoLogo".into(),
            "-NoExit".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            format!(". '{}'", script.display()),
        ];
    }
    if stem == "cmd" {
        return vec!["/k".into(), script_path("cmd-prompt.cmd").to_string_lossy().into_owned()];
    }
    // gitbash / wsl / other — no injection, same as before.
    Vec::new()
}

// ── UTF-8 incremental decoding ──────────────────────────────────────────────
// node-pty handed us JS strings; portable-pty gives raw bytes. ConPTY output
// can split a multi-byte sequence across reads, so carry the incomplete tail.

pub fn decode(carry: &mut Vec<u8>, chunk: &[u8]) -> String {
    carry.extend_from_slice(chunk);
    let mut out = String::new();
    loop {
        match std::str::from_utf8(carry) {
            Ok(s) => {
                out.push_str(s);
                carry.clear();
                break;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                out.push_str(std::str::from_utf8(&carry[..valid]).expect("valid_up_to"));
                match e.error_len() {
                    Some(len) => {
                        out.push('\u{FFFD}');
                        carry.drain(..valid + len);
                    }
                    None => {
                        // Incomplete trailing sequence — wait for more bytes.
                        carry.drain(..valid);
                        break;
                    }
                }
            }
        }
    }
    out
}

// ── ConPTY startup DSR handshake ────────────────────────────────────────────
// ConPTY opens every session with a cursor-position query (ESC[6n) and stalls
// until the terminal answers. node-pty answers this itself
// (conptyInheritCursor:false); portable-pty passes it through, where it can be
// emitted before the renderer subscribes and get lost — leaving the shell
// stuck forever. Answer it here instead and strip it from the stream,
// reporting a fresh-terminal cursor at 1;1.

pub enum DsrState {
    /// Candidate prefix of the query seen so far.
    Pending(String),
    Done,
}

const DSR_QUERY: &str = "\x1b[6n";
const DSR_REPLY: &[u8] = b"\x1b[1;1R";

/// Returns the text to forward (None = hold for the next chunk) and whether to
/// send the reply. Only inspects the stream start: a chunk that isn't a prefix
/// of the query ends interception.
pub fn dsr_filter(state: &mut DsrState, text: &str) -> (Option<String>, bool) {
    let DsrState::Pending(holdback) = state else {
        return (Some(text.to_string()), false);
    };
    let combined = std::mem::take(holdback) + text;
    if let Some(rest) = combined.strip_prefix(DSR_QUERY) {
        *state = DsrState::Done;
        let rest = rest.to_string();
        return ((!rest.is_empty()).then_some(rest), true);
    }
    if DSR_QUERY.starts_with(&combined) {
        *state = DsrState::Pending(combined);
        return (None, false);
    }
    *state = DsrState::Done;
    (Some(combined), false)
}

// ── Inline-image row tracking (ConPTY cursor repair) ───────────────────────
//
// OSC 1337 (iTerm2 inline image) passes through ConPTY without touching the
// console's cursor model: conhost never advances past the image, while
// xterm.js's ImageAddon advances its own cursor by the image's row count. The
// next absolute-positioned output (e.g. PSReadLine's input redraw) then lands
// inside the image. The shell integration claims the owed row count at every
// prompt via the hook endpoint and repairs conhost's cursor with an absolute
// SetConsoleCursorPosition; we supply the row count by scanning the PTY
// output stream for IIP headers here.
//
// Counting rules:
// - only cell-valued `height=N` fields (chafa always sends cells); `px`/`auto`/
//   `%` heights are skipped — we can't map them to rows without cell metrics.
// - rows are credited only when the image's terminator (BEL or ST) is seen, so
//   a querying shell never acts on a half-streamed image; `pending` tells it
//   to retry instead.
// - alt-screen output (fullscreen TUIs like yazi, which manage their own
//   layout) is not counted.
//
// 已知限制与后续方向（2026-09 上线时记录）：
// - 动图/监控类输出（chafa --watch、GIF 动画）：每一帧都算一次图像行，
//   行数会持续累积；传送门在命令结束后的首个 prompt 一次结清并 clamp 到
//   buffer 底部。静态图是正确路径；动图如需支持，应先在前端限制为静态帧
//   或按帧去重，再谈光标补偿。
// - 根治不在我们手里：conhost 侧认图像行才是任意裸跑工具都对的前提。
//   实测 in-box conhost 会吃掉 sixel DCS（不透传也不出图），sixel 路线已死；
//   剩下两条是自带 patched OpenConsole（ConPTY 握手是个真项目）或推
//   microsoft/terminal 上游（sixel 的 cursor tracking 是现成先例）。
// - chafa 在 Windows 从不等待探测回复，单元格像素恒为 10×20 回退值，
//   烘焙分辨率 = 列数×10。默认字号下相对显示尺寸是降采样（清晰）；
//   字号调很大时会变升采样发虚——属 chafa 上游限制，不绕道修。

const IIP_MARKER: &[u8] = b"\x1b]1337;File=";
const ALT_ENTER: &[u8] = b"\x1b[?1049h";
const ALT_LEAVE: &[u8] = b"\x1b[?1049l";
const ALT_ENTER_47: &[u8] = b"\x1b[?1047h";
const ALT_LEAVE_47: &[u8] = b"\x1b[?1047l";
const NEEDLES: [&[u8]; 5] = [IIP_MARKER, ALT_ENTER, ALT_LEAVE, ALT_ENTER_47, ALT_LEAVE_47];
const MAX_NEEDLE_LEN: usize = 12; // IIP_MARKER.len()
const IIP_HEADER_LIMIT: usize = 1024;

#[derive(Default, PartialEq, Clone, Copy)]
enum ImageScanState {
    #[default]
    Idle,
    Header,
    Payload,
}

/// Longest suffix of `tail` that is a prefix of any needle (0 = none). Lets us
/// hold a split `\x1b]1337;File=` / `\x1b[?1049h` across chunk boundaries.
fn needle_prefix_len(tail: &[u8]) -> usize {
    let max = (MAX_NEEDLE_LEN - 1).min(tail.len());
    for len in (1..=max).rev() {
        let suffix = &tail[tail.len() - len..];
        if NEEDLES.iter().any(|n| n.starts_with(suffix)) {
            return len;
        }
    }
    0
}

#[derive(Default)]
struct ImageRowTracker {
    state: ImageScanState,
    /// Header bytes accumulated between the marker and its terminating ':'.
    header: Vec<u8>,
    /// Held bytes that may be a needle prefix split across chunks (always
    /// ASCII escape-sequence prefixes, so String is lossless).
    carry: String,
    alt_screen: bool,
    /// Parsed height of the in-flight image (0 = skip / not counted).
    pending_rows: u32,
}

impl ImageRowTracker {
    /// True while an IIP image is mid-stream (header or payload incomplete) —
    /// the hook endpoint uses it to tell the shell to retry instead of acting
    /// on a partial row count.
    fn is_pending(&self) -> bool {
        self.state != ImageScanState::Idle
    }

    /// Feed one decoded output chunk; returns rows credited by this chunk.
    /// Rows are credited only at the image terminator, and only outside the
    /// alt screen.
    fn feed(&mut self, text: &str) -> u32 {
        // Fast path: base64 image payloads contain no ESC, so the bulk of an
        // image stream skips scanning entirely.
        if self.state == ImageScanState::Idle && self.carry.is_empty() && !text.contains('\x1b') {
            return 0;
        }
        let mut combined = std::mem::take(&mut self.carry);
        combined.push_str(text);
        let bytes = combined.as_bytes();
        let mut i = 0usize;
        let mut credited = 0u32;
        let mut hold_from: Option<usize> = None;

        while i < bytes.len() {
            match self.state {
                ImageScanState::Idle => {
                    let Some(rel) = bytes[i..].iter().position(|&b| b == 0x1b) else {
                        break;
                    };
                    let p = i + rel;
                    let mut matched = false;
                    for needle in NEEDLES {
                        if bytes.len() - p >= needle.len() && &bytes[p..p + needle.len()] == needle {
                            matched = true;
                            if needle == IIP_MARKER {
                                self.state = ImageScanState::Header;
                                self.header.clear();
                            } else {
                                self.alt_screen = needle == ALT_ENTER || needle == ALT_ENTER_47;
                            }
                            i = p + needle.len();
                            break;
                        }
                    }
                    if !matched {
                        if needle_prefix_len(&bytes[p..]) > 0 && p + MAX_NEEDLE_LEN > bytes.len() {
                            hold_from = Some(p); // possible needle split across chunks
                            break;
                        }
                        i = p + 1;
                    }
                }
                ImageScanState::Header => {
                    let Some(rel) = bytes[i..].iter().position(|&b| b == b':') else {
                        self.header.extend_from_slice(&bytes[i..]);
                        if self.header.len() > IIP_HEADER_LIMIT {
                            self.state = ImageScanState::Idle; // malformed; drop
                        }
                        break;
                    };
                    let colon = i + rel;
                    self.header.extend_from_slice(&bytes[i..colon]);
                    self.pending_rows = parse_iip_cell_height(&self.header);
                    self.state = ImageScanState::Payload;
                    i = colon + 1;
                }
                ImageScanState::Payload => {
                    // base64 contains neither BEL nor ESC, so the first BEL or
                    // ESC\ after the payload is the image terminator.
                    let bel = bytes[i..].iter().position(|&b| b == 0x07).map(|r| i + r);
                    let st = bytes[i..]
                        .windows(2)
                        .position(|w| w == b"\x1b\\")
                        .map(|r| i + r);
                    // An ESC as the final byte may be half of a split ST.
                    let esc_tail = bytes.last() == Some(&0x1b);
                    match (bel, st) {
                        (None, None) => {
                            if esc_tail {
                                hold_from = Some(bytes.len() - 1);
                            }
                            i = bytes.len();
                        }
                        _ => {
                            let (t, tlen) = match (bel, st) {
                                (Some(b), Some(s)) => {
                                    if b < s { (b, 1) } else { (s, 2) }
                                }
                                (Some(b), None) => (b, 1),
                                (None, Some(s)) => (s, 2),
                                _ => unreachable!(),
                            };
                            if !self.alt_screen {
                                credited += self.pending_rows;
                            }
                            self.pending_rows = 0;
                            self.state = ImageScanState::Idle;
                            i = t + tlen;
                        }
                    }
                }
            }
        }

        self.carry = match hold_from {
            // hold_from is always at an ASCII ESC byte, so slicing is safe
            Some(p) => combined[p..].to_string(),
            None => String::new(),
        };
        credited
    }
}

/// Parse `height=N` from an IIP header; returns 0 (skip) for px/auto/percent
/// heights or a missing field — only cell counts map to terminal rows.
fn parse_iip_cell_height(header: &[u8]) -> u32 {
    let header = String::from_utf8_lossy(header);
    let Some(pos) = header.find("height=") else {
        return 0;
    };
    let rest = &header[pos + "height=".len()..];
    let digits: usize = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
    if digits == 0 {
        return 0;
    }
    // A bare number is a cell count only when the field ends right after the
    // digits (`;` or header end); a suffix like `px`/`%` disqualifies it.
    match rest.as_bytes()[digits..].first() {
        None | Some(b';') => {}
        _ => return 0,
    }
    rest[..digits].parse().unwrap_or(0)
}

/// Shell-integration hook support: (rows, pending) for the pane's
/// uncompensated inline-image rows. The counter is cleared only when no image
/// is mid-stream — while pending, the count is still growing and the shell
/// retries instead of consuming a partial count.
pub fn take_image_rows(id: &str) -> Option<(u32, bool)> {
    let session = SESSIONS.read().unwrap().get(id).cloned()?;
    let shared = &session.shared;
    let pending = shared.image_pending.load(Ordering::Relaxed);
    let rows = if pending {
        shared.image_rows.load(Ordering::Relaxed)
    } else {
        shared.image_rows.swap(0, Ordering::Relaxed)
    };
    Some((rows, pending))
}

// ── Reader / waiter threads ─────────────────────────────────────────────────

fn reader_loop(id: String, session: Arc<Session>, mut reader: Box<dyn Read + Send>) {
    let shared = session.shared.clone();
    let mut carry: Vec<u8> = Vec::new();
    let mut dsr = DsrState::Pending(String::new());
    let mut image_tracker = ImageRowTracker::default();
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let text = decode(&mut carry, &buf[..n]);
                if text.is_empty() {
                    continue;
                }
                let credited = image_tracker.feed(&text);
                if credited > 0 {
                    session.shared.image_rows.fetch_add(credited, Ordering::Relaxed);
                }
                session.shared.image_pending.store(image_tracker.is_pending(), Ordering::Relaxed);
                let (forward, reply) = dsr_filter(&mut dsr, &text);
                if reply {
                    let mut writer = session.writer.lock().unwrap();
                    let _ = writer.write_all(DSR_REPLY);
                    let _ = writer.flush();
                }
                let Some(text) = forward else { continue };
                if text.is_empty() {
                    continue;
                }
                if shared.attached.load(Ordering::Relaxed) {
                    emit(&shared.app, &format!("pty:data:{id}"), text);
                } else {
                    buffer_push(&shared, text);
                }
            }
            Err(_) => break,
        }
    }
}

fn wait_loop(id: String, child: Arc<Mutex<Box<dyn Child + Send + Sync>>>) {
    let code = loop {
        {
            let mut child = child.lock().unwrap();
            match child.try_wait() {
                Ok(Some(status)) => break i64::from(status.exit_code()),
                Ok(None) => {}
                // A wait error is not a clean exit — report -1 so the
                // renderer's auto-retry path treats it as a failure, not as
                // "exited 0".
                Err(_) => break -1,
            }
        }
        thread::sleep(Duration::from_millis(150));
    };

    // Only the session still registered under this id may report its exit —
    // a replaced pty must not delete its successor or emit a stale event.
    let app = {
        let mut map = SESSIONS.write().unwrap();
        let Some(session) = map.get(&id) else { return };
        if !Arc::ptr_eq(&session.child, &child) {
            return;
        }
        let session = map.remove(&id).unwrap();
        session.shared.app.clone()
    };
    crate::hooks::remove_pane(&id);
    emit(&app, &format!("pty:exit:{id}"), code);
}

// ── Spawn ───────────────────────────────────────────────────────────────────

/// Empty strings and directories deleted since the state was saved mean "no
/// opinion" — normalize to None so they hit the home fallback instead of
/// leaking into ConPTY as Some("") (renderer sessions persist cwd: '').
fn normalize_cwd(cwd: Option<&str>) -> Option<&str> {
    cwd.filter(|c| !c.is_empty() && Path::new(c).is_dir())
}

fn spawn_inner(
    app: Option<&AppHandle>,
    id: &str,
    cwd: Option<&str>,
    shell: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
    attached: bool,
) -> Result<u32, String> {
    let shell_path = shell_path(shell);
    let cwd = normalize_cwd(cwd);
    let working_dir = cwd
        .map(String::from)
        .or_else(|| std::env::var("USERPROFILE").ok())
        .unwrap_or_else(|| r"C:\Users".to_string());

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.args(shell_spawn_args(&shell_path));
    cmd.cwd(&working_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "vscode");
    // chafa 1.18's term-db has no entry for TERM_PROGRAM=vscode, so without this
    // it renders images as cell-resolution block symbols (what users perceive as
    // "blurry"). LC_TERMINAL=iTerm2 matches chafa's iTerm2 rule → chafa emits
    // IIP pixel graphics (TIFF payload, transcoded to PNG by iipStreamPatcher).
    // yazi likewise treats LC_TERMINAL=iTerm2 as IIP-capable, so its behavior
    // is unchanged.
    cmd.env("LC_TERMINAL", "iTerm2");
    // Only inject the hook channel when the hook server actually started —
    // otherwise every shell would pointlessly POST to port 0 (and a stale
    // PATTY_PORT from the environment could hit an unrelated listener).
    let hook_port = crate::hooks::hook_port();
    if hook_port != 0 {
        cmd.env("PATTY_PANE_ID", id);
        cmd.env("PATTY_PORT", hook_port.to_string());
        cmd.env("PATTY_HOOK_SECRET", crate::hooks::hook_secret());
    }
    let xdg = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok().map(|u| format!(r"{u}\.config")));
    if let Some(xdg) = xdg {
        cmd.env("XDG_CONFIG_HOME", xdg);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let pid = child.process_id().unwrap_or(0);
    let child = Arc::new(Mutex::new(child));
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let shared = Arc::new(Shared {
        attached: AtomicBool::new(attached),
        buffer: Mutex::new(ReplayBuffer::default()),
        app: app.cloned(),
        image_rows: AtomicU32::new(0),
        image_pending: AtomicBool::new(false),
    });

    let session = Arc::new(Session {
        pid,
        cwd: cwd.map(String::from),
        shell: shell.map(String::from),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        child: child.clone(),
        shared: shared.clone(),
    });
    SESSIONS.write().unwrap().insert(id.to_string(), session.clone());

    let reader_id = id.to_string();
    let reader_session = session.clone();
    thread::spawn(move || reader_loop(reader_id, reader_session, reader));

    let wait_id = id.to_string();
    thread::spawn(move || wait_loop(wait_id, child));

    Ok(pid)
}

fn take_buffer(shared: &Shared) -> Option<String> {
    let buf = std::mem::take(&mut *shared.buffer.lock().unwrap());
    if buf.chunks.is_empty() {
        None
    } else {
        Some(buf.chunks.into_iter().collect())
    }
}

/// Cap on total bytes buffered while a preheated session is unattached.
/// Output past the cap drops oldest-chunks-first: the replay only needs the
/// tail, and a chatty preheat must not grow without bound.
const PREHEAT_BUFFER_CAP: usize = 256 * 1024;

/// Buffer pre-attach output for replay, dropping oldest chunks once the cap
/// is exceeded. At least one chunk is always kept (a single oversized read
/// still replays).
fn buffer_push(shared: &Shared, text: String) {
    let mut buf = shared.buffer.lock().unwrap();
    buf.total += text.len();
    buf.chunks.push_back(text);
    while buf.total > PREHEAT_BUFFER_CAP && buf.chunks.len() > 1 {
        if let Some(front) = buf.chunks.pop_front() {
            buf.total -= front.len();
        }
    }
}

// ── Public API (called from commands) ───────────────────────────────────────

pub fn create(
    app: &AppHandle,
    id: &str,
    cwd: Option<&str>,
    shell: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Value {
    let _spawn_guard = begin_spawn(id);
    let cwd = normalize_cwd(cwd);
    // Reattach to a preheated session when cwd/shell match.
    let mut map = SESSIONS.write().unwrap();
    if let Some(existing) = map.get(id) {
        let matches = existing.cwd.as_deref() == cwd
            && existing.shell.as_deref() == shell;
        if !existing.shared.attached.load(Ordering::Relaxed) && matches {
            existing.shared.attached.store(true, Ordering::Relaxed);
            let replay = take_buffer(&existing.shared);
            let _ = existing.master.lock().unwrap().resize(PtySize {
                rows: rows.unwrap_or(24),
                cols: cols.unwrap_or(80),
                pixel_width: 0,
                pixel_height: 0,
            });
            return json!({ "pid": existing.pid, "success": true, "replay": replay });
        }
        // Mismatched preheat or a reused id: kill the old process so it can't
        // leak or deliver duplicate output.
        let victim = map.remove(id).unwrap();
        let _ = victim.child.lock().unwrap().kill();
    }
    drop(map);

    match spawn_inner(Some(app), id, cwd, shell, cols, rows, true) {
        Ok(pid) => json!({ "pid": pid, "success": true, "replay": Value::Null }),
        Err(e) => {
            eprintln!("[pty] create failed for {id}: {e}");
            json!({ "pid": 0, "success": false, "error": e })
        }
    }
}

/// Pre-spawn a PTY for a session expected to mount soon; early output is
/// buffered and replayed on attach.
pub fn warm(app: &AppHandle, id: &str, cwd: Option<&str>, shell: Option<&str>) {
    // A spawn for this id is already in flight — this warm is redundant.
    let Some(_spawn_guard) = try_begin_spawn(id) else {
        return;
    };
    let cwd = normalize_cwd(cwd);
    if SESSIONS.read().unwrap().contains_key(id) {
        return;
    }
    if let Err(e) = spawn_inner(Some(app), id, cwd, shell, None, None, false) {
        eprintln!("[pty] failed to warm {id}: {e}");
    }
}

/// The (leaf_id, cwd, shell) candidates startup pre-warming should spawn local
/// shells for. Pure and exported so the ssh-exclusion rule is unit-testable
/// without an AppHandle.
pub fn warm_startup_targets(state: &Value) -> Vec<(String, Option<String>, Option<String>)> {
    let Some(active_id) = state.get("activeWorkspaceId").and_then(Value::as_str) else {
        return Vec::new();
    };
    let Some(workspace) = state
        .get("workspaces")
        .and_then(Value::as_array)
        .and_then(|arr| arr.iter().find(|w| w.get("id").and_then(Value::as_str) == Some(active_id)))
    else {
        return Vec::new();
    };
    let Some(tree) = workspace.get("paneTree") else { return Vec::new() };
    let empty = Vec::new();
    let sessions = state.get("sessions").and_then(Value::as_array).unwrap_or(&empty);
    leaf_session_ids(tree)
        .into_iter()
        .filter_map(|leaf_id| {
            let found = sessions
                .iter()
                .find(|s| s.get("id").and_then(Value::as_str) == Some(leaf_id.as_str()))?;
            let shell = found.get("shell").and_then(Value::as_str).map(String::from);
            // SSH sessions run on a remote russh connection (sshconn.rs), not a
            // local PTY — pre-warming one here would spawn a leaked local shell
            // that kill_pty (which routes to sshconn) never reaps.
            if shell.as_deref() == Some("ssh") {
                return None;
            }
            let cwd = found.get("cwd").and_then(Value::as_str).map(String::from);
            Some((leaf_id, cwd, shell))
        })
        .collect()
}

/// Warm the active workspace's pane-tree leaves at startup (mirrors the
/// Electron boot sequence).
pub fn warm_startup(app: &AppHandle) {
    let state = crate::store::load_state();
    for (leaf_id, cwd, shell) in warm_startup_targets(&state) {
        warm(app, &leaf_id, cwd.as_deref(), shell.as_deref());
    }
}

pub fn leaf_session_ids(tree: &Value) -> Vec<String> {
    if tree.get("type").and_then(Value::as_str) == Some("leaf") {
        return tree
            .get("sessionId")
            .and_then(Value::as_str)
            .map(|s| vec![s.to_string()])
            .unwrap_or_default();
    }
    let mut out = Vec::new();
    for key in ["first", "second"] {
        if let Some(sub) = tree.get(key) {
            out.extend(leaf_session_ids(sub));
        }
    }
    out
}

pub fn write(id: &str, data: &str) {
    let session = SESSIONS.read().unwrap().get(id).cloned();
    if let Some(session) = session {
        let mut writer = session.writer.lock().unwrap();
        // PTY may have exited; ignore write errors (EPIPE), same as before.
        let _ = writer.write_all(data.as_bytes());
        let _ = writer.flush();
    }
}

pub fn resize(id: &str, cols: u16, rows: u16) {
    let session = SESSIONS.read().unwrap().get(id).cloned();
    if let Some(session) = session {
        let _ = session.master.lock().unwrap().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}

pub fn kill(id: &str) -> Value {
    let victim = SESSIONS.write().unwrap().remove(id);
    if let Some(session) = victim {
        let _ = session.child.lock().unwrap().kill();
    }
    crate::hooks::remove_pane(id);
    json!({ "success": true })
}

pub fn session_exists(id: &str) -> bool {
    SESSIONS.read().unwrap().contains_key(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    // ── ImageRowTracker (ConPTY inline-image cursor repair) ─────────────

    fn iip_image(height_cells: u32) -> String {
        format!("\x1b]1337;File=inline=1;width=87;height={height_cells};preserveAspectRatio=0:QUJDRA==\x07")
    }

    #[test]
    fn image_rows_credited_at_terminator_not_header() {
        let mut t = ImageRowTracker::default();
        let img = iip_image(23);
        let colon = img.find(':').unwrap();
        // header alone credits nothing and reports pending
        assert_eq!(t.feed(&img[..colon]), 0);
        assert!(t.is_pending());
        assert_eq!(t.feed(&img[colon..]), 23);
        assert!(!t.is_pending());
    }

    #[test]
    fn image_rows_survive_split_marker_header_and_terminator() {
        let img = iip_image(15);
        // split at every byte position; each split must credit exactly 15
        for split in 1..img.len() {
            let mut t = ImageRowTracker::default();
            let got = t.feed(&img[..split]) + t.feed(&img[split..]);
            assert_eq!(got, 15, "split at {split}");
        }
    }

    #[test]
    fn image_rows_accept_st_terminator() {
        let mut t = ImageRowTracker::default();
        let got = t.feed("\x1b]1337;File=inline=1;height=9;:QUJD\x1b\\");
        assert_eq!(got, 9);
    }

    #[test]
    fn image_rows_skip_px_auto_and_percent_heights() {
        let mut t = ImageRowTracker::default();
        assert_eq!(t.feed("\x1b]1337;File=height=200px;:QQ==\x07"), 0);
        assert_eq!(t.feed("\x1b]1337;File=height=auto;:QQ==\x07"), 0);
        assert_eq!(t.feed("\x1b]1337;File=height=50%;:QQ==\x07"), 0);
        // a following cell-height image still counts
        assert_eq!(t.feed(&iip_image(7)), 7);
    }

    #[test]
    fn image_rows_suppressed_in_alt_screen() {
        let mut t = ImageRowTracker::default();
        assert_eq!(t.feed("\x1b[?1049h"), 0);
        assert_eq!(t.feed(&iip_image(10)), 0); // yazi-style fullscreen image
        assert_eq!(t.feed("\x1b[?1049l"), 0);
        assert_eq!(t.feed(&iip_image(10)), 10); // back in the main screen
    }

    #[test]
    fn image_rows_sum_multiple_images() {
        let mut t = ImageRowTracker::default();
        let two = format!("{}{}", iip_image(5), iip_image(8));
        assert_eq!(t.feed(&two), 13);
    }

    #[test]
    fn image_rows_recover_after_malformed_unterminated_header() {
        let mut t = ImageRowTracker::default();
        let garbage = format!("\x1b]1337;{}", "A".repeat(IIP_HEADER_LIMIT + 10));
        assert_eq!(t.feed(&garbage), 0);
        assert_eq!(t.feed(&iip_image(4)), 4);
    }

    #[test]
    fn image_rows_ignore_plain_text_and_other_escapes() {
        let mut t = ImageRowTracker::default();
        assert_eq!(t.feed("normal \x1b[31mred\x1b[0m text \x1b[?25h\r\n"), 0);
        assert!(!t.is_pending());
    }

    #[test]
    fn image_rows_pending_false_after_payload_only_chunk() {
        // payload chunks (pure base64, no ESC) must not stall the pending flag
        let mut t = ImageRowTracker::default();
        let img = iip_image(3);
        let colon = img.find(':').unwrap();
        t.feed(&img[..colon]);
        assert!(t.is_pending());
        let rest = &img[colon..];
        let bel = rest.find('\x07').unwrap();
        assert_eq!(t.feed(&rest[..bel]), 0);
        assert!(t.is_pending()); // still no terminator
        assert_eq!(t.feed(&rest[bel..]), 3);
        assert!(!t.is_pending());
    }

    #[test]
    fn decode_handles_split_multibyte_sequence() {
        let mut carry = Vec::new();
        // '火' = E7 81 AB — split across two reads.
        let first = decode(&mut carry, &[0xE7, 0x81]);
        assert_eq!(first, "");
        assert_eq!(carry, vec![0xE7, 0x81]);
        let second = decode(&mut carry, &[0xAB, b'!']);
        assert_eq!(second, "火!");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_replaces_invalid_bytes() {
        let mut carry = Vec::new();
        let out = decode(&mut carry, &[b'a', 0xFF, b'b']);
        assert_eq!(out, "a\u{FFFD}b");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_empty_input_yields_empty_string() {
        let mut carry = Vec::new();
        let out = decode(&mut carry, &[]);
        assert_eq!(out, "");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_all_invalid_consumes_and_replaces() {
        let mut carry = Vec::new();
        let out = decode(&mut carry, &[0xFF, 0xFE, 0x80]);
        assert_eq!(out, "\u{FFFD}\u{FFFD}\u{FFFD}");
        assert!(carry.is_empty());
    }

    #[test]
    fn decode_carry_persists_across_empty_chunk() {
        let mut carry = Vec::new();
        let first = decode(&mut carry, &[0xE7]);
        assert_eq!(first, "");
        assert_eq!(carry, vec![0xE7]);
        let second = decode(&mut carry, &[]);
        assert_eq!(second, "", "empty chunk should preserve carry");
        assert_eq!(carry, vec![0xE7], "carry must survive empty input");
        let third = decode(&mut carry, &[0x81, 0xAB]);
        assert_eq!(third, "火");
        assert!(carry.is_empty());
    }

    #[test]
    fn shell_args_integration_for_pwsh_path() {
        let args = shell_spawn_args(r"D:\PowerShell7\7\pwsh.exe");
        assert!(args.contains(&"-NoLogo".into()), "pwsh gets no-logo args");
        assert!(args.contains(&"-NoExit".into()));
        assert!(args.last().unwrap().contains("pwsh.ps1"));
    }

    #[test]
    fn shell_args_for_powershell() {
        let args = shell_spawn_args(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        assert!(args.contains(&"-ExecutionPolicy".into()));
        assert!(args.last().unwrap().contains("pwsh.ps1"));
    }

    #[test]
    fn shell_args_cmd_and_other() {
        assert_eq!(shell_spawn_args(r"C:\Windows\System32\cmd.exe")[0], "/k");
        assert!(shell_spawn_args(r"C:\Program Files\Git\bin\bash.exe").is_empty());
    }

    #[test]
    fn shell_args_unknown_shell_returns_empty() {
        assert!(shell_spawn_args(r"C:\tools\my-custom-shell.exe").is_empty());
        assert!(shell_spawn_args(r"").is_empty(), "empty path yields empty args");
    }

    #[test]
    fn shell_args_pwsh_accepts_various_pwsh_paths() {
        let args = shell_spawn_args(r"/usr/bin/pwsh");
        assert!(args.last().unwrap().contains("pwsh.ps1"), "unix-style pwsh path works");
        let args = shell_spawn_args(r"pwsh");
        assert!(args.last().unwrap().contains("pwsh.ps1"), "bare pwsh name works");
    }

    #[test]
    fn shell_path_falls_back_for_unknown() {
        assert_eq!(shell_path(Some("no-such-shell")), shell_path(None));
        assert!(shell_path(Some("powershell")).ends_with("powershell.exe"));
    }

    #[test]
    fn leaf_ids_walk_nested_tree() {
        let tree = json!({
            "type": "split",
            "first": { "type": "leaf", "sessionId": "a" },
            "second": {
                "type": "split",
                "first": { "type": "leaf", "sessionId": "b" },
                "second": { "type": "leaf", "sessionId": "c" }
            }
        });
        assert_eq!(leaf_session_ids(&tree), vec!["a", "b", "c"]);
    }

    #[test]
    fn dsr_filter_answers_and_strips_query() {
        let mut state = DsrState::Pending(String::new());
        let (forward, reply) = dsr_filter(&mut state, "\x1b[6nrest");
        assert!(reply);
        assert_eq!(forward.as_deref(), Some("rest"));
        // After answering, everything passes through untouched.
        let (forward, reply) = dsr_filter(&mut state, "abc");
        assert!(!reply);
        assert_eq!(forward.as_deref(), Some("abc"));
    }

    #[test]
    fn dsr_filter_handles_split_query() {
        let mut state = DsrState::Pending(String::new());
        let (forward, reply) = dsr_filter(&mut state, "\x1b[6");
        assert!(!reply);
        assert_eq!(forward, None);
        let (forward, reply) = dsr_filter(&mut state, "nmore");
        assert!(reply);
        assert_eq!(forward.as_deref(), Some("more"));
    }

    #[test]
    fn dsr_filter_passes_through_when_no_query() {
        let mut state = DsrState::Pending(String::new());
        let (forward, reply) = dsr_filter(&mut state, "hello");
        assert!(!reply);
        assert_eq!(forward.as_deref(), Some("hello"));
    }

    #[test]
    fn try_begin_spawn_first_acquires_then_rejects_duplicate() {
        let guard = try_begin_spawn("lock-test-1");
        assert!(guard.is_some(), "first attempt should acquire");
        let second = try_begin_spawn("lock-test-1");
        assert!(second.is_none(), "duplicate should be rejected");
        drop(guard);
        let after_drop = try_begin_spawn("lock-test-1");
        assert!(after_drop.is_some(), "after drop should re-acquire");
    }

    #[test]
    fn try_begin_spawn_different_ids_are_independent() {
        let a = try_begin_spawn("lock-a");
        let b = try_begin_spawn("lock-b");
        assert!(a.is_some());
        assert!(b.is_some());
    }

    #[test]
    fn session_exists_is_false_for_unknown_id() {
        assert!(!session_exists("no-such-session"));
    }

    #[test]
    fn write_to_unknown_session_is_noop() {
        write("no-such-session", "data");
        // Should not panic.
    }

    #[test]
    fn resize_unknown_session_is_noop() {
        resize("no-such-session", 80, 24);
        // Should not panic.
    }

    #[test]
    fn kill_unknown_session_returns_success() {
        let result = kill("no-such-session");
        assert_eq!(result["success"], true);
    }

    #[test]
    fn buffer_push_preserves_order_under_cap() {
        let shared = Arc::new(Shared {
            attached: AtomicBool::new(false),
            buffer: Mutex::new(ReplayBuffer::default()),
            app: None,
            image_rows: AtomicU32::new(0),
            image_pending: AtomicBool::new(false),
        });
        buffer_push(&shared, "a".to_string());
        buffer_push(&shared, "b".to_string());
        buffer_push(&shared, "c".to_string());
        assert_eq!(shared.buffer.lock().unwrap().chunks.iter().cloned().collect::<String>(), "abc");
    }

    #[test]
    fn buffer_push_drops_oldest_chunks_over_cap() {
        let shared = Arc::new(Shared {
            attached: AtomicBool::new(false),
            buffer: Mutex::new(ReplayBuffer::default()),
            app: None,
            image_rows: AtomicU32::new(0),
            image_pending: AtomicBool::new(false),
        });
        let chunk = "x".repeat(PREHEAT_BUFFER_CAP / 2);
        buffer_push(&shared, chunk.clone());
        buffer_push(&shared, chunk.clone());
        buffer_push(&shared, "tail".to_string());
        let kept = shared.buffer.lock().unwrap().chunks.iter().cloned().collect::<String>();
        assert_eq!(kept, format!("{chunk}tail"));
        assert!(shared.buffer.lock().unwrap().total <= PREHEAT_BUFFER_CAP, "buffer must stay under cap");
    }

    #[test]
    fn take_buffer_clears_and_returns_joined() {
        let shared = Arc::new(Shared {
            attached: AtomicBool::new(false),
            buffer: Mutex::new(ReplayBuffer::default()),
            app: None,
            image_rows: AtomicU32::new(0),
            image_pending: AtomicBool::new(false),
        });
        buffer_push(&shared, "hello".to_string());
        buffer_push(&shared, " world".to_string());
        assert_eq!(take_buffer(&shared).as_deref(), Some("hello world"));
        assert!(shared.buffer.lock().unwrap().chunks.is_empty());
    }

    #[test]
    fn spawn_echo_and_exit_cleanup() {
        // Real ConPTY round-trip: unattached session buffers output; exit
        // removes the session from the registry.
        let id = format!("test-{}", std::process::id());
        let pid = spawn_inner(None, &id, None, Some("cmd"), None, None, false)
            .expect("spawn cmd");
        assert!(pid > 0);
        thread::sleep(Duration::from_millis(500));
        {
            let map = SESSIONS.read().unwrap();
            let session = map.get(&id).expect("session registered");
            let buffered = session.shared.buffer.lock().unwrap().chunks.iter().cloned().collect::<String>();
            assert!(!buffered.is_empty(), "expected some shell banner output");
        }
        // ConPTY's startup DSR query is answered by dsr_filter internally;
        // `exit` then ends cmd and the wait loop must evict the session.
        write(&id, "exit\r");
        let mut gone = false;
        for _ in 0..40 {
            if !SESSIONS.read().unwrap().contains_key(&id) {
                gone = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        assert!(gone, "session should be removed after shell exit");
    }

    #[test]
    fn write_to_non_reading_child_does_not_block_the_caller() {
        // REVIEW.md P0-5: write_pty is a SYNC tauri command (main thread) and
        // pty::write does a blocking write_all while holding the writer lock.
        // The review hypothesized that a child that never reads stdin lets the
        // ConPTY input pipe fill and write_all then blocks — a full UI freeze.
        //
        // EMPIRICAL RESULT (2026-08-26, Win11 + ConPTY, cmd child flooded with
        // 8 MiB of '\r'-less input): the freeze claim did NOT reproduce —
        // conhost keeps draining the pipe, every single write returned in
        // ≤ 54ms, all 512 chunks landed. The observable cost is throughput
        // (~0.5 MiB/s while flooding), not blockage. This test now pins the
        // measured contract so a platform/ConPTY behavior change that DOES
        // apply hard backpressure shows up red instead of freezing a user's
        // window first.
        let id = format!("test-write-block-{}", std::process::id());
        spawn_inner(None, &id, None, Some("cmd"), None, None, true).expect("spawn cmd");
        thread::sleep(Duration::from_millis(500));

        const CHUNKS: usize = 512; // 512 × 16 KiB = 8 MiB of unread input
        let chunk = "x".repeat(16 * 1024);
        let written = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let max_write_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let worker_written = written.clone();
        let worker_max = max_write_ms.clone();
        let worker_id = id.clone();
        let worker = thread::spawn(move || {
            for _ in 0..CHUNKS {
                let t = std::time::Instant::now();
                write(&worker_id, &chunk);
                worker_max.fetch_max(t.elapsed().as_millis() as u64, std::sync::atomic::Ordering::SeqCst);
                worker_written.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
        });

        // Generous deadline: at the measured ~0.5 MiB/s flood throughput the
        // full 8 MiB takes ~16s. The deadline exists only so a genuinely
        // wedged pipe can't hang the suite forever.
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        let mut completed = false;
        while std::time::Instant::now() < deadline {
            if written.load(std::sync::atomic::Ordering::SeqCst) >= CHUNKS {
                completed = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if !completed {
            // Unblock the worker: killing the child breaks the pipe, write_all
            // errors out, and pty::write swallows the error.
            kill(&id);
        }
        let _ = worker.join();
        let _ = kill(&id);
        let delivered = written.load(std::sync::atomic::Ordering::SeqCst);
        let max_ms = max_write_ms.load(std::sync::atomic::Ordering::SeqCst);
        // The freeze contract: no single write may block long enough to hang
        // the UI (2s is already user-visible; measured reality is ≤ 54ms).
        assert!(
            completed && max_ms < 2000,
            "pty::write against a non-reading child: {delivered}/{CHUNKS} chunks \
             (completed={completed}), slowest single write {max_ms}ms — any \
             multi-second write on the main thread is a user-visible freeze",
        );
    }
}
