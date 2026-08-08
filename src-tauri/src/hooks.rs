use serde_json::{json, Value};
use std::collections::HashMap;
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

pub fn note_event_with_now(pane_id: &str, event: &str, source: &str, now: u64) {
    if heartbeat_timeout_ms(source).is_none() {
        eprintln!("[heartbeat] unknown source \"{source}\", ignoring event \"{event}\"");
        return;
    }
    let mut active = ACTIVE.lock().unwrap();
    match event {
        "session_start" | "session_created" => {
            eprintln!("[flame] lease OPEN pane={pane_id} source={source} event={event}");
            active.insert(pane_id.to_string(), ActiveEntry { source: source.to_string(), last_seen: now });
        }
        "session_end" | "session_deleted" => {
            let existed = active.remove(pane_id).is_some();
            eprintln!("[flame] lease CLOSE pane={pane_id} source={source} event={event} existed={existed}");
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
                    eprintln!("[flame] lease REOPEN pane={pane_id} source={source} event={event} (late event after lease removal)");
                    active.insert(pane_id.to_string(), ActiveEntry { source: source.to_string(), last_seen: now });
                }
            }
        }
    }
}

pub fn note_event(pane_id: &str, event: &str, source: &str) {
    note_event_with_now(pane_id, event, source, now_ms());
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
        eprintln!("[flame] heartbeat watchdog started (5s tick)");
        loop {
            thread::sleep(Duration::from_secs(5));
            let expired = {
                let mut active = ACTIVE.lock().unwrap();
                let now = now_ms();
                for (id, e) in active.iter() {
                    let timeout = heartbeat_timeout_ms(&e.source).unwrap_or(0);
                    eprintln!(
                        "[flame] watchdog tick pane={id} source={} age={}s/{}s",
                        e.source,
                        now.saturating_sub(e.last_seen) / 1000,
                        timeout / 1000
                    );
                }
                let expired = collect_expired_with_now(&active, now);
                let mut rows = Vec::with_capacity(expired.len());
                for id in expired {
                    if let Some(e) = active.remove(&id) {
                        rows.push((id, e.source, now.saturating_sub(e.last_seen)));
                    }
                }
                rows
            };
            for (id, source, silent_ms) in expired {
                eprintln!(
                    "[flame] EXTINGUISH flame pane={id} source={source} (lease expired: no events for {}s)",
                    silent_ms / 1000
                );
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

/// Human-readable flame effect of a pty:attn payload: (pane, attention|null,
/// aiType|null) — attention 事件带 aiType 会顺带重新点亮火焰。
fn describe_emit(payload: &Value) -> String {
    let attn = payload.get(1).and_then(Value::as_str);
    let ai = payload.get(2).and_then(Value::as_str);
    match (attn, ai) {
        (Some(kind), Some(ai)) => format!("GLOW {kind} + LIGHT flame ai={ai}"),
        (Some(kind), None) => format!("GLOW {kind}"),
        (None, Some(ai)) => format!("LIGHT flame ai={ai}"),
        (None, None) => "EXTINGUISH flame".to_string(),
    }
}

pub fn on_hook_request(app: &AppHandle, pane_id: &str, event: &str, source: &str) {
    eprintln!("[flame] hook pane={pane_id} source={source} event={event}");
    note_event(pane_id, event, source);

    let settings = crate::store::load_settings();
    let enabled = match source {
        "claude-code" => settings["notifications"]["claudeCode"].as_bool().unwrap_or(true),
        "opencode" => settings["notifications"]["openCode"].as_bool().unwrap_or(true),
        "codex" => settings["notifications"]["codex"].as_bool().unwrap_or(true),
        "omp" => settings["notifications"]["ohMyPi"].as_bool().unwrap_or(true),
        _ => true,
    };
    let events = compute_hook_events(pane_id, event, source, enabled);
    if events.is_empty() && !enabled {
        let would_emit = event == "session_start"
            || event == "session_created"
            || map_event_to_attention_type(event).is_some();
        if would_emit {
            eprintln!("[flame] suppressed pane={pane_id} source={source} event={event} reason=notifications disabled for this tool");
        }
    }
    for (evt, payload) in events {
        eprintln!("[flame] {} pane={} (trigger event={})", describe_emit(&payload), pane_id, event);
        if let Err(e) = app.emit(evt, payload) {
            eprintln!("[hooks] emit {evt} failed: {e}");
        }
    }
}

/// Pure event computation for a hook request — no Tauri dependency.
/// Returns a list of (event_name, payload) to emit; empty = nothing to do.
fn compute_hook_events<'a>(
    pane_id: &'a str,
    event: &'a str,
    source: &'a str,
    enabled: bool,
) -> Vec<(&'a str, Value)> {
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

    if request.method() != &tiny_http::Method::Post || request.url() != "/hook" {
        return tiny_http::Response::from_string(String::new()).with_status_code(404);
    }

    let mut body = String::new();
    if request.as_reader().read_to_string(&mut body).is_err() {
        return tiny_http::Response::from_string(String::new()).with_status_code(400);
    }
    let (status, payload, forward) = evaluate_hook_body(secret, &body, crate::pty::session_exists);
    if status == 400 {
        return tiny_http::Response::from_string(String::new()).with_status_code(400);
    }
    if let Some((pane_id, event, source)) = forward {
        on_hook_request(app, &pane_id, &event, &source);
    } else if payload.get("ignored").and_then(Value::as_bool) == Some(true) {
        let pane = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.get("paneId").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default();
        eprintln!("[flame] ignored hook pane={pane} reason=no live PTY session for this pane id");
    }
    json_response(status, payload)
}

/// Pure hook-request evaluation, split from the tiny_http plumbing so the
/// auth/validation contract is directly unit-testable. Returns the HTTP
/// status, response payload, and — for valid requests — the
/// (pane_id, event, source) tuple to forward to on_hook_request.
fn evaluate_hook_body(
    secret: &str,
    body: &str,
    session_exists: impl Fn(&str) -> bool,
) -> (u16, Value, Option<(String, String, String)>) {
    let Ok(data) = serde_json::from_str::<Value>(body) else {
        return (400, Value::Null, None);
    };
    // Authenticate: reject any caller that can't present the per-process secret.
    if data.get("secret").and_then(Value::as_str) != Some(secret) {
        return (401, json!({ "ok": false, "error": "unauthorized" }), None);
    }
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
        Some((pane_id.to_string(), event.to_string(), source.to_string())),
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
        note_event_with_now(&pane, "session_start", "opencode", 1000);
        assert!(ACTIVE.lock().unwrap().contains_key(&pane));
        note_event_with_now(&pane, "post_tool_use", "opencode", 2000);
        note_event_with_now(&pane, "session_end", "opencode", 3000);
        assert!(!ACTIVE.lock().unwrap().contains_key(&pane));
    }

    #[test]
    fn heartbeat_lease_reopens_on_late_event() {
        // 退出竞态：session_deleted（detached curl）先于最后的 idle（普通 fetch）
        // 到达。idle 会经 pty:attn 重新点亮前端火焰，租约必须随之重新打开，
        // 否则看门狗扫不到该 pane → 火焰永久卡死。
        let pane = format!("hb-reopen-{}", std::process::id());
        note_event_with_now(&pane, "session_created", "opencode", 1000);
        note_event_with_now(&pane, "session_deleted", "opencode", 2000);
        assert!(!ACTIVE.lock().unwrap().contains_key(&pane));

        note_event_with_now(&pane, "idle", "opencode", 3000);
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
        note_event_with_now(&pane, "session_created", "opencode", 1000);
        note_event_with_now(&pane, "session_deleted", "opencode", 2000);
        note_event_with_now(&pane, "alive", "opencode", 3000);
        assert!(
            !ACTIVE.lock().unwrap().contains_key(&pane),
            "alive must not reopen a cleared lease"
        );

        // 但已有租约必须被 alive 正常续期。
        note_event_with_now(&pane, "session_created", "opencode", 4000);
        note_event_with_now(&pane, "alive", "opencode", 5000);
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
        note_event_with_now(&pane, "session_start", "not-a-tool", 1000);
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
        let events = compute_hook_events("p1", "session_end", "opencode", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "pty:attn");
        assert_eq!(events[0].1[0], "p1");
        assert!(events[0].1[1].is_null());
        assert!(events[0].1[2].is_null());
    }

    #[test]
    fn compute_events_session_end_ignores_enabled_flag() {
        let events = compute_hook_events("p1", "session_end", "opencode", false);
        assert_eq!(events.len(), 1, "session_end clears ai even when disabled");
    }

    #[test]
    fn compute_events_disabled_source_returns_nothing() {
        let events = compute_hook_events("p1", "idle", "opencode", false);
        assert!(events.is_empty());
    }

    #[test]
    fn compute_events_session_start_sets_ai_type() {
        let events = compute_hook_events("p1", "session_start", "opencode", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[2], "opencode");
    }

    #[test]
    fn compute_events_session_start_with_codex() {
        let events = compute_hook_events("p1", "session_start", "codex", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[2], "codex");
    }

    #[test]
    fn compute_events_session_start_with_omp() {
        let events = compute_hook_events("p1", "session_start", "omp", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[2], "omp");
    }

    #[test]
    fn compute_events_permission_maps_to_attention() {
        let events = compute_hook_events("p1", "permission_prompt", "claude-code", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[1], "permission");
        assert_eq!(events[0].1[2], "claude");
    }

    #[test]
    fn compute_events_unknown_source_sets_null_ai_type() {
        let events = compute_hook_events("p1", "idle", "unknown-tool", true);
        assert_eq!(events.len(), 1);
        assert!(events[0].1[2].is_null());
    }

    #[test]
    fn compute_events_unknown_event_returns_nothing() {
        let events = compute_hook_events("p1", "post_tool_use", "opencode", true);
        assert!(events.is_empty());
    }

    #[test]
    fn compute_events_error_event_maps_to_error_attention() {
        let events = compute_hook_events("p1", "error_rate_limit", "opencode", true);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1[1], "error");
    }

    #[test]
    fn attention_type_mapping() {
        assert_eq!(map_event_to_attention_type("permission_prompt"), Some("permission"));
        assert_eq!(map_event_to_attention_type("elicitation_dialog"), Some("permission"));
        assert_eq!(map_event_to_attention_type("idle"), Some("complete"));
        assert_eq!(map_event_to_attention_type("error_rate_limit"), Some("error"));
        assert_eq!(map_event_to_attention_type("post_tool_use"), None);
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
        assert_eq!(forward, Some(("p1".to_string(), "idle".to_string(), "opencode".to_string())));
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
