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
        "opencode" => Some(15_000),
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
            active.insert(pane_id.to_string(), ActiveEntry { source: source.to_string(), last_seen: now });
        }
        "session_end" | "session_deleted" => {
            active.remove(pane_id);
        }
        _ => {
            if let Some(entry) = active.get_mut(pane_id) {
                entry.last_seen = now;
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
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        let expired = {
            let mut active = ACTIVE.lock().unwrap();
            let now = now_ms();
            let expired = collect_expired_with_now(&active, now);
            for id in &expired {
                active.remove(id);
            }
            expired
        };
        for id in expired {
            let _ = app.emit("pty:attn", (id, Value::Null, Value::Null));
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
        _ => None,
    }
}

pub fn on_hook_request(app: &AppHandle, pane_id: &str, event: &str, source: &str) {
    // 心跳租约：所有来源事件都刷新该 pane 的 keepalive
    note_event(pane_id, event, source);

    // 检查对应工具是否启用
    let settings = crate::store::load_settings();
    let enabled = match source {
        "claude-code" => settings["notifications"]["claudeCode"].as_bool().unwrap_or(true),
        "opencode" => settings["notifications"]["openCode"].as_bool().unwrap_or(true),
        "codex" => settings["notifications"]["codex"].as_bool().unwrap_or(true),
        _ => true,
    };
    if !enabled {
        return;
    }

    let ai_type = map_source_to_ai_type(source);
    let pane = pane_id.to_string();

    match event {
        // 会话开始 → 设置 aiType
        "session_start" | "session_created" => {
            let _ = app.emit("pty:attn", (pane, Value::Null, ai_type));
        }
        // 会话结束 → 清除 aiType
        "session_end" | "session_deleted" => {
            let _ = app.emit("pty:attn", (pane, Value::Null, Value::Null));
        }
        _ => {
            if let Some(attention_type) = map_event_to_attention_type(event) {
                let _ = app.emit("pty:attn", (pane, attention_type, ai_type));
            }
        }
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
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("failed to get hook server port")?;
    HOOK_PORT.store(port, Ordering::Relaxed);
    eprintln!("[hook-server] listening on 127.0.0.1:{port}");

    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let response = handle_request(&app, &mut request, &secret);
            let _ = request.respond(response);
        }
    });
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
    let Ok(data) = serde_json::from_str::<Value>(&body) else {
        return tiny_http::Response::from_string(String::new()).with_status_code(400);
    };

    // Authenticate: reject any caller that can't present the per-process secret.
    if data.get("secret").and_then(Value::as_str) != Some(secret) {
        return json_response(401, json!({ "ok": false, "error": "unauthorized" }));
    }

    let pane_id = data.get("paneId").and_then(Value::as_str).unwrap_or("");
    let event = data.get("event").and_then(Value::as_str).unwrap_or("");
    let source = data.get("source").and_then(Value::as_str).unwrap_or("unknown");

    // Validate session exists
    if !crate::pty::session_exists(pane_id) {
        return json_response(200, json!({ "ok": true, "ignored": true }));
    }

    on_hook_request(app, pane_id, event, source);
    json_response(200, json!({ "ok": true }))
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
        // opencode times out at 15s, codex at 600s.
        let expired = collect_expired_with_now(&active, 20_000);
        assert_eq!(expired, vec!["a".to_string()]);
        // At 599_999, codex (600s) is still alive; opencode is long gone.
        let later = collect_expired_with_now(&active, 599_999);
        assert!(!later.contains(&"b".to_string()));
    }

    #[test]
    fn attention_type_mapping() {
        assert_eq!(map_event_to_attention_type("permission_prompt"), Some("permission"));
        assert_eq!(map_event_to_attention_type("elicitation_dialog"), Some("permission"));
        assert_eq!(map_event_to_attention_type("idle"), Some("complete"));
        assert_eq!(map_event_to_attention_type("error_rate_limit"), Some("error"));
        assert_eq!(map_event_to_attention_type("post_tool_use"), None);
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
    fn hook_server_auth_and_validation() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let secret = "test-secret";
        thread::spawn(move || {
            for mut request in server.incoming_requests() {
                // Mini version of handle_request without the AppHandle emit.
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                let data = serde_json::from_str::<Value>(&body).unwrap_or(Value::Null);
                let response = if data.get("secret").and_then(Value::as_str) != Some(secret) {
                    tiny_http::Response::from_string(r#"{"ok":false,"error":"unauthorized"}"#)
                        .with_status_code(401)
                } else {
                    tiny_http::Response::from_string(r#"{"ok":true}"#).with_status_code(200)
                };
                let _ = request.respond(response);
            }
        });

        let (status, _) = http_post(port, r#"{"paneId":"x","event":"y","secret":"wrong"}"#);
        assert_eq!(status, 401);
        let (status, _) = http_post(port, r#"{"paneId":"x","event":"y","secret":"test-secret"}"#);
        assert_eq!(status, 200);
    }
}
