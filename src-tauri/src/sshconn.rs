// In-process SSH sessions over the russh protocol stack. Replaces the old
// "spawn ssh.exe inside ConPTY" approach: one russh connection multiplexes the
// interactive shell channel plus periodic exec channels for the metrics
// monitor, and credentials come from UI modals (memory only, never persisted).
//
// Session contract mirrors pty.rs: same id space, same event names
// (`pty:data:<id>`, `pty:exit:<id>`), same write/resize/kill semantics, so the
// renderer needs no SSH-specific terminal handling.

use bytes::Bytes;
use futures::future::{AbortHandle, Abortable};
use russh::client::{self, AuthResult, Handle, KeyboardInteractiveAuthResponse, Msg};
use russh::keys::{self, PrivateKeyWithHashAlg, ssh_key};
use russh::{ChannelMsg, ChannelWriteHalf, MethodKind};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::oneshot;

use crate::ssh::SshTarget;

pub struct SshSession {
    writer: ChannelWriteHalf<Msg>,
    handle: Handle<PattyHandler>,
    metrics_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

static SESSIONS: LazyLock<RwLock<HashMap<String, Arc<SshSession>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static PENDING_HOSTKEY: LazyLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PENDING_AUTH: LazyLock<Mutex<HashMap<String, oneshot::Sender<Option<String>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// In-flight create() calls per session id. SSH creation spans multiple UI
// round-trips (host key, password), so a duplicate mount (React StrictMode
// double-invokes effects in dev) or a retry would otherwise race a second
// connection and clobber the per-id pending slots above.
static CREATING: LazyLock<Mutex<HashMap<String, AbortHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
// Per-id kill counter: lets a create that is *waiting* on an in-flight create
// notice that the pane was closed in the meantime.
static KILL_EPOCH: LazyLock<Mutex<HashMap<String, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn kill_epoch(id: &str) -> u64 {
    KILL_EPOCH.lock().unwrap().get(id).copied().unwrap_or(0)
}

// ── Event emission ──────────────────────────────────────────────────────────
// In unit/integration tests there is no AppHandle; emitted events are captured
// in TEST_EVENTS instead so tests can drive the auth/hostkey dialogs and read
// terminal output.

#[cfg(test)]
static TEST_EVENTS: LazyLock<Mutex<Vec<(String, String)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

fn emit(app: &Option<AppHandle>, event: &str, payload: impl serde::Serialize + Clone) {
    #[cfg(test)]
    if app.is_none() {
        TEST_EVENTS
            .lock()
            .unwrap()
            .push((event.to_string(), serde_json::to_string(&payload).unwrap()));
        return;
    }
    crate::pty::emit(app, event, payload);
}

// ── Handler (server key verification) ───────────────────────────────────────

pub struct PattyHandler {
    id: String,
    app: Option<AppHandle>,
    host: String,
    port: u16,
}

/// Application-level known_hosts (user's ~/.ssh/known_hosts is consulted
/// read-only; learned keys only ever land here).
fn app_known_hosts() -> PathBuf {
    #[cfg(test)]
    if let Some(p) = KNOWN_HOSTS_OVERRIDE.lock().unwrap().clone() {
        return p;
    }
    crate::store::data_dir().join("known_hosts")
}

#[cfg(test)]
static KNOWN_HOSTS_OVERRIDE: LazyLock<Mutex<Option<PathBuf>>> =
    LazyLock::new(|| Mutex::new(None));

fn user_known_hosts() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .ok()
        .map(|u| PathBuf::from(u).join(".ssh").join("known_hosts"))
}

impl client::Handler for PattyHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &ssh_key::PublicKey) -> Result<bool, Self::Error> {
        for path in [user_known_hosts(), Some(app_known_hosts())]
            .into_iter()
            .flatten()
        {
            if !path.exists() {
                continue;
            }
            match keys::known_hosts::check_known_hosts_path(&self.host, self.port, key, &path) {
                Ok(true) => return Ok(true),
                Err(keys::Error::KeyChanged { line }) => {
                    emit(
                        &self.app,
                        &format!("pty:data:{}", self.id),
                        format!(
                            "\r\n*** HOST KEY CHANGED (known_hosts line {line}) — connection refused, possible MITM ***\r\n"
                        ),
                    );
                    return Ok(false);
                }
                _ => {}
            }
        }

        // Unknown host: ask the UI, learn only into the app known_hosts.
        let (tx, rx) = oneshot::channel::<bool>();
        PENDING_HOSTKEY.lock().unwrap().insert(self.id.clone(), tx);
        emit(
            &self.app,
            "ssh:hostkey",
            json!([self.id, {
                "host": self.host,
                "port": self.port,
                "fingerprint": key.fingerprint(keys::HashAlg::Sha256).to_string(),
                "keyType": key.algorithm().to_string(),
            }]),
        );
        let trust = rx.await.unwrap_or(false);
        PENDING_HOSTKEY.lock().unwrap().remove(&self.id);
        if trust {
            if let Err(e) =
                keys::known_hosts::learn_known_hosts_path(&self.host, self.port, key, app_known_hosts())
            {
                eprintln!("[ssh] failed to record host key: {e}");
            }
        }
        Ok(trust)
    }
}

// ── Auth prompts (driven by renderer modals via global events) ──────────────

pub fn hostkey_respond(id: &str, trust: bool) {
    if let Some(tx) = PENDING_HOSTKEY.lock().unwrap().remove(id) {
        let _ = tx.send(trust);
    }
}

pub fn auth_respond(id: &str, secret: Option<String>) {
    if let Some(tx) = PENDING_AUTH.lock().unwrap().remove(id) {
        let _ = tx.send(secret);
    }
}

/// Ask the UI for a secret. `None` = user cancelled (or the channel died,
/// e.g. the session was killed mid-prompt).
async fn prompt_secret(app: &Option<AppHandle>, id: &str, info: Value) -> Option<String> {
    let (tx, rx) = oneshot::channel();
    PENDING_AUTH.lock().unwrap().insert(id.to_string(), tx);
    emit(app, "ssh:auth", json!([id, info]));
    let answer = rx.await.unwrap_or(None);
    PENDING_AUTH.lock().unwrap().remove(id);
    answer
}

async fn try_publickey(
    handle: &mut Handle<PattyHandler>,
    app: &Option<AppHandle>,
    id: &str,
    user: &str,
    path: &str,
) -> Result<bool, String> {
    let mut passphrase: Option<String> = None;
    let key = loop {
        match keys::load_secret_key(path, passphrase.as_deref()) {
            Ok(k) => break k,
            Err(keys::Error::KeyIsEncrypted) => {
                let answer = prompt_secret(
                    app,
                    id,
                    json!({
                        "kind": "passphrase",
                        "prompt": format!("Enter passphrase for key {path}:"),
                        "attempt": 1,
                    }),
                )
                .await;
                match answer {
                    Some(p) => passphrase = Some(p),
                    None => return Err("Authentication cancelled".into()),
                }
            }
            Err(e) => return Err(format!("Failed to load key {path}: {e}")),
        }
    };
    let hash_alg = if key.algorithm().is_rsa() {
        handle.best_supported_rsa_hash().await.ok().flatten().flatten()
    } else {
        None
    };
    let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
    match handle
        .authenticate_publickey(user, key)
        .await
        .map_err(|e| e.to_string())?
    {
        AuthResult::Success => Ok(true),
        AuthResult::Failure { .. } => Ok(false),
    }
}

async fn try_keyboard_interactive(
    handle: &mut Handle<PattyHandler>,
    user: &str,
    password: &str,
) -> Result<bool, String> {
    let mut response = handle
        .authenticate_keyboard_interactive_start(user, None::<String>)
        .await
        .map_err(|e| e.to_string())?;
    loop {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                // Typical servers ask for exactly one password prompt; answer
                // every prompt with the same password (echo-less prompts are
                // guaranteed by the modal).
                let answers = prompts.iter().map(|_| password.to_string()).collect();
                response = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }
}

async fn authenticate(
    handle: &mut Handle<PattyHandler>,
    app: &Option<AppHandle>,
    id: &str,
    target: &SshTarget,
    user: &str,
) -> Result<(), String> {
    if let Some(idf) = target
        .identity_file
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match try_publickey(handle, app, id, user, idf).await {
            Ok(true) => return Ok(()),
            Ok(false) => {} // key rejected — fall through to password
            Err(e) => return Err(e),
        }
    }

    for attempt in 1..=3 {
        let prompt = format!("{user}@{}'s password:", target.host);
        let Some(password) = prompt_secret(
            app,
            id,
            json!({ "kind": "password", "prompt": prompt, "attempt": attempt }),
        )
        .await
        else {
            return Err("Authentication cancelled".into());
        };
        match handle
            .authenticate_password(user, &password)
            .await
            .map_err(|e| e.to_string())?
        {
            AuthResult::Success => return Ok(()),
            AuthResult::Failure {
                remaining_methods, ..
            } => {
                if remaining_methods.contains(&MethodKind::Password) {
                    continue; // wrong password — retry (up to 3 attempts)
                }
                if remaining_methods.contains(&MethodKind::KeyboardInteractive)
                    && try_keyboard_interactive(handle, user, &password).await?
                {
                    return Ok(());
                }
                return Err("Authentication failed".into());
            }
        }
    }
    Err("Authentication failed (too many attempts)".into())
}

// ── Public session API (mirrors pty.rs) ─────────────────────────────────────

pub fn exists(id: &str) -> bool {
    SESSIONS.read().unwrap().contains_key(id)
}

pub fn write(id: &str, data: &str) {
    let session = SESSIONS.read().unwrap().get(id).cloned();
    if let Some(session) = session {
        let bytes = Bytes::copy_from_slice(data.as_bytes());
        tauri::async_runtime::spawn(async move {
            let _ = session.writer.data_bytes(bytes).await;
        });
    }
}

pub fn resize(id: &str, cols: u16, rows: u16) {
    let session = SESSIONS.read().unwrap().get(id).cloned();
    if let Some(session) = session {
        tauri::async_runtime::spawn(async move {
            let _ = session
                .writer
                .window_change(cols as u32, rows as u32, 0, 0)
                .await;
        });
    }
}

pub fn kill(id: &str) {
    *KILL_EPOCH.lock().unwrap().entry(id.to_string()).or_insert(0) += 1;
    if let Some(abort) = CREATING.lock().unwrap().remove(id) {
        abort.abort();
    }
    let victim = SESSIONS.write().unwrap().remove(id);
    crate::hooks::remove_pane(id);
    PENDING_AUTH.lock().unwrap().remove(id);
    PENDING_HOSTKEY.lock().unwrap().remove(id);
    if let Some(session) = victim {
        if let Some(task) = session.metrics_task.lock().unwrap().take() {
            task.abort();
        }
        tauri::async_runtime::spawn(async move {
            let _ = session.writer.close().await;
            let _ = session
                .handle
                .disconnect(russh::Disconnect::ByApplication, "", "")
                .await;
        });
    }
}

fn fail(app: &Option<AppHandle>, id: &str, error: String) -> Value {
    PENDING_AUTH.lock().unwrap().remove(id);
    PENDING_HOSTKEY.lock().unwrap().remove(id);
    emit(app, &format!("pty:data:{id}"), format!("Connection failed: {error}\r\n"));
    json!({ "pid": 0, "success": false, "error": error })
}

fn create_success() -> Value {
    json!({ "pid": std::process::id(), "success": true, "replay": Value::Null })
}

pub async fn create(
    app: Option<AppHandle>,
    id: &str,
    target: SshTarget,
    cols: u16,
    rows: u16,
) -> Value {
    // A create for this id is already in flight: wait for it instead of
    // racing a second connection. When it succeeds we attach to the same
    // session; when it fails (or was killed) we retry ourselves — unless the
    // pane was killed while we waited.
    let epoch = kill_epoch(id);
    let mut waited = false;
    while CREATING.lock().unwrap().contains_key(id) {
        waited = true;
        if exists(id) {
            return create_success();
        }
        if !CREATING.lock().unwrap().contains_key(id) {
            break;
        }
        if kill_epoch(id) != epoch {
            return json!({ "pid": 0, "success": false, "error": "cancelled" });
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if kill_epoch(id) != epoch {
        return json!({ "pid": 0, "success": false, "error": "cancelled" });
    }
    if waited {
        // The in-flight create settled while we waited: its session (if any)
        // is final — attach to it; only retry ourselves when it failed.
        if exists(id) {
            return create_success();
        }
    } else if exists(id) {
        kill(id);
    }

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    CREATING.lock().unwrap().insert(id.to_string(), abort_handle);
    let result = Abortable::new(create_inner(app, id, target, cols, rows), abort_registration).await;
    CREATING.lock().unwrap().remove(id);
    match result {
        Ok(value) => value,
        // Aborted by kill(): the pane is gone, nobody consumes this result.
        Err(_) => json!({ "pid": 0, "success": false, "error": "cancelled" }),
    }
}

async fn create_inner(
    app: Option<AppHandle>,
    id: &str,
    target: SshTarget,
    cols: u16,
    rows: u16,
) -> Value {

    let host = target.host.clone();
    let port = target.port.unwrap_or(22);
    let user = target
        .user
        .clone()
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .or_else(|| std::env::var("USERNAME").ok())
        .unwrap_or_else(|| "root".into());

    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(30)),
        nodelay: true,
        ..Default::default()
    });
    let handler = PattyHandler {
        id: id.to_string(),
        app: app.clone(),
        host: host.clone(),
        port,
    };

    let mut handle = match client::connect(config, (host.as_str(), port), handler).await {
        Ok(h) => h,
        Err(e) => return fail(&app, id, e.to_string()),
    };

    if let Err(e) = authenticate(&mut handle, &app, id, &target, &user).await {
        let _ = handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
        return fail(&app, id, e);
    }

    let channel = match handle.channel_open_session().await {
        Ok(c) => c,
        Err(e) => return fail(&app, id, e.to_string()),
    };
    if let Err(e) = channel
        .request_pty(false, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
        .await
    {
        return fail(&app, id, e.to_string());
    }
    if let Err(e) = channel.request_shell(false).await {
        return fail(&app, id, e.to_string());
    }
    let (mut read_half, write_half) = channel.split();

    let session = Arc::new(SshSession {
        writer: write_half,
        handle,
        metrics_task: Mutex::new(None),
    });
    SESSIONS.write().unwrap().insert(id.to_string(), session.clone());

    // Read loop: forward channel output as pty:data, report pty:exit at the
    // end. Only the still-registered session may report its exit — kill()
    // removes the entry first and must not trigger an exit event.
    let loop_id = id.to_string();
    let loop_app = app.clone();
    let loop_session = session.clone();
    tauri::async_runtime::spawn(async move {
        let mut carry: Vec<u8> = Vec::new();
        let mut exit_status: i64 = 0;
        while let Some(msg) = read_half.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    let text = crate::pty::decode(&mut carry, &data);
                    if !text.is_empty() {
                        emit(&loop_app, &format!("pty:data:{loop_id}"), text);
                    }
                }
                ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                    let text = crate::pty::decode(&mut carry, &data);
                    if !text.is_empty() {
                        emit(&loop_app, &format!("pty:data:{loop_id}"), text);
                    }
                }
                ChannelMsg::ExitStatus { exit_status: s } => exit_status = s as i64,
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {} // ChannelMsg is #[non_exhaustive]
            }
        }
        let still_registered = {
            let mut map = SESSIONS.write().unwrap();
            if map.get(&loop_id).is_some_and(|s| Arc::ptr_eq(s, &loop_session)) {
                map.remove(&loop_id);
                true
            } else {
                false
            }
        };
        if let Some(task) = loop_session.metrics_task.lock().unwrap().take() {
            task.abort();
        }
        if still_registered {
            crate::hooks::remove_pane(&loop_id);
            emit(&loop_app, &format!("pty:exit:{loop_id}"), exit_status);
        }
    });

    create_success()
}

// ── Remote metrics (exec channels multiplexed on the same connection) ───────

const STATS_CMD: &str = "echo CPU; head -1 /proc/stat; echo MEM; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo; echo NET; awk '!/lo:/{rx+=$2;tx+=$10}END{print rx,tx}' /proc/net/dev; echo DSK; df -Pk / | awk 'NR==2{print $2,$3}'";

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawStats {
    pub cpu_jiffies: [u64; 8],
    pub mem_total_kb: u64,
    pub mem_avail_kb: u64,
    pub swap_total_kb: u64,
    pub swap_free_kb: u64,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub disk_total_kb: u64,
    pub disk_used_kb: u64,
}

pub fn parse_stats(out: &str) -> Option<RawStats> {
    let mut section = "";
    let mut cpu: Option<[u64; 8]> = None;
    let (mut mem_total, mut mem_avail, mut swap_total, mut swap_free) =
        (None, None, None, None);
    let mut net: Option<(u64, u64)> = None;
    let mut dsk: Option<(u64, u64)> = None;

    for line in out.lines() {
        let line = line.trim();
        match line {
            "CPU" | "MEM" | "NET" | "DSK" => {
                section = line;
                continue;
            }
            _ => {}
        }
        if line.is_empty() {
            continue;
        }
        match section {
            "CPU" if line.starts_with("cpu") && cpu.is_none() => {
                let nums: Vec<u64> = line
                    .split_whitespace()
                    .skip(1)
                    .filter_map(|t| t.parse().ok())
                    .collect();
                if nums.len() < 8 {
                    return None;
                }
                let mut vals = [0u64; 8];
                vals.copy_from_slice(&nums[..8]);
                cpu = Some(vals);
            }
            "MEM" => {
                let mut parts = line.split_whitespace();
                let Some(key) = parts.next() else { continue };
                let Some(val) = parts.next().and_then(|v| v.parse::<u64>().ok()) else {
                    continue;
                };
                match key {
                    "MemTotal:" => mem_total = Some(val),
                    "MemAvailable:" => mem_avail = Some(val),
                    "SwapTotal:" => swap_total = Some(val),
                    "SwapFree:" => swap_free = Some(val),
                    _ => {}
                }
            }
            "NET" => {
                let mut parts = line.split_whitespace();
                if let (Some(rx), Some(tx)) = (
                    parts.next().and_then(|v| v.parse().ok()),
                    parts.next().and_then(|v| v.parse().ok()),
                ) {
                    net = Some((rx, tx));
                }
            }
            "DSK" => {
                let mut parts = line.split_whitespace();
                if let (Some(total), Some(used)) = (
                    parts.next().and_then(|v| v.parse().ok()),
                    parts.next().and_then(|v| v.parse().ok()),
                ) {
                    dsk = Some((total, used));
                }
            }
            _ => {}
        }
    }

    Some(RawStats {
        cpu_jiffies: cpu?,
        mem_total_kb: mem_total?,
        mem_avail_kb: mem_avail?,
        swap_total_kb: swap_total?,
        swap_free_kb: swap_free?,
        rx_bytes: net?.0,
        tx_bytes: net?.1,
        disk_total_kb: dsk?.0,
        disk_used_kb: dsk?.1,
    })
}

async fn collect_once(handle: &Handle<PattyHandler>) -> Result<Option<RawStats>, ()> {
    let mut channel = handle.channel_open_session().await.map_err(|_| ())?;
    channel.exec(false, STATS_CMD).await.map_err(|_| ())?;
    let mut out: Vec<u8> = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => out.extend_from_slice(&data),
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(parse_stats(&String::from_utf8_lossy(&out)))
}

pub fn metrics_start(app: Option<AppHandle>, id: &str) {
    let Some(session) = SESSIONS.read().unwrap().get(id).cloned() else {
        return;
    };
    // Idempotent: a restart aborts the previous loop.
    if let Some(task) = session.metrics_task.lock().unwrap().take() {
        task.abort();
    }
    let loop_id = id.to_string();
    let task_session = session.clone();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            match collect_once(&task_session.handle).await {
                Ok(Some(raw)) => emit(&app, &format!("ssh:metrics:{loop_id}"), raw),
                Ok(None) => {} // unparsable (e.g. non-Linux): skip silently
                Err(()) => {
                    // Connection is gone: report once and stop.
                    emit(&app, &format!("ssh:metrics:{loop_id}"), json!({ "stale": true }));
                    break;
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
    *session.metrics_task.lock().unwrap() = Some(task);
}

pub fn metrics_stop(id: &str) {
    if let Some(session) = SESSIONS.read().unwrap().get(id).cloned() {
        if let Some(task) = session.metrics_task.lock().unwrap().take() {
            task.abort();
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use russh::server::{self, Auth, ChannelOpenHandle, Server as _, Session as ServerSession};
    use russh::{Channel, ChannelId};

    const STATS_FIXTURE: &str = "CPU\ncpu  100 0 50 800 10 5 5 0 0 0\nMEM\nMemTotal:    16384000 kB\nMemAvailable: 8192000 kB\nSwapTotal:     2097152 kB\nSwapFree:      1048576 kB\nNET\n1000000 2000000\nDSK\n500000 250000\n";

    #[test]
    fn parse_stats_full_fixture() {
        let s = parse_stats(STATS_FIXTURE).expect("should parse");
        assert_eq!(s.cpu_jiffies, [100, 0, 50, 800, 10, 5, 5, 0]);
        assert_eq!(s.mem_total_kb, 16384000);
        assert_eq!(s.mem_avail_kb, 8192000);
        assert_eq!(s.swap_total_kb, 2097152);
        assert_eq!(s.swap_free_kb, 1048576);
        assert_eq!(s.rx_bytes, 1000000);
        assert_eq!(s.tx_bytes, 2000000);
        assert_eq!(s.disk_total_kb, 500000);
        assert_eq!(s.disk_used_kb, 250000);
    }

    #[test]
    fn parse_stats_missing_section_is_none() {
        let out = "CPU\ncpu  100 0 50 800 10 5 5 0\nMEM\nMemTotal: 100 kB\n";
        assert!(parse_stats(out).is_none());
    }

    #[test]
    fn parse_stats_garbage_is_none() {
        assert!(parse_stats("bash: echo: command not found\n").is_none());
        assert!(parse_stats("").is_none());
    }

    #[test]
    fn parse_stats_short_cpu_line_is_none() {
        let out = "CPU\ncpu  100 0 50\nMEM\nMemTotal: 1 kB\nMemAvailable: 1 kB\nSwapTotal: 1 kB\nSwapFree: 1 kB\nNET\n1 2\nDSK\n1 2\n";
        assert!(parse_stats(out).is_none());
    }

    // ── In-process russh server for integration tests ───────────────────────

    #[derive(Clone, Default)]
    struct TestServer;

    #[derive(Default)]
    struct TestServerHandler {
        log: Arc<Mutex<Vec<String>>>,
    }

    impl server::Server for TestServer {
        type Handler = TestServerHandler;
        fn new_client(&mut self, _addr: Option<std::net::SocketAddr>) -> TestServerHandler {
            TestServerHandler::default()
        }
    }

    impl server::Handler for TestServerHandler {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
            if user == "test" && password == "secret" {
                Ok(Auth::Accept)
            } else {
                Ok(Auth::reject())
            }
        }

        async fn channel_open_session(
            &mut self,
            _channel: Channel<server::Msg>,
            reply: ChannelOpenHandle,
            _session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn pty_request(
            &mut self,
            channel: ChannelId,
            _term: &str,
            _col_width: u32,
            _row_height: u32,
            _pix_width: u32,
            _pix_height: u32,
            _modes: &[(russh::Pty, u32)],
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            self.log.lock().unwrap().push("pty".into());
            session.channel_success(channel)?;
            Ok(())
        }

        async fn shell_request(
            &mut self,
            channel: ChannelId,
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            self.log.lock().unwrap().push("shell".into());
            session.channel_success(channel)?;
            Ok(())
        }

        async fn exec_request(
            &mut self,
            channel: ChannelId,
            _data: &[u8],
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            session.data(channel, STATS_FIXTURE.as_bytes().to_vec())?;
            session.eof(channel)?;
            session.exit_status_request(channel, 0)?;
            session.close(channel)?;
            Ok(())
        }

        async fn data(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut ServerSession,
        ) -> Result<(), Self::Error> {
            // Echo everything back, like a shell would.
            session.data(channel, data.to_vec())?;
            Ok(())
        }
    }

    // Integration tests share process-wide state (SESSIONS, PENDING_*, event
    // capture, known_hosts override): serialize them.
    static INTEGRATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    struct TestEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        id: String,
        port: u16,
        known_hosts: PathBuf,
    }

    async fn start_test_server() -> u16 {
        let config = Arc::new(server::Config {
            auth_rejection_time: Duration::from_millis(1),
            auth_rejection_time_initial: Some(Duration::from_millis(1)),
            keys: vec![keys::PrivateKey::random(&mut rand::rng(), keys::Algorithm::Ed25519)
                .unwrap()],
            ..Default::default()
        });
        let socket = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = socket.local_addr().unwrap().port();
        let mut server = TestServer;
        tokio::spawn(async move {
            let _ = server.run_on_socket(config, &socket).await;
        });
        port
    }

    async fn setup(name: &str) -> TestEnv {
        let guard = INTEGRATION_LOCK.lock().unwrap();
        TEST_EVENTS.lock().unwrap().clear();
        let id = format!("sshconn-test-{name}-{}", std::process::id());
        let dir = std::env::temp_dir().join(format!("patty-sshconn-test-{}", std::process::id()));
        let known_hosts = dir.join(format!("known_hosts-{name}"));
        *KNOWN_HOSTS_OVERRIDE.lock().unwrap() = Some(known_hosts.clone());
        let port = start_test_server().await;
        TestEnv { _guard: guard, id, port, known_hosts }
    }

    impl TestEnv {
        fn target(&self) -> SshTarget {
            SshTarget {
                host: "127.0.0.1".into(),
                port: Some(self.port),
                user: Some("test".into()),
                identity_file: None,
            }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            kill(&self.id);
            *KNOWN_HOSTS_OVERRIDE.lock().unwrap() = None;
            let _ = std::fs::remove_file(&self.known_hosts);
        }
    }

    /// Wait until an event with this name has been emitted, returning its
    /// payload. Drains nothing; repeated calls may return the same event.
    async fn wait_event(event: &str) -> String {
        for _ in 0..100 {
            {
                let events = TEST_EVENTS.lock().unwrap();
                if let Some((_, payload)) = events.iter().find(|(e, _)| e == event) {
                    return payload.clone();
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("timed out waiting for event {event}");
    }

    /// Respond to the next auth prompt with the given secret.
    async fn answer_auth(id: &str, secret: Option<&str>) {
        wait_event("ssh:auth").await;
        // Wait until the request is actually registered (event precedes await
        // by a hair in prompt_secret, but the map insert comes first).
        auth_respond(id, secret.map(str::to_string));
    }

    #[tokio::test]
    async fn connect_wrong_password_fails_after_retries() {
        let env = setup("badpass").await;
        let id = env.id.clone();
        let target = env.target();
        let task = tokio::spawn(async move { create(None, &id, target, 80, 24).await });

        wait_event("ssh:hostkey").await;
        hostkey_respond(&env.id, true);

        // Three password attempts, all wrong.
        for _ in 0..3 {
            wait_event("ssh:auth").await;
            auth_respond(&env.id, Some("wrong".into()));
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        let result = task.await.unwrap();
        assert_eq!(result["success"], false);
        let error = result["error"].as_str().unwrap();
        assert!(error.contains("Authentication failed"), "unexpected error: {error}");
        assert!(!exists(&env.id));
        // The failure text went to the terminal data stream.
        let data = wait_event(&format!("pty:data:{}", env.id)).await;
        assert!(data.contains("Connection failed"), "unexpected data: {data}");
    }

    #[tokio::test]
    async fn connect_echo_metrics_and_kill() {
        let env = setup("ok").await;
        let id = env.id.clone();
        let target = env.target();
        let task = tokio::spawn(async move { create(None, &id, target, 80, 24).await });

        wait_event("ssh:hostkey").await;
        hostkey_respond(&env.id, true);
        answer_auth(&env.id, Some("secret")).await;

        let result = task.await.unwrap();
        assert_eq!(result["success"], true, "create failed: {result}");
        assert!(result["pid"].as_u64().unwrap() > 0);
        assert!(exists(&env.id));

        // Trusted host key was learned into the app known_hosts.
        let learned = std::fs::read_to_string(&env.known_hosts).expect("known_hosts written");
        assert!(learned.contains("127.0.0.1"), "unexpected known_hosts: {learned}");

        // Terminal echo round-trip: write() goes out, server echoes, read
        // loop forwards it as pty:data.
        write(&env.id, "hello-sshconn");
        let mut echoed = false;
        for _ in 0..100 {
            {
                let events = TEST_EVENTS.lock().unwrap();
                if events
                    .iter()
                    .any(|(e, p)| e == &format!("pty:data:{}", env.id) && p.contains("hello-sshconn"))
                {
                    echoed = true;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(echoed, "expected echoed terminal output");

        // Metrics: one collection round emits parsed RawStats.
        metrics_start(None, &env.id);
        let payload = wait_event(&format!("ssh:metrics:{}", env.id)).await;
        let stats: Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(stats["memTotalKb"], 16384000);
        assert_eq!(stats["cpuJiffies"][3], 800);
        metrics_stop(&env.id);

        // Kill: registry cleared, subsequent ops are no-ops.
        kill(&env.id);
        assert!(!exists(&env.id));
        write(&env.id, "ignored");
        resize(&env.id, 120, 40);
        metrics_stop(&env.id);
    }

    #[tokio::test]
    async fn connect_auth_cancel_fails_cleanly() {
        let env = setup("cancel").await;
        let id = env.id.clone();
        let target = env.target();
        let task = tokio::spawn(async move { create(None, &id, target, 80, 24).await });

        wait_event("ssh:hostkey").await;
        hostkey_respond(&env.id, true);
        wait_event("ssh:auth").await;
        auth_respond(&env.id, None); // user pressed Cancel

        let result = task.await.unwrap();
        assert_eq!(result["success"], false);
        assert!(result["error"].as_str().unwrap().contains("cancelled"));
        assert!(!exists(&env.id));
    }

    // ── StrictMode / duplicate-create serialization ───────────────────────

    #[tokio::test]
    async fn kill_during_pending_create_aborts_and_recreate_succeeds() {
        let env = setup("strictmode").await;
        let id = env.id.clone();
        let target = env.target();
        let first = tokio::spawn(async move { create(None, &id, target, 80, 24).await });

        // First mount: host key prompt is pending when the "cleanup" kills.
        wait_event("ssh:hostkey").await;
        kill(&env.id);
        let result1 = first.await.unwrap();
        assert_eq!(result1["success"], false, "killed create must fail: {result1}");
        assert!(!exists(&env.id));

        // The remount creates again: exactly one connection, one prompt flow.
        TEST_EVENTS.lock().unwrap().clear();
        let id2 = env.id.clone();
        let target2 = env.target();
        let second = tokio::spawn(async move { create(None, &id2, target2, 80, 24).await });
        wait_event("ssh:hostkey").await;
        hostkey_respond(&env.id, true);
        wait_event("ssh:auth").await;
        auth_respond(&env.id, Some("secret".into()));
        let result2 = second.await.unwrap();
        assert_eq!(result2["success"], true, "recreate failed: {result2}");
        assert!(exists(&env.id));
    }

    #[tokio::test]
    async fn concurrent_create_waits_and_attaches_to_in_flight() {
        let env = setup("dupe").await;
        let id1 = env.id.clone();
        let target1 = env.target();
        let first = tokio::spawn(async move { create(None, &id1, target1, 80, 24).await });

        // Second create while the first still waits for the host key answer:
        // it must wait, not race a parallel connection.
        wait_event("ssh:hostkey").await;
        let id2 = env.id.clone();
        let target2 = env.target();
        let second = tokio::spawn(async move { create(None, &id2, target2, 80, 24).await });
        tokio::time::sleep(Duration::from_millis(100)).await;

        hostkey_respond(&env.id, true);
        wait_event("ssh:auth").await;
        auth_respond(&env.id, Some("secret".into()));

        let result1 = first.await.unwrap();
        let result2 = second.await.unwrap();
        assert_eq!(result1["success"], true, "first create failed: {result1}");
        assert_eq!(result2["success"], true, "attach failed: {result2}");
        // One prompt sequence total — the duplicate never opened a connection.
        let events = TEST_EVENTS.lock().unwrap();
        assert_eq!(events.iter().filter(|(e, _)| e == "ssh:hostkey").count(), 1);
        assert_eq!(events.iter().filter(|(e, _)| e == "ssh:auth").count(), 1);
    }

    #[tokio::test]
    async fn connect_hostkey_rejected_fails() {
        let env = setup("distrust").await;
        let id = env.id.clone();
        let target = env.target();
        let task = tokio::spawn(async move { create(None, &id, target, 80, 24).await });

        wait_event("ssh:hostkey").await;
        hostkey_respond(&env.id, false);

        let result = task.await.unwrap();
        assert_eq!(result["success"], false);
        assert!(!exists(&env.id));
        // Key must NOT have been learned.
        assert!(!env.known_hosts.exists());
    }
}
