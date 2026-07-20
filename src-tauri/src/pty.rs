use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
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
    buffer: Mutex<Vec<String>>,
    app: Option<AppHandle>,
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

static SESSIONS: LazyLock<Mutex<HashMap<String, Arc<Session>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// Serializes the check-then-spawn sequence in create() and warm(). Startup
// warming runs on a background thread, so without this a renderer create()
// and a warm() for the same id could both pass the map check and spawn two
// PTYs — the loser leaks and duplicates output onto the shared event channel.
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

fn emit(app: &Option<AppHandle>, event: &str, payload: impl serde::Serialize + Clone) {
    if let Some(app) = app {
        let _ = app.emit(event, payload);
    }
}

// ── Shell resolution ────────────────────────────────────────────────────────

fn shell_paths(name: &str) -> Option<&'static str> {
    match name {
        "powershell" => Some(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
        "cmd" => Some(r"C:\Windows\System32\cmd.exe"),
        "gitbash" => Some(r"C:\Program Files\Git\bin\bash.exe"),
        "wsl" => Some(r"C:\Windows\System32\wsl.exe"),
        _ => None,
    }
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
    if let Some(path) = shell_paths(&key) {
        if Path::new(path).exists() {
            return path.to_string();
        }
    }
    detect_default_shell()
}

pub fn detect_shells() -> Value {
    let pwsh = find_pwsh();
    let mut shells = vec![json!({
        "name": "pwsh",
        "path": pwsh.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "pwsh (not found)".to_string()),
        "available": pwsh.is_some()
    })];
    for name in ["powershell", "cmd", "gitbash", "wsl"] {
        let path = shell_paths(name).unwrap();
        shells.push(json!({
            "name": name,
            "path": path,
            "available": Path::new(path).exists()
        }));
    }
    Value::Array(shells)
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

fn shell_spawn_args(shell_path: &str) -> Vec<String> {
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

fn decode(carry: &mut Vec<u8>, chunk: &[u8]) -> String {
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

enum DsrState {
    /// Candidate prefix of the query seen so far.
    Pending(String),
    Done,
}

const DSR_QUERY: &str = "\x1b[6n";
const DSR_REPLY: &[u8] = b"\x1b[1;1R";

/// Returns the text to forward (None = hold for the next chunk) and whether to
/// send the reply. Only inspects the stream start: a chunk that isn't a prefix
/// of the query ends interception.
fn dsr_filter(state: &mut DsrState, text: &str) -> (Option<String>, bool) {
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

// ── Reader / waiter threads ─────────────────────────────────────────────────

fn reader_loop(id: String, session: Arc<Session>, mut reader: Box<dyn Read + Send>) {
    let shared = session.shared.clone();
    let mut carry: Vec<u8> = Vec::new();
    let mut dsr = DsrState::Pending(String::new());
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let text = decode(&mut carry, &buf[..n]);
                if text.is_empty() {
                    continue;
                }
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
                    shared.buffer.lock().unwrap().push(text);
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
                Err(_) => break 0,
            }
        }
        thread::sleep(Duration::from_millis(150));
    };

    // Only the session still registered under this id may report its exit —
    // a replaced pty must not delete its successor or emit a stale event.
    let app = {
        let mut map = SESSIONS.lock().unwrap();
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
    cmd.env("PATTY_PANE_ID", id);
    cmd.env("PATTY_PORT", crate::hooks::hook_port().to_string());
    cmd.env("PATTY_HOOK_SECRET", crate::hooks::hook_secret());
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
        buffer: Mutex::new(Vec::new()),
        app: app.cloned(),
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
    SESSIONS.lock().unwrap().insert(id.to_string(), session.clone());

    let reader_id = id.to_string();
    let reader_session = session.clone();
    thread::spawn(move || reader_loop(reader_id, reader_session, reader));

    let wait_id = id.to_string();
    thread::spawn(move || wait_loop(wait_id, child));

    Ok(pid)
}

fn take_buffer(shared: &Shared) -> Option<String> {
    let chunks = std::mem::take(&mut *shared.buffer.lock().unwrap());
    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join(""))
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
    let _spawn_guard = SPAWN_LOCK.lock().unwrap();
    // Reattach to a preheated session when cwd/shell match.
    let mut map = SESSIONS.lock().unwrap();
    if let Some(existing) = map.get(id) {
        let matches = existing.cwd.as_deref() == cwd && existing.shell.as_deref() == shell;
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
    let _spawn_guard = SPAWN_LOCK.lock().unwrap();
    if SESSIONS.lock().unwrap().contains_key(id) {
        return;
    }
    if let Err(e) = spawn_inner(Some(app), id, cwd, shell, None, None, false) {
        eprintln!("[pty] failed to warm {id}: {e}");
    }
}

/// Warm the active workspace's pane-tree leaves at startup (mirrors the
/// Electron boot sequence).
pub fn warm_startup(app: &AppHandle) {
    let state = crate::store::load_state();
    let Some(active_id) = state.get("activeWorkspaceId").and_then(Value::as_str) else {
        return;
    };
    let Some(workspace) = state
        .get("workspaces")
        .and_then(Value::as_array)
        .and_then(|arr| arr.iter().find(|w| w.get("id").and_then(Value::as_str) == Some(active_id)))
    else {
        return;
    };
    let Some(tree) = workspace.get("paneTree") else { return };
    let empty = Vec::new();
    let sessions = state.get("sessions").and_then(Value::as_array).unwrap_or(&empty);
    for leaf_id in leaf_session_ids(tree) {
        let found = sessions
            .iter()
            .find(|s| s.get("id").and_then(Value::as_str) == Some(leaf_id.as_str()));
        let cwd = found.and_then(|s| s.get("cwd")).and_then(Value::as_str);
        let shell = found.and_then(|s| s.get("shell")).and_then(Value::as_str);
        warm(app, &leaf_id, cwd, shell);
    }
}

fn leaf_session_ids(tree: &Value) -> Vec<String> {
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
    let session = SESSIONS.lock().unwrap().get(id).cloned();
    if let Some(session) = session {
        let mut writer = session.writer.lock().unwrap();
        // PTY may have exited; ignore write errors (EPIPE), same as before.
        let _ = writer.write_all(data.as_bytes());
        let _ = writer.flush();
    }
}

pub fn resize(id: &str, cols: u16, rows: u16) {
    let session = SESSIONS.lock().unwrap().get(id).cloned();
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
    let victim = SESSIONS.lock().unwrap().remove(id);
    if let Some(session) = victim {
        let _ = session.child.lock().unwrap().kill();
    }
    crate::hooks::remove_pane(id);
    json!({ "success": true })
}

pub fn session_exists(id: &str) -> bool {
    SESSIONS.lock().unwrap().contains_key(id)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn shell_args_inject_integration_for_powershell() {
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
    fn spawn_echo_and_exit_cleanup() {
        // Real ConPTY round-trip: unattached session buffers output; exit
        // removes the session from the registry.
        let id = format!("test-{}", std::process::id());
        let pid = spawn_inner(None, &id, None, Some("cmd"), None, None, false)
            .expect("spawn cmd");
        assert!(pid > 0);
        thread::sleep(Duration::from_millis(500));
        {
            let map = SESSIONS.lock().unwrap();
            let session = map.get(&id).expect("session registered");
            let buffered = session.shared.buffer.lock().unwrap().join("");
            assert!(!buffered.is_empty(), "expected some shell banner output");
        }
        // ConPTY's startup DSR query is answered by dsr_filter internally;
        // `exit` then ends cmd and the wait loop must evict the session.
        write(&id, "exit\r");
        let mut gone = false;
        for _ in 0..40 {
            if !SESSIONS.lock().unwrap().contains_key(&id) {
                gone = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        assert!(gone, "session should be removed after shell exit");
    }
}
