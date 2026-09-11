use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// ── Heartbeat lease tracking ────────────────────────────────────────────────
// 已知限制（与 TS 版一致）：claude-code / codex 在纯文本、无工具调用的超长回复
// 期间不触发任何 hook 事件，火焰可能在回复结束前熄灭，下次 hook 事件自愈。

fn heartbeat_timeout_ms(source: &str) -> Option<u64> {
    match source {
        "opencode" => Some(8_000),
        "omp" => Some(8_000),
        "claude-code" => Some(600_000),
        "codex" => Some(600_000),
        _ => None,
    }
}

pub struct ActiveEntry {
    source: String,
    last_seen: u64,
}

static ACTIVE: LazyLock<Mutex<HashMap<String, ActiveEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn note_event_with_now(pane_id: &str, event: &str, source: &str, role: &str, now: u64) {
    if heartbeat_timeout_ms(source).is_none() {
        eprintln!("[heartbeat] unknown source \"{source}\", ignoring event \"{event}\"");
        return;
    }
    let mut active = ACTIVE.lock().unwrap();
    if role == "subagent" {
        // 子 agent 事件只是存活证据：续期已存在的租约，绝不开/关/重建——
        // subagent 的生命周期不代表顶层会话（opencode 子 session 的
        // session.deleted 不得在主卧约上关火）。
        if let Some(entry) = active.get_mut(pane_id) {
            entry.last_seen = now;
            entry.source = source.to_string();
        }
        return;
    }
    match event {
        "session_start" | "session_created" => {
            active.insert(pane_id.to_string(), ActiveEntry { source: source.to_string(), last_seen: now });
        }
        "session_end" | "session_deleted" => {
            active.remove(pane_id);
        }
        // 纯心跳只刷新已存在的租约，绝不重建：opencode 1.18 退出 TUI 后其服务
        // 进程还会存活一段时间并持续发 alive，若心跳能重建租约，火焰在工具
        // 退出后永远无法熄灭。
        "alive" => {
            if let Some(entry) = active.get_mut(pane_id) {
                entry.last_seen = now;
                entry.source = source.to_string();
            }
        }
        _ => {
            // 任何来自已知 source 的事件都是存活证据：租约被 session_deleted /
            // 看门狗清除后，迟到的事件（退出时 session_deleted 与 idle 的投递
            // 竞态、claude/codex 超长回复间隙）必须重新打开租约。否则前端火焰
            // 会被 attention 事件重新点亮，看门狗却永远扫不到这个 pane →
            // 火焰永久卡死。
            match active.get_mut(pane_id) {
                Some(entry) => {
                    entry.last_seen = now;
                    entry.source = source.to_string();
                }
                None => {
                    active.insert(pane_id.to_string(), ActiveEntry { source: source.to_string(), last_seen: now });
                }
            }
        }
    }
}

pub fn note_event(pane_id: &str, event: &str, source: &str, role: &str) {
    note_event_with_now(pane_id, event, source, role, now_ms());
}

pub fn remove_pane(pane_id: &str) {
    ACTIVE.lock().unwrap().remove(pane_id);
}

fn collect_expired_with_now(active: &HashMap<String, ActiveEntry>, now: u64) -> Vec<String> {
    active
        .iter()
        .filter(|(_, e)| {
            heartbeat_timeout_ms(&e.source).is_some_and(|t| now.saturating_sub(e.last_seen) > t)
        })
        .map(|(id, _)| id.clone())
        .collect()
}

pub fn start_heartbeat_watchdog(app: AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(5));
            let expired = {
                let mut active = ACTIVE.lock().unwrap();
                let expired = collect_expired_with_now(&active, now_ms());
                for id in &expired {
                    active.remove(id);
                }
                expired
            };
            for id in expired {
                if let Err(e) = app.emit("pty:attn", (id, Value::Null, Value::Null)) {
                    eprintln!("[hooks] emit pty:attn failed: {e}");
                }
            }
        }
    });
}

// ── Attention event mapping ─────────────────────────────────────────────────

fn map_event_to_attention_type(event: &str) -> Option<&'static str> {
    // 权限请求/询问问题 → 蓝色
    if event == "permission_prompt"
        || event == "elicitation_dialog"
        || event == "idle_prompt"
        || event.contains("permission")
        || event.contains("question")
    {
        return Some("permission");
    }
    // 回答完毕 → 绿色
    if event == "idle" || event == "stop" {
        return Some("complete");
    }
    // 执行出错 → 红色
    if event == "error" || event.starts_with("error_") {
        return Some("error");
    }
    None
}

fn map_source_to_ai_type(source: &str) -> Option<&'static str> {
    match source {
        "claude-code" => Some("claude"),
        "opencode" => Some("opencode"),
        "codex" => Some("codex"),
        "omp" => Some("omp"),
        _ => None,
    }
}

pub fn on_hook_request(app: &AppHandle, pane_id: &str, event: &str, source: &str, role: &str) {
    note_event(pane_id, event, source, role);

    let settings = crate::store::load_settings();
    let enabled = match source {
        "claude-code" => settings["notifications"]["claudeCode"].as_bool().unwrap_or(true),
        "opencode" => settings["notifications"]["openCode"].as_bool().unwrap_or(true),
        "codex" => settings["notifications"]["codex"].as_bool().unwrap_or(true),
        "omp" => settings["notifications"]["ohMyPi"].as_bool().unwrap_or(true),
        _ => true,
    };
    let events = compute_hook_events(pane_id, event, source, role, enabled);
    for (evt, payload) in events {
        if let Err(e) = app.emit(evt, payload) {
            eprintln!("[hooks] emit {evt} failed: {e}");
        }
    }
}

/// Pure event computation for a hook request — no Tauri dependency.
/// Returns a list of (event_name, payload) to emit; empty = nothing to do.
/// 入口层不变量：role=subagent 的事件零 emit（租约侧处理见 note_event）。
fn compute_hook_events<'a>(
    pane_id: &'a str,
    event: &'a str,
    source: &'a str,
    role: &'a str,
    enabled: bool,
) -> Vec<(&'a str, Value)> {
    if role == "subagent" {
        return vec![];
    }
    let pane = pane_id.to_string();

    if event == "session_end" || event == "session_deleted" {
        return vec![("pty:attn", json!((pane, Value::Null, Value::Null)))];
    }
    if !enabled {
        return vec![];
    }

    let ai_type = map_source_to_ai_type(source);
    match event {
        "session_start" | "session_created" => {
            vec![("pty:attn", json!((pane, Value::Null, ai_type)))]
        }
        _ => map_event_to_attention_type(event)
            .map(|kind| vec![("pty:attn", json!((pane, kind, ai_type)))])
            .unwrap_or_default(),
    }
}

// ── Hook HTTP server ────────────────────────────────────────────────────────
// Loopback-only, random per-process secret injected into every PTY's env; the
// shell integration must present it on POST or gets a 401 (same as the TS版).

static HOOK_SECRET: OnceLock<String> = OnceLock::new();
static HOOK_PORT: AtomicU16 = AtomicU16::new(0);

pub fn hook_secret() -> &'static str {
    HOOK_SECRET.get_or_init(|| {
        let mut buf = [0u8; 32];
        getrandom::fill(&mut buf).expect("system rng");
        buf.iter().map(|b| format!("{b:02x}")).collect()
    })
}

pub fn hook_port() -> u16 {
    HOOK_PORT.load(Ordering::Relaxed)
}

/// Start the hook server on 127.0.0.1 with an ephemeral port. The handler runs
/// on a server thread; session validation re-checks the PTY registry per call.
pub fn start_hook_server(app: AppHandle) -> Result<u16, String> {
    if hook_port() != 0 {
        return Ok(hook_port());
    }
    let secret = hook_secret().to_string();
    let server = std::sync::Arc::new(tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?);
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("failed to get hook server port")?;
    HOOK_PORT.store(port, Ordering::Relaxed);
    eprintln!("[hook-server] listening on 127.0.0.1:{port}");

    // Small worker pool pulling from the shared request queue: hook bursts
    // from multiple AI tools no longer queue behind one sequential loop.
    for _ in 0..4 {
        let server = server.clone();
        let app = app.clone();
        let secret = secret.clone();
        thread::spawn(move || {
            for mut request in server.incoming_requests() {
                let response = handle_request(&app, &mut request, &secret);
                let _ = request.respond(response);
            }
        });
    }
    Ok(port)
}

fn handle_request(
    app: &AppHandle,
    request: &mut tiny_http::Request,
    secret: &str,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let json_response = |status: u16, body: Value| {
        tiny_http::Response::from_string(body.to_string())
            .with_status_code(status)
            .with_header(
                tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap(),
            )
    };

    // GET /image-rows?pane=<id>&secret=<s> — shell-integration poll for the
    // ConPTY cursor repair: rows of inline images the shell hasn't compensated
    // for yet. Only reads per-session counters; no body, no side effects
    // beyond consuming the row count when nothing is mid-stream.
    if request.method() == &tiny_http::Method::Get {
        if let Some((status, body)) =
            evaluate_image_rows_query(request.url(), secret, crate::pty::take_image_rows)
        {
            return json_response(status, body);
        }
        return tiny_http::Response::from_string(String::new()).with_status_code(404);
    }
    if request.method() != &tiny_http::Method::Post || request.url() != "/hook" {
        return tiny_http::Response::from_string(String::new()).with_status_code(404);
    }

    // Cap the request body: hook payloads are a few hundred bytes, so anything
    // bigger is a malfunctioning local process, not an event (loopback +
    // secret already gate this endpoint; this is just resource hygiene).
    const MAX_HOOK_BODY: u64 = 16 * 1024;
    if request.body_length().is_some_and(|len| len as u64 > MAX_HOOK_BODY) {
        return tiny_http::Response::from_string(String::new()).with_status_code(413);
    }
    let mut body = String::new();
    // as_reader() is &mut dyn Read; UFCS keeps Self = the sized reference so
    // Read::take (which requires Self: Sized) applies.
    let mut reader = request.as_reader();
    if std::io::Read::take(&mut reader, MAX_HOOK_BODY)
        .read_to_string(&mut body)
        .is_err()
    {
        return tiny_http::Response::from_string(String::new()).with_status_code(400);
    }
    let (status, payload, forward) = evaluate_hook_body(secret, &body, crate::pty::session_exists);
    if status == 400 {
        return tiny_http::Response::from_string(String::new()).with_status_code(400);
    }
    if let Some((pane_id, event, source, role)) = forward {
        on_hook_request(app, &pane_id, &event, &source, &role);
    } else if payload.get("ignored").and_then(Value::as_bool) == Some(true) {
        let pane = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.get("paneId").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default();
        eprintln!("[hooks] ignored hook pane={pane} reason=no live PTY session for this pane id");
    }
    json_response(status, payload)
}

/// Pure hook-request evaluation, split from the tiny_http plumbing so the
/// Pure evaluation for GET /image-rows, mirroring evaluate_hook_body's
/// testable-without-tiny_http pattern. `take` reads (and, when nothing is
/// mid-stream, clears) the session's uncompensated inline-image rows.
/// Returns None when the URL isn't the image-rows route.
fn evaluate_image_rows_query(
    url: &str,
    secret: &str,
    take: impl FnOnce(&str) -> Option<(u32, bool)>,
) -> Option<(u16, Value)> {
    let query = url.strip_prefix("/image-rows?")?;
    let mut pane = "";
    let mut given = "";
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            match k {
                "pane" => pane = v,
                "secret" => given = v,
                _ => {}
            }
        }
    }
    // ids are uuids and the secret is hex — neither needs URL-decoding
    if given != secret {
        return Some((401, json!({ "ok": false, "error": "unauthorized" })));
    }
    let (rows, pending) = take(pane).unwrap_or((0, false));
    Some((200, json!({ "rows": rows, "pending": pending })))
}

/// Pure hook-request evaluation, split from the tiny_http plumbing so the
/// auth/validation contract is directly unit-testable. Returns the HTTP
/// status, response payload, and — for valid requests — the
/// (pane_id, event, source, role) tuple to forward to on_hook_request.
fn evaluate_hook_body(
    secret: &str,
    body: &str,
    session_exists: impl Fn(&str) -> bool,
) -> (u16, Value, Option<(String, String, String, String)>) {
    let Ok(data) = serde_json::from_str::<Value>(body) else {
        return (400, Value::Null, None);
    };
    // Authenticate: reject any caller that can't present the per-process secret.
    if data.get("secret").and_then(Value::as_str) != Some(secret) {
        return (401, json!({ "ok": false, "error": "unauthorized" }), None);
    }
    // role 是线格式 v2 的可选字段：缺省 main（旧适配器无感）；显式给出却
    // 不在词汇表内则 fail-closed 拒绝——未知角色不得被当 main 亮灯。
    let role = match data.get("role") {
        None | Some(Value::Null) => "main",
        Some(Value::String(s)) if s == "main" || s == "subagent" => s.as_str(),
        _ => return (400, Value::Null, None),
    };
    let pane_id = data.get("paneId").and_then(Value::as_str).unwrap_or("");
    let event = data.get("event").and_then(Value::as_str).unwrap_or("");
    let source = data.get("source").and_then(Value::as_str).unwrap_or("unknown");
    // Validate session exists
    if !session_exists(pane_id) {
        return (200, json!({ "ok": true, "ignored": true }), None);
    }
    (
        200,
        json!({ "ok": true }),
        Some((pane_id.to_string(), event.to_string(), source.to_string(), role.to_string())),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    #[test]
    fn heartbeat_lease_lifecycle() {
        let pane = format!("hb-{}", std::process::id());
        note_event_with_now(&pane, "session_start", "opencode", "main", 1000);
        assert!(ACTIVE.lock().unwrap().contains_key(&pane));
        note_event_with_now(&pane, "post_tool_use", "opencode", "main", 2000);
        note_event_with_now(&pane, "session_end", "opencode", "main", 3000);
        assert!(!ACTIVE.lock().unwrap().contains_key(&pane));
    }

    #[test]
    fn heartbeat_lease_reopens_on_late_event() {
        // 退出竞态：session_deleted（detached curl）先于最后的 idle（普通 fetch）
        // 到达。idle 会经 pty:attn 重新点亮前端火焰，租约必须随之重新打开，
        // 否则看门狗扫不到该 pane → 火焰永久卡死。
        let pane = format!("hb-reopen-{}", std::process::id());
        note_event_with_now(&pane, "session_created", "opencode", "main", 1000);
        note_event_with_now(&pane, "session_deleted", "opencode", "main", 2000);
        assert!(!ACTIVE.lock().unwrap().contains_key(&pane));

        note_event_with_now(&pane, "idle", "opencode", "main", 3000);
        assert!(
            ACTIVE.lock().unwrap().contains_key(&pane),
            "late event after session_deleted must reopen the lease"
        );

        // 进程已死、无后续事件：8s 租约到期后看门狗必须能扫到并清除。
        let expired = {
            let active = ACTIVE.lock().unwrap();
            collect_expired_with_now(&active, 3000 + 8_001)
        };
        assert!(expired.contains(&pane));
        ACTIVE.lock().unwrap().remove(&pane);
    }

    #[test]
    fn heartbeat_alive_does_not_reopen_lease() {
        // opencode 1.18 退出 TUI 后服务器进程仍存活并持续发 alive；
        // 纯心跳不得重建已被清除的租约，否则火焰永不熄灭。
        let pane = format!("hb-alive-{}", std::process::id());
        note_event_with_now(&pane, "session_created", "opencode", "main", 1000);
        note_event_with_now(&pane, "session_deleted", "opencode", "main", 2000);
        note_event_with_now(&pane, "alive", "opencode", "main", 3000);
        assert!(
            !ACTIVE.lock().unwrap().contains_key(&pane),
            "alive must not reopen a cleared lease"
        );

        // 但已有租约必须被 alive 正常续期。
        note_event_with_now(&pane, "session_created", "opencode", "main", 4000);
        note_event_with_now(&pane, "alive", "opencode", "main", 5000);
        let expired = {
            let active = ACTIVE.lock().unwrap();
            collect_expired_with_now(&active, 13_000)
        };
        assert!(!expired.contains(&pane), "alive must refresh an existing lease");
        ACTIVE.lock().unwrap().remove(&pane);
    }

    #[test]
    fn heartbeat_unknown_source_ignored() {
        let pane = format!("hb-unknown-{}", std::process::id());
        note_event_with_now(&pane, "session_start", "not-a-tool", "main", 1000);
        assert!(!ACTIVE.lock().unwrap().contains_key(&pane));
    }

    #[test]
    fn heartbeat_expiry_collection() {
        let mut active = HashMap::new();
        active.insert("a".to_string(), ActiveEntry { source: "opencode".into(), last_seen: 1000 });
        active.insert("b".to_string(), ActiveEntry { source: "codex".into(), last_seen: 1000 });
        // opencode times out at 8s, codex at 600s.
        let expired = collect_expired_with_now(&active, 20_000);
        assert_eq!(expired, vec!["a".to_string()]);
        // At 599_999, codex (600s) is still alive; opencode is long gone.
        let later = collect_expired_with_now(&active, 599_999);
        assert!(!later.contains(&"b".to_string()));
    }

    #[test]
    fn compute_events_session_end_clears_ai_type() {
        let events = compute_hook_events("p1", "session_end", "opencode", "main", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "pty:attn");
        assert_eq!(events[0].1[0], "p1");
        assert!(events[0].1[1].is_null());
        assert!(events[0].1[2].is_null());
    }

    #[test]
    fn compute_events_session_end_ignores_enabled_flag() {
        let events = compute_hook_events("p1", "session_end", "opencode", "main", false);
        assert_eq!(events.len(), 1, "session_end clears ai even when disabled");
    }

    #[test]
    fn compute_events_disabled_source_returns_nothing() {
        let events = compute_hook_events("p1", "idle", "opencode", "main", false);
        assert!(events.is_empty());
    }

    #[test]
    fn compute_events_session_start_sets_ai_type() {
        let events = compute_hook_events("p1", "session_start", "opencode", "main", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[2], "opencode");
    }

    #[test]
    fn compute_events_session_start_with_codex() {
        let events = compute_hook_events("p1", "session_start", "codex", "main", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[2], "codex");
    }

    #[test]
    fn compute_events_session_start_with_omp() {
        let events = compute_hook_events("p1", "session_start", "omp", "main", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[2], "omp");
    }

    #[test]
    fn compute_events_permission_maps_to_attention() {
        let events = compute_hook_events("p1", "permission_prompt", "claude-code", "main", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[1], "permission");
        assert_eq!(events[0].1[2], "claude");
    }

    #[test]
    fn compute_events_idle_prompt_maps_to_permission() {
        let events = compute_hook_events("p1", "idle_prompt", "claude-code", "main", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[1], "permission");
        assert_eq!(events[0].1[2], "claude");
    }

    #[test]
    fn compute_events_unknown_source_sets_null_ai_type() {
        let events = compute_hook_events("p1", "idle", "unknown-tool", "main", true);
        assert_eq!(events.len(), 1);
        assert!(events[0].1[2].is_null());
    }

    #[test]
    fn compute_events_unknown_event_returns_nothing() {
        let events = compute_hook_events("p1", "post_tool_use", "opencode", "main", true);
        assert!(events.is_empty());
    }

    #[test]
    fn compute_events_error_event_maps_to_error_attention() {
        let events = compute_hook_events("p1", "error_rate_limit", "opencode", "main", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[1], "error");
    }

    #[test]
    fn attention_type_mapping() {
        assert_eq!(map_event_to_attention_type("permission_prompt"), Some("permission"));
        assert_eq!(map_event_to_attention_type("elicitation_dialog"), Some("permission"));
        // Claude 空闲等待输入 >60s 的 idle_prompt 与权限请求同属"需要用户介入"。
        assert_eq!(map_event_to_attention_type("idle_prompt"), Some("permission"));
        assert_eq!(map_event_to_attention_type("idle"), Some("complete"));
        assert_eq!(map_event_to_attention_type("error_rate_limit"), Some("error"));
        assert_eq!(map_event_to_attention_type("post_tool_use"), None);
    }

    #[test]
    fn event_vocabulary_matches_shared_protocol() {
        // resources/hook-protocol.json 是所有 AI CLI 适配器与后端共享的事件
        // 词汇单一事实源；适配器侧由 resources/__tests__ 的契约测试消费。
        // 任何一侧漂移（新增/改名/映射变化）都必须红测试，而不是让指示灯
        // 静默熄灭。
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../resources/hook-protocol.json");
        let raw = std::fs::read_to_string(path).expect("hook-protocol.json must be readable");
        let protocol: Value = serde_json::from_str(&raw).expect("hook-protocol.json must parse");

        let events = protocol["events"].as_object().expect("events object");
        assert!(events.len() >= 10, "sanity: vocabulary is non-trivial");
        for (name, expected) in events {
            assert_eq!(
                map_event_to_attention_type(name),
                expected.as_str(),
                "event \"{name}\" mapping drifted from hook-protocol.json"
            );
        }

        for pattern in protocol["patterns"].as_array().expect("patterns array") {
            let expected = pattern["attention"].as_str();
            if let Some(prefix) = pattern["prefix"].as_str() {
                let sample = format!("{prefix}sample");
                assert_eq!(map_event_to_attention_type(&sample), expected, "prefix \"{prefix}\"");
            }
            if let Some(contains) = pattern["contains"].as_str() {
                let sample = format!("x{contains}x");
                assert_eq!(map_event_to_attention_type(&sample), expected, "contains \"{contains}\"");
            }
        }

        for source in protocol["sources"].as_array().expect("sources array") {
            let source = source.as_str().unwrap();
            assert!(
                map_source_to_ai_type(source).is_some() && heartbeat_timeout_ms(source).is_some(),
                "source \"{source}\" must map to an aiType and carry a heartbeat lease"
            );
        }

        let roles: Vec<&str> = protocol["roles"]
            .as_array()
            .expect("roles array")
            .iter()
            .filter_map(Value::as_str)
            .collect();
        assert_eq!(roles, ["main", "subagent"], "roles vocabulary drifted");
    }

    #[test]
    fn source_to_ai_type_mapping() {
        assert_eq!(map_source_to_ai_type("opencode"), Some("opencode"));
        assert_eq!(map_source_to_ai_type("codex"), Some("codex"));
        assert_eq!(map_source_to_ai_type("omp"), Some("omp"));
        assert_eq!(map_source_to_ai_type("claude-code"), Some("claude"));
        assert_eq!(map_source_to_ai_type("unknown-tool"), None);
    }

    #[test]
    fn heartbeat_timeout_direct() {
        assert_eq!(heartbeat_timeout_ms("opencode"), Some(8_000));
        assert_eq!(heartbeat_timeout_ms("omp"), Some(8_000));
        assert_eq!(heartbeat_timeout_ms("claude-code"), Some(600_000));
        assert_eq!(heartbeat_timeout_ms("codex"), Some(600_000));
        assert_eq!(heartbeat_timeout_ms("unknown"), None);
    }

    fn http_post(port: u16, body: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let req = format!(
            "POST /hook HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(req.as_bytes()).unwrap();
        let mut buf = String::new();
        stream.read_to_string(&mut buf).unwrap();
        let status = buf
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        (status, buf)
    }

    #[test]
    fn evaluate_rejects_missing_and_wrong_secret() {
        let (status, ..) = evaluate_hook_body("sec", r#"{"paneId":"x","event":"y"}"#, |_| true);
        assert_eq!(status, 401);
        let (status, ..) = evaluate_hook_body("sec", r#"{"paneId":"x","event":"y","secret":"nope"}"#, |_| true);
        assert_eq!(status, 401);
    }

    #[test]
    fn evaluate_rejects_malformed_json() {
        let (status, ..) = evaluate_hook_body("sec", "{not json", |_| true);
        assert_eq!(status, 400);
    }

    #[test]
    fn evaluate_ignores_unknown_pane() {
        let (status, body, forward) = evaluate_hook_body(
            "sec",
            r#"{"paneId":"ghost","event":"idle","source":"opencode","secret":"sec"}"#,
            |_| false,
        );
        assert_eq!(status, 200);
        assert_eq!(body["ignored"], true);
        assert!(forward.is_none());
    }

    #[test]
    fn evaluate_forwards_valid_request() {
        let (status, body, forward) = evaluate_hook_body(
            "sec",
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec"}"#,
            |p| p == "p1",
        );
        assert_eq!(status, 200);
        assert_eq!(body["ok"], true);
        // 线格式 v2：未携带 role 的旧适配器按 main 转发。
        assert_eq!(
            forward,
            Some(("p1".to_string(), "idle".to_string(), "opencode".to_string(), "main".to_string()))
        );
    }

    #[test]
    fn evaluate_forwards_subagent_role() {
        let (status, _body, forward) = evaluate_hook_body(
            "sec",
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec","role":"subagent"}"#,
            |p| p == "p1",
        );
        assert_eq!(status, 200);
        assert_eq!(
            forward,
            Some(("p1".to_string(), "idle".to_string(), "opencode".to_string(), "subagent".to_string()))
        );
    }

    #[test]
    fn evaluate_rejects_malformed_role() {
        // fail-closed：未知角色不得静默按 main 处理（防未来适配器笔误亮灯）。
        for body in [
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec","role":"worker"}"#,
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec","role":1}"#,
        ] {
            let (status, ..) = evaluate_hook_body("sec", body, |_| true);
            assert_eq!(status, 400, "body: {body}");
        }
    }

    #[test]
    fn compute_events_subagent_role_emits_nothing() {
        // 入口层不变量：subagent 事件零 emit——不亮灯、不点火、不灭焰。
        for event in ["idle", "stop", "session_created", "session_end", "permission_prompt"] {
            assert!(
                compute_hook_events("p1", event, "opencode", "subagent", true).is_empty(),
                "subagent event \"{event}\" must not emit"
            );
        }
    }

    #[test]
    fn heartbeat_subagent_refreshes_but_never_opens_or_closes_lease() {
        let pane = format!("hb-subagent-{}", std::process::id());
        // 无租约时 subagent 事件不得开租约（区别于 main 的 late-event 重建）。
        note_event_with_now(&pane, "session_created", "opencode", "subagent", 1000);
        note_event_with_now(&pane, "idle", "opencode", "subagent", 1500);
        assert!(!ACTIVE.lock().unwrap().contains_key(&pane));

        // 主会话租约开启后：subagent 的 session_deleted 不得关火（opencode
        // 子 session 删除不代表顶层任务结束），idle 正常续期。
        note_event_with_now(&pane, "session_created", "opencode", "main", 2000);
        note_event_with_now(&pane, "session_deleted", "opencode", "subagent", 3000);
        assert!(ACTIVE.lock().unwrap().contains_key(&pane));
        note_event_with_now(&pane, "idle", "opencode", "subagent", 5000);
        {
            let active = ACTIVE.lock().unwrap();
            assert!(
                !collect_expired_with_now(&active, 13_000).contains(&pane),
                "subagent event must refresh the lease"
            );
            assert!(collect_expired_with_now(&active, 13_001).contains(&pane));
        }
        ACTIVE.lock().unwrap().remove(&pane);
    }

    #[test]
    fn image_rows_query_auth_and_shape() {
        // wrong route → None (caller 404s)
        assert!(evaluate_image_rows_query("/hook", "s", |_| None).is_none());
        // wrong secret → 401
        let (status, _) = evaluate_image_rows_query("/image-rows?pane=p1&secret=no", "sec", |_| None)
            .unwrap();
        assert_eq!(status, 401);
        // missing secret param → 401 (empty != real secret)
        let (status, _) = evaluate_image_rows_query("/image-rows?pane=p1", "sec", |_| None).unwrap();
        assert_eq!(status, 401);
        // valid → rows/pending from the session lookup; unknown pane → zeros
        let (status, body) =
            evaluate_image_rows_query("/image-rows?pane=p1&secret=sec", "sec", |_| Some((23, false)))
                .unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, json!({ "rows": 23, "pending": false }));
        let (status, body) =
            evaluate_image_rows_query("/image-rows?pane=gone&secret=sec", "sec", |_| None).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, json!({ "rows": 0, "pending": false }));
    }

    #[test]
    fn hook_server_auth_and_validation() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let secret = "test-secret";
        thread::spawn(move || {
            for mut request in server.incoming_requests() {
                // HTTP plumbing over the SAME evaluation the real server uses.
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                let (status, payload, _) = evaluate_hook_body(secret, &body, |_| true);
                let response = tiny_http::Response::from_string(payload.to_string())
                    .with_status_code(status);
                let _ = request.respond(response);
            }
        });

        let (status, _) = http_post(port, r#"{"paneId":"x","event":"y","secret":"wrong"}"#);
        assert_eq!(status, 401);
        let (status, _) = http_post(port, r#"{"paneId":"x","event":"y","secret":"test-secret"}"#);
        assert_eq!(status, 200);
    }
}
