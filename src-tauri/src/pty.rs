use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use crate::pty_output::{Output, SendMessage};

pub fn resource_dir() -> PathBuf {
    APP_RESOURCE_DIR.get().cloned().unwrap_or_default()
}



struct Shared {
    command: Arc<Mutex<crate::command_state::Tracker>>,
    program: Arc<crate::program_state::Run>,
    output: Output,
    app: Option<AppHandle>,

    image_rows: AtomicU32,

    image_pending: AtomicBool,
}


pub struct Session {
    pid: u32,
    hook_root: Option<crate::hook_identity::ProcessKey>,
    cwd: Option<String>,
    shell: Option<String>,
    writer: mpsc::Sender<Input>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    shared: Arc<Shared>,
    activated: AtomicBool,
}

enum Input {
    Data(Vec<u8>),
    ProgramReply(crate::program_state::Reply),
}

impl Session {
    fn resize(&self, cols: Option<u16>, rows: Option<u16>) -> Result<(), String> {
        if cols.is_none() && rows.is_none() {
            return Ok(());
        }
        let master = self.master.lock().unwrap();
        let current = master.get_size().map_err(|error| error.to_string())?;
        let size = PtySize {
            cols: cols.unwrap_or(current.cols),
            rows: rows.unwrap_or(current.rows),
            pixel_width: 0,
            pixel_height: 0,
        };
        if size.cols == current.cols && size.rows == current.rows {
            return Ok(());
        }
        master.resize(size).map_err(|error| error.to_string())
    }
}

static SESSIONS: LazyLock<RwLock<HashMap<String, Arc<Session>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));


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



fn shell_paths(name: &str) -> Option<&'static str> {
    match name {
        "powershell" => Some(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
        "cmd" => Some(r"C:\Windows\System32\cmd.exe"),
        "wsl" => Some(r"C:\Windows\System32\wsl.exe"),
        _ => None,
    }
}


fn find_gitbash() -> Option<PathBuf> {
    static GITBASH: OnceLock<Option<PathBuf>> = OnceLock::new();
    GITBASH
        .get_or_init(|| {
            if let Ok(out) = Command::new("where.exe").arg("git").creation_flags(0x08000000).output() {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);

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

fn quote_ps_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn shell_spawn_args(shell_path: &str) -> Vec<String> {
    let stem = Path::new(shell_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();


    if stem.starts_with("pwsh") || stem.starts_with("powershell") {
        let script = script_path("pwsh.ps1");
        let args = vec![
            "-NoLogo".into(),
            "-NoExit".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            format!(". {}", quote_ps_literal(&script.display().to_string())),
        ];
        #[cfg(feature = "e2e")]
        if crate::benchmark::load_count(&crate::store::data_dir()).is_ok() {
            return std::iter::once("-NoProfile".into()).chain(args).collect();
        }
        return args;
    }
    if stem == "cmd" {
        return vec!["/k".into(), script_path("cmd-prompt.cmd").to_string_lossy().into_owned()];
    }

    Vec::new()
}



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

                        carry.drain(..valid);
                        break;
                    }
                }
            }
        }
    }
    out
}



pub enum DsrState {

    Pending(String),
    Done,
}

const DSR_QUERY: &str = "\x1b[6n";
const DSR_REPLY: &[u8] = b"\x1b[1;1R";


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



const IIP_MARKER: &[u8] = b"\x1b]1337;File=";
const ALT_ENTER: &[u8] = b"\x1b[?1049h";
const ALT_LEAVE: &[u8] = b"\x1b[?1049l";
const ALT_ENTER_47: &[u8] = b"\x1b[?1047h";
const ALT_LEAVE_47: &[u8] = b"\x1b[?1047l";
const NEEDLES: [&[u8]; 5] = [IIP_MARKER, ALT_ENTER, ALT_LEAVE, ALT_ENTER_47, ALT_LEAVE_47];
const MAX_NEEDLE_LEN: usize = 12;
const IIP_HEADER_LIMIT: usize = 1024;

#[derive(Default, PartialEq, Clone, Copy)]
enum ImageScanState {
    #[default]
    Idle,
    Header,
    Payload,
}


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

    header: Vec<u8>,

    carry: String,
    alt_screen: bool,

    pending_rows: u32,
}

impl ImageRowTracker {

    fn is_pending(&self) -> bool {
        self.state != ImageScanState::Idle
    }


    fn feed(&mut self, text: &str) -> u32 {

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
                            hold_from = Some(p);
                            break;
                        }
                        i = p + 1;
                    }
                }
                ImageScanState::Header => {
                    let Some(rel) = bytes[i..].iter().position(|&b| b == b':') else {
                        self.header.extend_from_slice(&bytes[i..]);
                        if self.header.len() > IIP_HEADER_LIMIT {
                            self.state = ImageScanState::Idle;
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

                    let bel = bytes[i..].iter().position(|&b| b == 0x07).map(|r| i + r);
                    let st = bytes[i..]
                        .windows(2)
                        .position(|w| w == b"\x1b\\")
                        .map(|r| i + r);

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

            Some(p) => combined[p..].to_string(),
            None => String::new(),
        };
        credited
    }
}


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

    match rest.as_bytes()[digits..].first() {
        None | Some(b';') => {}
        _ => return 0,
    }
    rest[..digits].parse().unwrap_or(0)
}


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



fn writer_loop(
    mut writer: Box<dyn Write + Send>,
    receiver: mpsc::Receiver<Input>,
    #[cfg(feature = "e2e")] output: Output,
) {
    for input in receiver {
        let data=match &input {Input::Data(data)=>data.as_slice(),Input::ProgramReply(reply)=>reply.bytes()};
        #[cfg(feature = "e2e")]
        output.trace_input(crate::benchmark::InputStage::WriteStarted, data);
        if writer.write_all(data).and_then(|_| writer.flush()).is_err() {
            break;
        }
        #[cfg(feature = "e2e")]
        output.trace_input(crate::benchmark::InputStage::Written, data);
    }
}

fn reader_loop(shared: Arc<Shared>, writer: mpsc::Sender<Input>, mut reader: Box<dyn Read + Send>) {
    let mut carry: Vec<u8> = Vec::new();
    let mut dsr = DsrState::Pending(String::new());
    let mut image_tracker = ImageRowTracker::default();
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if let Some(reply)=shared.program.feed(&buf[..n]) {let _=writer.send(Input::ProgramReply(reply));}
                #[cfg(feature = "e2e")]
                shared.output.trace_read(&buf[..n]);
                let text = decode(&mut carry, &buf[..n]);
                if text.is_empty() {
                    continue;
                }
                shared.command.lock().unwrap().feed(&text, crate::command_state::now_ms());
                let credited = image_tracker.feed(&text);
                if credited > 0 {
                    shared.image_rows.fetch_add(credited, Ordering::Relaxed);
                }
                shared.image_pending.store(image_tracker.is_pending(), Ordering::Relaxed);
                let (forward, reply) = dsr_filter(&mut dsr, &text);
                if reply {
                    let _ = writer.send(Input::Data(DSR_REPLY.to_vec()));
                }
                let Some(text) = forward else { continue };
                if text.is_empty() {
                    continue;
                }
                shared.output.push(text);
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    if let DsrState::Pending(held) = dsr {
        shared.output.push(held);
    }
    if !carry.is_empty() {
        shared.output.push(String::from_utf8_lossy(&carry).into_owned());
    }
    shared.command.lock().unwrap().eof(crate::command_state::now_ms());
    shared.program.eof();
    shared.output.eof();
}

fn wait_loop(id: String, child: Arc<Mutex<Box<dyn Child + Send + Sync>>>) {
    let code = loop {
        {
            let mut child = child.lock().unwrap();
            match child.try_wait() {
                Ok(Some(status)) => break i64::from(status.exit_code()),
                Ok(None) => {}

                Err(_) => break -1,
            }
        }
        thread::sleep(Duration::from_millis(150));
    };


    let session = {
        let mut map = SESSIONS.write().unwrap();
        let Some(session) = map.get(&id) else { return };
        if !Arc::ptr_eq(&session.child, &child) {
            return;
        }
        map.remove(&id).unwrap()
    };
    if let Some(root) = session.hook_root { crate::hooks::remove_pane(session.shared.app.as_ref(), &id, root); }
    let output = session.shared.output;
    drop(session);
    output.exit(code);
}




fn normalize_cwd(cwd: Option<&str>) -> Option<&str> {
    cwd.filter(|c| !c.is_empty() && Path::new(c).is_dir())
}


fn terminal_identity_envs_to_strip() -> &'static [&'static str] {
    &[
        "WT_SESSION",
        "WT_PROFILE_ID",
        "WT_SESSION_ID",
        "VSCODE_PID",
        "VSCODE_CWD",
        "VSCODE_GIT_ASKPASS_NODE",
        "VSCODE_GIT_ASKPASS_MAIN",
        "VSCODE_INJECTION",
        "KITTY_WINDOW_ID",
        "KITTY_PID",
        "GHOSTTY_RESOURCES_DIR",
        "WEZTERM_PANE",
        "WEZTERM_EXECUTABLE",
        "ALACRITTY_WINDOW_ID",
        "ALACRITTY_SOCKET",
        "ITERM_SESSION_ID",
        "ITERM_PROFILE",
        "TERM_PROGRAM_VERSION",
        "LC_TERMINAL_VERSION",
        "TMUX",
        "TMUX_PANE",
        "STY",
        "ZELLIJ",
    ]
}


fn terminal_capability_envs() -> [(&'static str, &'static str); 6] {
    [
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("TERM_PROGRAM", "vscode"),
        ("LC_TERMINAL", "iTerm2"),

        ("ITERM_SESSION_ID", "patty:0:0"),
        ("PI_FORCE_IMAGE_PROTOCOL", "iterm2"),
    ]
}

fn spawn_inner(
    app: Option<&AppHandle>,
    id: &str,
    cwd: Option<&str>,
    shell: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
    activated: bool,
    attachment: Option<(String, SendMessage)>,
) -> Result<u32, String> {
    let shell_path = shell_path(shell);
    let cwd = normalize_cwd(cwd);
    let working_dir = cwd
        .map(String::from)
        .or_else(|| std::env::var("USERPROFILE").ok())
        .unwrap_or_else(|| r"C:\Users".to_string());

    crate::conpty::ensure()?;
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
    for key in terminal_identity_envs_to_strip() {
        cmd.env_remove(key);
    }
    for (key, value) in terminal_capability_envs() {
        cmd.env(key, value);
    }

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
    let (writer_tx, writer_rx) = mpsc::channel();

    let output = Output::new();
    if let Some((connection, send)) = attachment {
        if !output.attach(connection, send) {
            output.close();
            let _ = child.lock().unwrap().kill();
            return Err("Local terminal connection is already in use".into());
        }
    }
    let shared = Arc::new(Shared {
        command: crate::command_state::start(id),
        program: crate::program_state::start(id),
        output,
        app: app.cloned(),
        image_rows: AtomicU32::new(0),
        image_pending: AtomicBool::new(false),
    });

    let session = Arc::new(Session {
        pid,
        hook_root: crate::hook_identity::process_key(pid),
        cwd: cwd.map(String::from),
        shell: shell.map(String::from),
        writer: writer_tx,
        master: Mutex::new(pair.master),
        child: child.clone(),
        shared: shared.clone(),
        activated: AtomicBool::new(activated),
    });
    SESSIONS.write().unwrap().insert(id.to_string(), session.clone());
    thread::spawn(move || writer_loop(writer, writer_rx, #[cfg(feature = "e2e")] output));

    let reply = session.writer.clone();
    thread::spawn(move || reader_loop(shared, reply, reader));

    let wait_id = id.to_string();
    thread::spawn(move || wait_loop(wait_id, child));

    Ok(pid)
}

pub(crate) fn create(
    app: Option<&AppHandle>,
    id: &str,
    cwd: Option<&str>,
    shell: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
    attachment: Option<(String, SendMessage)>,
) -> Value {
    let _spawn_guard = begin_spawn(id);
    let cwd = normalize_cwd(cwd);

    let victim = {
        let mut map = SESSIONS.write().unwrap();
        match map.get(id) {
            Some(existing)
                if existing.activated.load(Ordering::Relaxed)
                    || (existing.cwd.as_deref() == cwd
                        && existing.shell.as_deref() == shell) =>
            {
                let existing = existing.clone();
                drop(map);
                if let Err(error) = existing.resize(cols, rows) {
                    return json!({ "pid": existing.pid, "success": false, "error": error });
                }
                if let Some((connection, send)) = attachment {
                    if !existing.shared.output.attach(connection, send) {
                        return json!({ "pid": existing.pid, "success": false, "error": "Local terminal connection is unavailable" });
                    }
                }
                existing.activated.store(true, Ordering::Relaxed);
                return create_success(existing.pid);
            }
            Some(_) => map.remove(id),
            None => None,
        }
    };
    if let Some(victim) = victim {
        if let Some(root) = victim.hook_root { crate::hooks::remove_pane(victim.shared.app.as_ref(), id, root); }
        terminate(&victim);
    }

    match spawn_inner(app, id, cwd, shell, cols, rows, true, attachment) {
        Ok(pid) => create_success(pid),
        Err(e) => {
            eprintln!("[pty] create failed for {id}: {e}");
            json!({ "pid": 0, "success": false, "error": e })
        }
    }
}

fn create_success(pid: u32) -> Value {
    let windows_pty = json!({
        "backend": "conpty",
        "buildNumber": crate::conpty::XTERM_REFLOW_COMPATIBILITY_BUILD,
    });
    json!({ "pid": pid, "success": true, "windowsPty": windows_pty })
}


pub fn warm(app: &AppHandle, id: &str, cwd: Option<&str>, shell: Option<&str>) {

    let Some(_spawn_guard) = try_begin_spawn(id) else {
        return;
    };
    let cwd = normalize_cwd(cwd);
    if SESSIONS.read().unwrap().contains_key(id) {
        return;
    }
    if let Err(e) = spawn_inner(Some(app), id, cwd, shell, None, None, false, None) {
        eprintln!("[pty] failed to warm {id}: {e}");
    }
}


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

            if shell.as_deref() == Some("ssh") {
                return None;
            }
            let cwd = found.get("cwd").and_then(Value::as_str).map(String::from);
            Some((leaf_id, cwd, shell))
        })
        .collect()
}


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
        #[cfg(feature = "e2e")]
        session.shared.output.trace_input(crate::benchmark::InputStage::Queued, data.as_bytes());
        let _ = session.writer.send(Input::Data(data.as_bytes().to_vec()));
    }
}

pub fn resize(id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let session = SESSIONS
        .read()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| format!("Terminal session does not exist: {id}"))?;
    session.resize(Some(cols), Some(rows))
}

pub fn kill(id: &str) -> Value {
    crate::command_state::forget(id);
    crate::program_state::forget(id);
    let victim = SESSIONS.write().unwrap().remove(id);
    if let Some(session) = victim {
        if let Some(root) = session.hook_root { crate::hooks::remove_pane(session.shared.app.as_ref(), id, root); }
        terminate(&session);
    }
    json!({ "success": true })
}

fn terminate(session: &Session) {
    session.shared.program.retire();
    session.shared.output.close();
    let alive = matches!(session.child.lock().unwrap().try_wait(), Ok(None));
    if alive {
        kill_process_tree(session.pid);
    }
    let _ = session.child.lock().unwrap().kill();
}

fn kill_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

pub fn session_exists(id: &str) -> bool {
    SESSIONS.read().unwrap().contains_key(id)
}

pub(crate) fn with_hook_session<R>(id: &str, apply: impl FnOnce(crate::hook_identity::ProcessKey) -> R) -> Option<R> {
    let sessions = SESSIONS.read().unwrap();
    let root = sessions.get(id)?.hook_root?;
    Some(apply(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_conpty_advertises_reflow_capability_independently_of_the_os_build() {
        assert_eq!(create_success(123)["windowsPty"], json!({
            "backend": "conpty",
            "buildNumber": 21376,
        }));
    }


    fn iip_image(height_cells: u32) -> String {
        format!("\x1b]1337;File=inline=1;width=87;height={height_cells};preserveAspectRatio=0:QUJDRA==\x07")
    }

    #[test]
    fn image_rows_credited_at_terminator_not_header() {
        let mut t = ImageRowTracker::default();
        let img = iip_image(23);
        let colon = img.find(':').unwrap();

        assert_eq!(t.feed(&img[..colon]), 0);
        assert!(t.is_pending());
        assert_eq!(t.feed(&img[colon..]), 23);
        assert!(!t.is_pending());
    }

    #[test]
    fn image_rows_survive_split_marker_header_and_terminator() {
        let img = iip_image(15);

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

        assert_eq!(t.feed(&iip_image(7)), 7);
    }

    #[test]
    fn image_rows_suppressed_in_alt_screen() {
        let mut t = ImageRowTracker::default();
        assert_eq!(t.feed("\x1b[?1049h"), 0);
        assert_eq!(t.feed(&iip_image(10)), 0);
        assert_eq!(t.feed("\x1b[?1049l"), 0);
        assert_eq!(t.feed(&iip_image(10)), 10);
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

        let mut t = ImageRowTracker::default();
        let img = iip_image(3);
        let colon = img.find(':').unwrap();
        t.feed(&img[..colon]);
        assert!(t.is_pending());
        let rest = &img[colon..];
        let bel = rest.find('\x07').unwrap();
        assert_eq!(t.feed(&rest[..bel]), 0);
        assert!(t.is_pending());
        assert_eq!(t.feed(&rest[bel..]), 3);
        assert!(!t.is_pending());
    }

    #[test]
    fn decode_handles_split_multibyte_sequence() {
        let mut carry = Vec::new();

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
    fn shell_args_escape_a_single_quote_in_the_script_path() {
        let args = shell_spawn_args("pwsh");
        let command = args.last().expect("pwsh yields a -Command argument");
        assert!(command.ends_with("pwsh.ps1'"), "unexpected command: {command}");
        assert!(command.starts_with(". '"), "unexpected command: {command}");
    }

    #[test]
    fn quote_ps_literal_escapes_single_quotes() {
        assert_eq!(quote_ps_literal(r"C:\tools\pwsh.ps1"), r"'C:\tools\pwsh.ps1'");
        assert_eq!(
            quote_ps_literal(r"C:\O'Brien\pwsh.ps1"),
            r"'C:\O''Brien\pwsh.ps1'"
        );
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
    fn terminal_capability_envs_force_itm2_for_omp_images() {
        let envs = terminal_capability_envs();
        let get = |k: &str| envs.iter().find(|(key, _)| *key == k).map(|(_, v)| *v);

        assert_eq!(get("PI_FORCE_IMAGE_PROTOCOL"), Some("iterm2"));
        assert_eq!(get("TERM_PROGRAM"), Some("vscode"));

        assert_eq!(get("ITERM_SESSION_ID"), Some("patty:0:0"));

        assert_eq!(get("LC_TERMINAL"), Some("iTerm2"));
    }

    #[test]
    fn terminal_identity_envs_strip_host_leaks() {
        let strip = terminal_identity_envs_to_strip();

        for key in ["WT_SESSION", "VSCODE_PID", "KITTY_WINDOW_ID", "ITERM_SESSION_ID"] {
            assert!(strip.contains(&key), "{key} should be stripped");
        }
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

    }

    #[test]
    fn resize_unknown_session_returns_error() {
        assert!(resize("no-such-session", 80, 24).is_err());
    }

    #[test]
    fn kill_unknown_session_returns_success() {
        let result = kill("no-such-session");
        assert_eq!(result["success"], true);
    }

    fn create(app: Option<&AppHandle>, id: &str, cwd: Option<&str>, shell: Option<&str>, cols: Option<u16>, rows: Option<u16>) -> Value {
        super::create(app, id, cwd, shell, cols, rows, None)
    }

    fn spawn_inner(app: Option<&AppHandle>, id: &str, cwd: Option<&str>, shell: Option<&str>, cols: Option<u16>, rows: Option<u16>, activated: bool) -> Result<u32, String> {
        super::spawn_inner(app, id, cwd, shell, cols, rows, activated, None)
    }

    struct EnsureTestSession {
        id: String,
        marker: PathBuf,
        cwd: PathBuf,
    }

    impl EnsureTestSession {
        fn new(name: &str) -> Self {
            let id = format!("test-ensure-{name}-{}", std::process::id());
            let cwd = std::env::temp_dir();
            let marker = cwd.join(format!("{id}.txt"));
            let _ = std::fs::remove_file(&marker);
            Self { id, marker, cwd }
        }
    }

    impl Drop for EnsureTestSession {
        fn drop(&mut self) {
            kill(&self.id);
            let _ = std::fs::remove_file(&self.marker);
        }
    }

    #[test]
    fn conpty_program_status_survives_reattachment_and_process_exit() {
        let session=EnsureTestSession::new("program-status");
        let first=create(None,&session.id,session.cwd.to_str(),Some("cmd"),Some(100),Some(30));
        assert_eq!(first["success"],true);
        write(&session.id,"powershell.exe -NoLogo -NoProfile -Command \"$e=[char]27; [Console]::Write($e+']7501;state=blocked:kind=permission:app=deploy'+[char]7); Start-Sleep -Milliseconds 800; [Console]::Write($e+']7501;state=done:app=deploy'+[char]7)\"\r");
        let wait=|state:&str|{
            for _ in 0..200 {
                if let Some(update)=crate::program_state::update(&session.id) {
                    let value=serde_json::to_value(&update).unwrap();
                    if value["program"]["state"]==state{return update;}
                }
                thread::sleep(Duration::from_millis(25));
            }
            panic!("program status did not reach {state}");
        };
        let blocked=wait("blocked");
        let again=create(None,&session.id,None,Some("cmd"),Some(120),Some(40));
        assert_eq!(again["pid"],first["pid"]);
        assert_eq!(crate::program_state::update(&session.id).unwrap().run_id,blocked.run_id);
        let done=wait("done");
        assert_eq!(done.run_id,blocked.run_id);
        write(&session.id,"exit /b 0\r");
        for _ in 0..200 {
            if !session_exists(&session.id){break;}
            thread::sleep(Duration::from_millis(25));
        }
        assert!(!session_exists(&session.id));
        assert_eq!(serde_json::to_value(crate::program_state::update(&session.id)).unwrap()["program"]["state"],"done");
        kill(&session.id);
        assert!(crate::program_state::update(&session.id).is_none());
    }

    #[test]
    fn local_program_queries_preserve_output_and_queue_only_one_fixed_response() {
        let id=format!("program-query-{}",std::process::id());
        let registry=Arc::new(crate::program_state::Registry::default());
        let run=registry.start(&id);
        let shared=Arc::new(Shared {
            command:crate::command_state::start(&id),program:run.clone(),output:Output::new(),app:None,
            image_rows:AtomicU32::new(0),image_pending:AtomicBool::new(false),
        });
        let queries="\x1b]7501;?\x07".repeat(2000);
        let (tx,rx)=mpsc::channel();
        reader_loop(shared.clone(),tx,Box::new(std::io::Cursor::new(queries.as_bytes().to_vec())));
        let Input::ProgramReply(reply)=rx.recv_timeout(Duration::from_millis(100)).unwrap() else {panic!("Expected a program capability response")};
        assert_eq!(reply.bytes(),b"\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\");
        assert!(rx.try_recv().is_err());
        assert_eq!(shared.output.history(),queries);
        drop(reply);
        assert!(run.feed(b"\x1b]7501;?\x07").is_some());
        shared.output.close();
        crate::command_state::forget(&id);
    }

    #[test]
    fn repeated_create_keeps_active_pid_and_running_command_after_cwd_change() {
        let session = EnsureTestSession::new("active-cwd");
        let first = create(None, &session.id, session.cwd.to_str(), Some("cmd"), Some(80), Some(24));
        assert_eq!(first["success"], true);
        assert_eq!(first["windowsPty"]["backend"], "conpty");
        if let Some(build_number) = first["windowsPty"].get("buildNumber") {
            assert!(build_number.as_u64().is_some_and(|number| number > 0));
        }
        write(
            &session.id,
            &format!(
                "ping -n 3 127.0.0.1 >nul & echo STILL_RUNNING>\"{}\"\r",
                session.marker.display()
            ),
        );
        thread::sleep(Duration::from_millis(200));
        let cwd = session.cwd.parent().expect("temporary directory has a parent");
        let second = create(
            None,
            &session.id,
            cwd.to_str(),
            Some("cmd"),
            Some(132),
            Some(43),
        );
        assert_eq!(second["success"], true);
        assert_eq!(second["pid"], first["pid"], "ensuring an active session must preserve its process");
        assert!(second["replay"].is_null());
        for _ in 0..60 {
            if std::fs::read_to_string(&session.marker).is_ok_and(|s| s.trim() == "STILL_RUNNING") {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        panic!("the command running before the repeated create did not finish");
    }

    #[test]
    fn conpty_delivers_warm_replay_and_tail_before_reporting_exit() {
        use crate::pty_output::{acknowledge, Message};
        let session = EnsureTestSession::new("warm-once");
        let replay = "\x1b\\PREHEAT_READY\r\n";
        let pid = spawn_inner(None, &session.id, session.cwd.to_str(), Some("cmd"), None, None, false)
            .expect("warm cmd");
        write(&session.id, "echo PREHEAT_%COMSPEC:~0,0%READY\r");
        let mut warm = false;
        for _ in 0..60 {
            if SESSIONS.read().unwrap().get(&session.id).is_some_and(|s| s.shared.output.history().contains(replay)) {
                warm = true;
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        assert!(warm, "preheat output did not reach ConPTY");
        let (tx, rx) = mpsc::channel();
        let connection = format!("{}-channel", session.id);
        let first = super::create(None, &session.id, session.cwd.to_str(), Some("cmd"), Some(80), Some(24),
            Some((connection.clone(), Arc::new(move |message| tx.send(message.clone()).is_ok()))));
        assert_eq!(first["pid"], pid);
        write(&session.id, "echo LAST_%COMSPEC:~0,0%LINE & exit /b 7\r");
        let mut output = String::new();
        let mut through = 0;
        let code = loop {
            match rx.recv_timeout(Duration::from_secs(5)).unwrap() {
                Message::Data { sequence, text } => {
                    assert_eq!(sequence, through + 1);
                    through = sequence;
                    output.push_str(&text);
                    acknowledge(&connection, sequence);
                }
                Message::Exit { code } => break code,
            }
        };
        assert_eq!(code, 7);
        let tail = "\x1b\\LAST_LINE \r\n";
        assert_eq!(output.matches(replay).count(), 1);
        assert!(output.find(replay).unwrap() < output.find(tail).expect("last command output must arrive before exit"));
    }

    #[test]
    fn create_replaces_incompatible_unattached_warm_process() {
        let session = EnsureTestSession::new("warm-mismatch");
        let pid = spawn_inner(None, &session.id, session.cwd.to_str(), Some("cmd"), None, None, false)
            .expect("warm cmd");
        let root = with_hook_session(&session.id, |root| root).unwrap();
        crate::hooks::tests::seed_agent(&session.id, root);
        let cwd = session.cwd.parent().expect("temporary directory has a parent");
        let created = create(None, &session.id, cwd.to_str(), Some("cmd"), Some(80), Some(24));
        assert_eq!(created["success"], true);
        assert_ne!(created["pid"], pid);
        assert!(created["replay"].is_null());
        let snapshot = crate::hooks::agent_snapshot();
        assert!(!snapshot["agents"].as_array().unwrap().iter().any(|agent| agent["paneId"] == session.id));
        assert_ne!(with_hook_session(&session.id, |root| root), Some(root));
    }

    #[test]
    fn kill_retires_the_agent_and_rejects_hooks_for_the_closed_pty() {
        let session = EnsureTestSession::new("kill-hook");
        let first = create(None, &session.id, session.cwd.to_str(), Some("cmd"), None, None);
        assert_eq!(first["success"], true);
        let root = with_hook_session(&session.id, |root| root).unwrap();
        crate::hooks::tests::seed_agent(&session.id, root);
        kill(&session.id);
        assert_eq!(with_hook_session(&session.id, |root| root), None);
        let snapshot = crate::hooks::agent_snapshot();
        assert!(!snapshot["agents"].as_array().unwrap().iter().any(|agent| agent["paneId"] == session.id));
    }

    #[test]
    fn native_resize_failure_reaches_the_caller_without_restarting_session() {
        let session = EnsureTestSession::new("resize-failure");
        let first = create(None, &session.id, session.cwd.to_str(), Some("cmd"), Some(80), Some(24));
        assert_eq!(first["success"], true);
        assert!(resize(&session.id, u16::MAX, 24).is_err());
        let after = create(None, &session.id, None, Some("cmd"), None, None);
        assert_eq!(after["pid"], first["pid"]);
        assert_eq!(after["success"], true);
    }

    #[test]
    fn repeated_create_preserves_unspecified_dimensions() {
        let session = EnsureTestSession::new("partial-size");
        let first = create(None, &session.id, session.cwd.to_str(), Some("cmd"), Some(80), Some(24));
        assert_eq!(first["success"], true);
        let wider = create(None, &session.id, None, Some("cmd"), Some(132), None);
        assert_eq!(wider["pid"], first["pid"]);
        let native = SESSIONS.read().unwrap().get(&session.id).cloned().unwrap();
        let size = native.master.lock().unwrap().get_size().unwrap();
        assert_eq!((size.cols, size.rows), (132, 24));
        let taller = create(None, &session.id, None, Some("cmd"), None, Some(43));
        assert_eq!(taller["pid"], first["pid"]);
        let size = native.master.lock().unwrap().get_size().unwrap();
        assert_eq!((size.cols, size.rows), (132, 43));
        let unchanged = create(None, &session.id, None, Some("cmd"), None, None);
        assert_eq!(unchanged["pid"], first["pid"]);
        let size = native.master.lock().unwrap().get_size().unwrap();
        assert_eq!((size.cols, size.rows), (132, 43));
    }

    #[test]
    fn powershell_command_lifecycle_reports_native_codes_and_preserves_shell_state() {
        use std::time::Instant;
        for shell in ["powershell", "pwsh"] {
            let session = EnsureTestSession::new(&format!("command-semantics-{shell}"));
            let result = create(None, &session.id, session.cwd.to_str(), Some(shell), Some(120), Some(30));
            assert_eq!(result["success"], true);
            let wait = |check: &dyn Fn(&Value) -> bool| {
                let deadline = Instant::now() + Duration::from_secs(20);
                loop {
                    let state = serde_json::to_value(crate::command_state::snapshot(&session.id)).unwrap();
                    if check(&state) { break state; }
                    assert!(Instant::now() < deadline, "{shell}: command state did not converge: {state}");
                    thread::sleep(Duration::from_millis(20));
                }
            };
            wait(&|state| state["status"] == "ready");
            write(&session.id, "cmd.exe /c exit 7\r");
            let failed = wait(&|state| state["status"] == "finished");
            assert_eq!(failed["exitCode"], 7, "{shell}: {failed}");
            write(&session.id, "Get-Location\r");
            let success = wait(&|state| state["revision"].as_u64() > failed["revision"].as_u64() && state["status"] == "finished");
            assert_eq!(success["exitCode"], 0, "{shell}: stale native code leaked into a cmdlet result");
            struct ScriptFile(PathBuf);
            impl Drop for ScriptFile {
                fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
            }
            let script_file = ScriptFile(session.marker.with_extension("ps1"));
            std::fs::write(&script_file.0, "Write-Output 'script succeeded'").unwrap();
            write(&session.id, &format!("& '{}'\r", script_file.0.to_string_lossy().replace('\'', "''")));
            let script_result = wait(&|state| state["revision"].as_u64() > success["revision"].as_u64() && state["status"] == "finished");
            assert_eq!(script_result["exitCode"], 0, "{shell}: a script reused an earlier native exit code");
            write(&session.id, "if ($LASTEXITCODE -ne 7) { throw 'native exit code changed' }\r");
            let preserved = wait(&|state| state["revision"].as_u64() > script_result["revision"].as_u64() && state["status"] == "finished");
            assert_eq!(preserved["exitCode"], 0, "{shell}: LASTEXITCODE was modified");
            write(&session.id, "cmd.exe /c exit 7\r");
            let repeated = wait(&|state| state["revision"].as_u64() > preserved["revision"].as_u64() && state["status"] == "finished");
            assert_eq!(repeated["exitCode"], 7, "{shell}: repeated native failure lost its code");
            write(&session.id, "Start-Sleep -Milliseconds 300\r");
            let running = wait(&|state| state["revision"].as_u64() > repeated["revision"].as_u64() && state["status"] == "running");
            let reattached = create(None, &session.id, None, Some(shell), Some(120), Some(30));
            assert_eq!(reattached["pid"], result["pid"]);
            assert_eq!(serde_json::to_value(crate::command_state::snapshot(&session.id)).unwrap()["runId"], running["runId"]);
            let ended = wait(&|state| state["revision"].as_u64() > repeated["revision"].as_u64() && state["status"] == "finished");
            assert!(ended["durationMs"].as_u64().unwrap() >= 250, "{shell}: {ended}");
            write(&session.id, "Write-Error 'expected command failure'\r");
            let error = wait(&|state| state["revision"].as_u64() > ended["revision"].as_u64() && state["status"] == "finished");
            assert_eq!(error["exitCode"], 1, "{shell}: cmdlet failure was reported as success");
            write(&session.id, "Start-Sleep -Seconds 10\r");
            wait(&|state| state["revision"].as_u64() > error["revision"].as_u64() && state["status"] == "running");
            write(&session.id, "\x03");
            let stopped = wait(&|state| state["revision"].as_u64() > error["revision"].as_u64() && state["status"] != "running");
            assert_eq!(stopped["status"], "interrupted", "{shell}: {stopped}");
            let script = script_path("pwsh.ps1").to_string_lossy().replace('\'', "''");
            write(&session.id, &format!(". '{script}'; Get-Location\r"));
            let reloaded = wait(&|state| state["revision"].as_u64() > stopped["revision"].as_u64() && state["status"] == "finished");
            assert_eq!(reloaded["exitCode"], 0);
            write(&session.id, "Get-Location\r");
            let after_reload = wait(&|state| state["revision"].as_u64() > reloaded["revision"].as_u64() && state["status"] == "finished");
            assert_eq!(after_reload["exitCode"], 0, "{shell}: repeated integration broke command execution");
        }
    }

    #[test]
    fn queued_input_preserves_command_bytes_across_write_boundaries() {
        let session = EnsureTestSession::new("queued-input-order");
        let created = create(None, &session.id, session.cwd.to_str(), Some("cmd"), Some(80), Some(24));
        assert_eq!(created["success"], true);
        for chunk in ["(echo FIFO_FIRST", "&echo ", "FIFO_SECOND", "&echo FIFO_THIRD)>", "\""] {
            write(&session.id, chunk);
        }
        write(&session.id, &session.marker.display().to_string());
        write(&session.id, "\"\r");
        let expected = "FIFO_FIRST\r\nFIFO_SECOND\r\nFIFO_THIRD\r\n";
        for _ in 0..60 {
            if std::fs::read_to_string(&session.marker).is_ok_and(|text| text == expected) {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(std::fs::read_to_string(&session.marker).unwrap_or_default(), expected);
    }

    #[test]
    fn readline_control_executes_commands_preserves_markers_and_restores_the_editor() {
        let session = EnsureTestSession::new("readline-command-control");
        let created = create(None, &session.id, session.cwd.to_str(), Some("powershell"), Some(120), Some(30));
        assert_eq!(created["success"], true);
        let wait = |after: u64| {
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            loop {
                let state = serde_json::to_value(crate::command_state::snapshot(&session.id)).unwrap();
                if state["revision"].as_u64().unwrap_or(0) > after && state["status"] == "finished" { break state; }
                assert!(std::time::Instant::now() < deadline, "command did not finish: {state}");
                thread::sleep(Duration::from_millis(20));
            }
        };
        let ready_deadline = std::time::Instant::now() + Duration::from_secs(20);
        while serde_json::to_value(crate::command_state::snapshot(&session.id)).unwrap()["status"] != "ready" {
            assert!(std::time::Instant::now() < ready_deadline);
            thread::sleep(Duration::from_millis(20));
        }
        struct ScriptFile(PathBuf);
        impl Drop for ScriptFile { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }
        let script = ScriptFile(session.marker.with_extension("ps1"));
        std::fs::write(&script.0, include_str!("../../src/renderer/benchmark/readLineControl.ps1")).unwrap();
        write(&session.id, &format!(". '{}'; Invoke-PattyBenchmarkReadLineControl Install\r", script.0.to_string_lossy().replace('\'', "''")));
        let mut state = wait(0);
        assert_eq!(state["exitCode"], 0, "readline control was not installed: {state}");
        let run_id = state["runId"].clone();
        let marker = session.marker.to_string_lossy().replace('\'', "''");
        for index in 0..3 {
            write(&session.id, &format!("$global:__PattyBenchmarkReadLineState.Commands++; Add-Content -LiteralPath '{marker}' -Value 'command-{index}'\r"));
            state = wait(state["revision"].as_u64().unwrap());
            assert_eq!(state["exitCode"], 0);
            assert_eq!(state["runId"], run_id);
        }
        write(&session.id, "Invoke-PattyBenchmarkReadLineControl Verify -ExpectedCount 3\r");
        state = wait(state["revision"].as_u64().unwrap());
        assert_eq!(state["exitCode"], 0);
        write(&session.id, "Invoke-PattyBenchmarkReadLineControl Verify -ExpectedCount 999\r");
        state = wait(state["revision"].as_u64().unwrap());
        assert_eq!(state["exitCode"], 1, "a wrong command count must fail");
        write(&session.id, "Invoke-PattyBenchmarkReadLineControl Restore\r");
        state = wait(state["revision"].as_u64().unwrap());
        assert_eq!(state["exitCode"], 0);
        write(&session.id, &format!("if (Test-Path Variable:global:__PattyBenchmarkReadLineState) {{ throw 'control retained' }}; Add-Content -LiteralPath '{marker}' -Value 'restored'\r"));
        state = wait(state["revision"].as_u64().unwrap());
        assert_eq!(state["exitCode"], 0);
        assert_eq!(std::fs::read_to_string(&session.marker).unwrap().replace("\r\n", "\n"), "command-0\ncommand-1\ncommand-2\nrestored\n");
    }

    #[test]
    fn spawn_echo_and_exit_cleanup() {

        let id = format!("test-{}", std::process::id());
        let pid = spawn_inner(None, &id, None, Some("cmd"), None, None, false)
            .expect("spawn cmd");
        assert!(pid > 0);
        thread::sleep(Duration::from_millis(500));
        {
            let map = SESSIONS.read().unwrap();
            let session = map.get(&id).expect("session registered");
            let buffered = session.shared.output.history();
            assert!(!buffered.is_empty(), "expected some shell banner output");
        }

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

        let id = format!("test-write-block-{}", std::process::id());
        spawn_inner(None, &id, None, Some("cmd"), None, None, true).expect("spawn cmd");
        thread::sleep(Duration::from_millis(500));

        const CHUNKS: usize = 512;
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

            kill(&id);
        }
        let _ = worker.join();
        let _ = kill(&id);
        let delivered = written.load(std::sync::atomic::Ordering::SeqCst);
        let max_ms = max_write_ms.load(std::sync::atomic::Ordering::SeqCst);

        assert!(
            completed && max_ms < 2000,
            "pty::write against a non-reading child: {delivered}/{CHUNKS} chunks \
             (completed={completed}), slowest single write {max_ms}ms — any \
             multi-second write on the main thread is a user-visible freeze",
        );
    }

    fn child_pids_of(parent: u32) -> Vec<(u32, String)> {
        let mut sys = sysinfo::System::new();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        sys.processes()
            .iter()
            .filter(|(_, p)| p.parent().map(|pp| pp.as_u32()) == Some(parent))
            .map(|(pid, p)| (pid.as_u32(), p.name().to_string_lossy().into_owned()))
            .collect()
    }

    fn pid_alive(pid: u32) -> bool {
        let mut sys = sysinfo::System::new();
        let target = sysinfo::Pid::from_u32(pid);
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[target]), true);
        sys.process(target).is_some()
    }

    fn wait_for_child_named(parent: u32, needle: &str, timeout: Duration) -> Option<u32> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if let Some((pid, _)) = child_pids_of(parent)
                .into_iter()
                .find(|(_, name)| name.to_lowercase().contains(needle))
            {
                return Some(pid);
            }
            if std::time::Instant::now() >= deadline {
                return None;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn wait_until_gone(pid: u32, timeout: Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if !pid_alive(pid) {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    struct TreeGuard(u32);

    impl Drop for TreeGuard {
        fn drop(&mut self) {
            kill_process_tree(self.0);
        }
    }

    #[test]
    fn tree_kill_terminates_grandchildren() {
        let mut parent = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Process -NoNewWindow -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 120'; Start-Sleep -Seconds 120",
            ])
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn parent powershell");
        let root = parent.id();
        let _guard = TreeGuard(root);

        let grandchild = wait_for_child_named(root, "powershell", Duration::from_secs(15))
            .expect("grandchild powershell never appeared under the parent");
        assert!(pid_alive(grandchild), "grandchild must be running before the kill");

        kill_process_tree(root);

        assert!(
            wait_until_gone(grandchild, Duration::from_secs(5)),
            "grandchild {grandchild} survived kill_process_tree({root}) — a pane kill that \
             leaves detached descendants alive also leaves their console host alive, which \
             keeps the ConPTY output pipe open and parks the session reader forever",
        );
        assert!(
            wait_until_gone(root, Duration::from_secs(5)),
            "root {root} survived kill_process_tree",
        );
        let _ = parent.wait();
    }

    #[test]
    fn terminate_after_child_exit_is_harmless() {
        let id = format!("test-terminate-dead-{}", std::process::id());
        spawn_inner(None, &id, None, Some("cmd"), None, None, true).expect("spawn cmd");
        thread::sleep(Duration::from_millis(500));
        let session = SESSIONS
            .read()
            .unwrap()
            .get(&id)
            .cloned()
            .expect("session registered");
        let shell_pid = session.pid;

        write(&id, "exit\r");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut exited = false;
        while std::time::Instant::now() < deadline {
            if matches!(session.child.lock().unwrap().try_wait(), Ok(Some(_))) {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        assert!(exited, "cmd should have exited on 'exit'");

        terminate(&session);
        assert!(wait_until_gone(shell_pid, Duration::from_secs(2)), "shell {shell_pid} should be gone");
        let _ = kill(&id);
    }
}
