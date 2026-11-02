use crate::hook_identity::{self, HookOrigin, ProcessKey};
use crate::hook_state::{AgentRegistry, HookEvent};
use serde::Serialize;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub(crate) fn heartbeat_timeout_ms(source: &str) -> Option<u64> {
    match source {
        "opencode" => Some(8_000),
        "omp" => Some(8_000),

        _ => None,
    }
}

static REGISTRY: LazyLock<Mutex<AgentRegistry>> =
    LazyLock::new(|| Mutex::new(AgentRegistry::default()));
static HOOK_APP: OnceLock<AppHandle> = OnceLock::new();

fn source_enabled(settings: &Value, source: &str) -> bool {
    let key = match source {
        "claude-code" => "claudeCode",
        "opencode" => "openCode",
        "codex" => "codex",
        "omp" => "ohMyPi",
        "qwen-code" => "qwenCode",
        "copilot-cli" => "copilotCli",
        _ => return false,
    };
    settings["notifications"][key].as_bool().unwrap_or(true)
}

pub fn clear_disabled_tools(settings: &Value) {
    let mut registry = REGISTRY.lock().unwrap();
    for update in registry.clear_disabled(|source| source_enabled(settings, source)) {
        if let Some(app) = HOOK_APP.get() {
            let _ = app.emit("pty:agent", update);
        }
    }
}

fn now_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

pub(crate) fn remove_pane(app: Option<&AppHandle>, pane_id: &str, root: ProcessKey) {
    let mut registry = REGISTRY.lock().unwrap();
    if let Some(update) = registry.retire(pane_id, root) {
        if let Some(app) = app {
            let _ = app.emit("pty:agent", update);
        }
    }
}

pub fn agent_snapshot() -> Value {
    REGISTRY.lock().unwrap().snapshot()
}

pub fn start_heartbeat_watchdog(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        let mut registry = REGISTRY.lock().unwrap();
        for update in registry.expire(now_ms(), wall_ms(), |actor| {
            hook_identity::process_key(actor.pid) == Some(actor)
        }) {
            let _ = app.emit("pty:agent", update);
        }
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentStatus {
    Unknown,
    Idle,
    Working,
    WaitingApproval,
    WaitingInput,
    Complete,
    Error,
}

fn wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentState {
    pub ai_type: &'static str,
    pub status: AgentStatus,
}

pub(crate) fn map_event_to_status(event: &str) -> Option<AgentStatus> {
    match event {
        "session_start" | "session_created" => Some(AgentStatus::Idle),
        "user_prompt_submit" | "pre_tool_use" | "post_tool_use" | "working" => {
            Some(AgentStatus::Working)
        }
        "elicitation_dialog" | "idle_prompt" => Some(AgentStatus::WaitingInput),
        "idle" | "stop" => Some(AgentStatus::Complete),
        _ if event.contains("permission") => Some(AgentStatus::WaitingApproval),
        _ if event.contains("question") => Some(AgentStatus::WaitingInput),
        _ if event == "error" || event.starts_with("error_") => Some(AgentStatus::Error),
        _ => None,
    }
}

pub(crate) fn map_source_to_ai_type(source: &str) -> Option<&'static str> {
    match source {
        "claude-code" => Some("claude"),
        "opencode" => Some("opencode"),
        "codex" => Some("codex"),
        "omp" => Some("omp"),
        "qwen-code" => Some("qwen"),
        "copilot-cli" => Some("copilot"),
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
struct HookRequest {
    pane_id: String,
    event: String,
    source: String,
    role: String,
    origin: HookOrigin,
}

fn on_hook_request(app: &AppHandle, request: &HookRequest) {
    crate::pty::with_hook_session(&request.pane_id, |root| {
        let mut registry = REGISTRY.lock().unwrap();
        let enabled = source_enabled(&crate::store::load_settings(), &request.source);
        let actor =
            if let Some(cached) = registry.cached_actor(&request.pane_id, root, &request.origin) {
                hook_identity::process_key(cached.pid).filter(|key| *key == cached)
            } else {
                hook_identity::resolve(root, request.origin.process_id, &request.source)
            };
        let nested = registry
            .actor_for_root(&request.pane_id, root)
            .is_some_and(|current| {
                actor.is_some_and(|next| next != current)
                    && hook_identity::process_key(current.pid) == Some(current)
            });
        if let Some(update) = registry.apply(HookEvent {
            pane_id: &request.pane_id,
            root,
            actor,
            source: &request.source,
            event: &request.event,
            role: &request.role,
            origin: &request.origin,
            enabled,
            now: now_ms(),
            nested,
        }) {
            let _ = app.emit("pty:agent", update);
        }
    });
}

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

pub fn start_hook_server(app: AppHandle) -> Result<u16, String> {
    if hook_port() != 0 {
        return Ok(hook_port());
    }
    let secret = hook_secret().to_string();
    let server =
        std::sync::Arc::new(tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?);
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("failed to get hook server port")?;
    HOOK_PORT.store(port, Ordering::Relaxed);
    let _ = HOOK_APP.set(app.clone());
    eprintln!("[hook-server] listening on 127.0.0.1:{port}");

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
            .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap())
    };

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

    const MAX_HOOK_BODY: u64 = 16 * 1024;
    if request
        .body_length()
        .is_some_and(|len| len as u64 > MAX_HOOK_BODY)
    {
        return tiny_http::Response::from_string(String::new()).with_status_code(413);
    }
    let mut body = String::new();

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
    if let Some(request) = forward {
        on_hook_request(app, &request);
    } else if payload.get("ignored").and_then(Value::as_bool) == Some(true) {
        let pane = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| v.get("paneId").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default();
        eprintln!("[hooks] ignored hook pane={pane} reason=no live PTY session for this pane id");
    }
    json_response(status, payload)
}

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

    if given != secret {
        return Some((401, json!({ "ok": false, "error": "unauthorized" })));
    }
    let (rows, pending) = take(pane).unwrap_or((0, false));
    Some((200, json!({ "rows": rows, "pending": pending })))
}

fn evaluate_hook_body(
    secret: &str,
    body: &str,
    session_exists: impl Fn(&str) -> bool,
) -> (u16, Value, Option<HookRequest>) {
    let Ok(data) = serde_json::from_str::<Value>(body) else {
        return (400, Value::Null, None);
    };

    if data.get("secret").and_then(Value::as_str) != Some(secret) {
        return (401, json!({ "ok": false, "error": "unauthorized" }), None);
    }

    let role = match data.get("role") {
        None | Some(Value::Null) => "main",
        Some(Value::String(s)) if s == "main" || s == "subagent" => s.as_str(),
        _ => return (400, Value::Null, None),
    };
    let pane_id = data.get("paneId").and_then(Value::as_str).unwrap_or("");
    let event = data.get("event").and_then(Value::as_str).unwrap_or("");
    let source = data
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let Some(origin) = data
        .get("origin")
        .cloned()
        .and_then(|value| serde_json::from_value::<HookOrigin>(value).ok())
    else {
        return (400, Value::Null, None);
    };
    if origin.process_id == 0
        || origin.sequence == 0
        || origin.emitted_at == 0
        || origin
            .instance_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 128)
        || origin
            .conversation_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 512)
        || origin
            .parent_conversation_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 512)
    {
        return (400, Value::Null, None);
    }

    if !session_exists(pane_id) {
        return (200, json!({ "ok": true, "ignored": true }), None);
    }
    (
        200,
        json!({ "ok": true }),
        Some(HookRequest {
            pane_id: pane_id.to_string(),
            event: event.to_string(),
            source: source.to_string(),
            role: role.to_string(),
            origin,
        }),
    )
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    pub(crate) fn seed_agent(pane_id: &str, root: ProcessKey) {
        let origin = HookOrigin {
            process_id: root.pid,
            sequence: 1,
            emitted_at: 100,
            instance_id: Some("pty-fixture".into()),
            conversation_id: None,
            parent_conversation_id: None,
        };
        REGISTRY
            .lock()
            .unwrap()
            .apply(HookEvent {
                pane_id,
                root,
                actor: Some(root),
                source: "opencode",
                event: "session_created",
                role: "main",
                origin: &origin,
                enabled: true,
                now: now_ms(),
                nested: false,
            })
            .unwrap();
    }

    #[test]
    fn invalid_origins_are_rejected_before_session_lookup() {
        for origin in [
            Value::Null,
            json!({}),
            json!({"processId": 0, "sequence": 1, "emittedAt": 100}),
            json!({"processId": 20, "sequence": 0, "emittedAt": 100}),
            json!({"processId": 20, "sequence": 1, "emittedAt": 0}),
            json!({"processId": 20, "sequence": 1, "emittedAt": 100, "instanceId": ""}),
            json!({"processId": 20, "sequence": 1, "emittedAt": 100, "conversationId": "x".repeat(513)}),
            json!({"processId": 20, "sequence": 1, "emittedAt": 100, "parentConversationId": "x".repeat(513)}),
        ] {
            let body = json!({"secret":"test", "paneId":"p1", "source":"codex", "event":"session_start", "origin": origin}).to_string();
            let result = evaluate_hook_body("test", &body, |_| {
                panic!("invalid origin must not enter session lookup")
            });
            assert_eq!(result.0, 400);
            assert!(result.2.is_none());
        }
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
    fn runtime_status_mapping() {
        for (event, expected) in [
            ("permission_prompt", "waiting_approval"),
            ("elicitation_dialog", "waiting_input"),
            ("idle_prompt", "waiting_input"),
            ("idle", "complete"),
            ("error_rate_limit", "error"),
            ("post_tool_use", "working"),
        ] {
            assert_eq!(json!(map_event_to_status(event)), json!(expected));
        }
    }

    #[test]
    fn event_vocabulary_matches_shared_protocol() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../resources/hook-protocol.json"
        );
        let raw = std::fs::read_to_string(path).expect("hook-protocol.json must be readable");
        let protocol: Value = serde_json::from_str(&raw).expect("hook-protocol.json must parse");

        let events = protocol["events"].as_object().expect("events object");
        assert!(events.len() >= 10, "sanity: vocabulary is non-trivial");
        for (name, expected) in events {
            assert_eq!(
                json!(map_event_to_status(name)),
                *expected,
                "event \"{name}\" mapping drifted from hook-protocol.json"
            );
        }

        for pattern in protocol["patterns"].as_array().expect("patterns array") {
            let expected = &pattern["status"];
            if let Some(prefix) = pattern["prefix"].as_str() {
                let sample = format!("{prefix}sample");
                assert_eq!(
                    json!(map_event_to_status(&sample)),
                    *expected,
                    "prefix \"{prefix}\""
                );
            }
            if let Some(contains) = pattern["contains"].as_str() {
                let sample = format!("x{contains}x");
                assert_eq!(
                    json!(map_event_to_status(&sample)),
                    *expected,
                    "contains \"{contains}\""
                );
            }
        }

        for source in protocol["sources"].as_array().expect("sources array") {
            let source = source.as_str().unwrap();
            assert!(
                map_source_to_ai_type(source).is_some(),
                "source \"{source}\" must map to an aiType"
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
        assert_eq!(map_source_to_ai_type("qwen-code"), Some("qwen"));
        assert_eq!(map_source_to_ai_type("copilot-cli"), Some("copilot"));
        assert_eq!(map_source_to_ai_type("unknown-tool"), None);
    }

    #[test]
    fn evaluate_rejects_missing_and_wrong_secret() {
        let (status, ..) = evaluate_hook_body("sec", r#"{"paneId":"x","event":"y"}"#, |_| true);
        assert_eq!(status, 401);
        let (status, ..) = evaluate_hook_body(
            "sec",
            r#"{"paneId":"x","event":"y","secret":"nope","origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
            |_| true,
        );
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
            r#"{"paneId":"ghost","event":"idle","source":"opencode","secret":"sec","origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
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
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec","origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
            |p| p == "p1",
        );
        assert_eq!(status, 200);
        assert_eq!(body["ok"], true);

        assert_eq!(
            forward.map(|request| (request.pane_id, request.event, request.source, request.role)),
            Some((
                "p1".to_string(),
                "idle".to_string(),
                "opencode".to_string(),
                "main".to_string()
            ))
        );
    }

    #[test]
    fn evaluate_forwards_subagent_role() {
        let (status, _body, forward) = evaluate_hook_body(
            "sec",
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec","role":"subagent","origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
            |p| p == "p1",
        );
        assert_eq!(status, 200);
        assert_eq!(
            forward.map(|request| (request.pane_id, request.event, request.source, request.role)),
            Some((
                "p1".to_string(),
                "idle".to_string(),
                "opencode".to_string(),
                "subagent".to_string()
            ))
        );
    }

    #[test]
    fn evaluate_rejects_malformed_role() {
        for body in [
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec","role":"worker","origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
            r#"{"paneId":"p1","event":"idle","source":"opencode","secret":"sec","role":1,"origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
        ] {
            let (status, ..) = evaluate_hook_body("sec", body, |_| true);
            assert_eq!(status, 400, "body: {body}");
        }
    }

    #[test]
    fn image_rows_query_auth_and_shape() {
        assert!(evaluate_image_rows_query("/hook", "s", |_| None).is_none());

        let (status, _) =
            evaluate_image_rows_query("/image-rows?pane=p1&secret=no", "sec", |_| None).unwrap();
        assert_eq!(status, 401);

        let (status, _) =
            evaluate_image_rows_query("/image-rows?pane=p1", "sec", |_| None).unwrap();
        assert_eq!(status, 401);

        let (status, body) =
            evaluate_image_rows_query("/image-rows?pane=p1&secret=sec", "sec", |_| {
                Some((23, false))
            })
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
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                let (status, payload, _) = evaluate_hook_body(secret, &body, |_| true);
                let response =
                    tiny_http::Response::from_string(payload.to_string()).with_status_code(status);
                let _ = request.respond(response);
            }
        });

        let (status, _) = http_post(
            port,
            r#"{"paneId":"x","event":"y","secret":"wrong","origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
        );
        assert_eq!(status, 401);
        let (status, _) = http_post(
            port,
            r#"{"paneId":"x","event":"y","secret":"test-secret","origin":{"processId":20,"sequence":1,"emittedAt":100}}"#,
        );
        assert_eq!(status, 200);
    }
}
