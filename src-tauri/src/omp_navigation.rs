use crate::hook_identity::{HookOrigin, ProcessKey};
use crate::omp_navigation_state::{
    NavigationIntent, NavigationState, Position, Scope, StateError, StateEvent,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const MAX_BODY: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtocolError {
    Unauthorized,
    Invalid,
    Unsupported,
    TooLarge,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistrationCapabilities {
    transcript_navigation: u32,
    catalog_snapshot: u32,
    native_history_viewport: u32,
    frame_observation: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistrationRequest {
    protocol_version: u32,
    pane_id: String,
    origin: HookOrigin,
    capabilities: RegistrationCapabilities,
}

#[derive(Clone, Debug)]
struct VerifiedRegistration {
    pane_id: String,
    origin: HookOrigin,
    root: ProcessKey,
    actor: ProcessKey,
    session_id: String,
    instance_id: String,
}

impl VerifiedRegistration {
    #[cfg(test)]
    fn session_id(&self) -> &str {
        &self.session_id
    }
}

fn authenticated(given: &str, expected: &str) -> bool {
    !expected.is_empty()
        && given.len() == expected.len()
        && given
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |difference, (left, right)| difference | (left ^ right))
            == 0
}

fn parse_registration(
    body: &[u8],
    given_secret: &str,
    expected_secret: &str,
    verify: impl FnOnce(&str, &HookOrigin) -> Option<(ProcessKey, ProcessKey)>,
) -> Result<VerifiedRegistration, ProtocolError> {
    if !authenticated(given_secret, expected_secret) {
        return Err(ProtocolError::Unauthorized);
    }
    if body.len() > MAX_BODY {
        return Err(ProtocolError::TooLarge);
    }
    let request: RegistrationRequest =
        serde_json::from_slice(body).map_err(|_| ProtocolError::Invalid)?;
    if request.protocol_version != 1
        || request.capabilities.transcript_navigation != 1
        || request.capabilities.catalog_snapshot != 1
        || request.capabilities.native_history_viewport != 1
        || request.capabilities.frame_observation != 1
    {
        return Err(ProtocolError::Unsupported);
    }
    let instance_id = request
        .origin
        .instance_id
        .as_ref()
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .ok_or(ProtocolError::Invalid)?
        .clone();
    let session_id = request
        .origin
        .conversation_id
        .as_ref()
        .filter(|id| !id.is_empty() && id.len() <= 512)
        .ok_or(ProtocolError::Invalid)?
        .clone();
    if request.pane_id.is_empty()
        || request.pane_id.len() > 128
        || request.origin.process_id == 0
        || request.origin.sequence == 0
        || request.origin.emitted_at == 0
        || request.origin.parent_conversation_id.is_some()
    {
        return Err(ProtocolError::Invalid);
    }
    let (root, actor) =
        verify(&request.pane_id, &request.origin).ok_or(ProtocolError::Unauthorized)?;
    Ok(VerifiedRegistration {
        pane_id: request.pane_id,
        origin: request.origin,
        root,
        actor,
        session_id,
        instance_id,
    })
}

struct FrozenCatalog {
    id: String,
    expires_at: u64,
    branch_epoch: u64,
    catalog_revision: u64,
    turns: Arc<Vec<crate::omp_navigation_state::Turn>>,
}

struct Lease {
    registration: VerifiedRegistration,
    run_id: String,
    state: NavigationState,
    touched_at: u64,
    revision: u64,
    client_id: Option<String>,
    frozen: Vec<FrozenCatalog>,
}

#[derive(Default)]
struct BrokerState {
    leases: BTreeMap<String, Lease>,
    stopped: bool,
}

impl BrokerState {
    fn register(
        &mut self,
        registration: VerifiedRegistration,
        token: String,
        run_id: String,
        now: u64,
    ) -> Result<Value, String> {
        if self.stopped {
            return Err("unavailable".into());
        }
        if let Some((token, lease)) = self.leases.iter_mut().find(|(_, lease)| {
            lease.registration.pane_id == registration.pane_id
                && lease.registration.root == registration.root
                && lease.registration.actor == registration.actor
                && lease.registration.instance_id == registration.instance_id
                && lease.registration.session_id == registration.session_id
        }) {
            lease.touched_at = now;
            return Ok(
                json!({"leaseToken":token,"runId":lease.run_id,"sessionId":lease.registration.session_id,"leaseTtlMs":30000}),
            );
        }
        self.leases
            .retain(|_, lease| lease.registration.pane_id != registration.pane_id);
        if self.leases.len() >= 128 {
            return Err("resource_limit".into());
        }
        let reply = json!({"leaseToken":token,"runId":run_id,"sessionId":registration.session_id,"leaseTtlMs":30000});
        self.leases.insert(
            token,
            Lease {
                state: NavigationState::new(registration.session_id.clone()),
                registration,
                run_id,
                touched_at: now,
                revision: 1,
                client_id: None,
                frozen: Vec::new(),
            },
        );
        Ok(reply)
    }

    fn pane_mut(&mut self, pane: &str) -> Result<&mut Lease, String> {
        self.leases
            .values_mut()
            .find(|lease| lease.registration.pane_id == pane)
            .ok_or_else(|| "unavailable".into())
    }

    fn freeze(&mut self, pane: &str, id: String, now: u64) -> Result<Value, String> {
        let lease = self.pane_mut(pane)?;
        lease.frozen.retain(|item| item.expires_at > now);
        if lease.frozen.len() >= 4 {
            lease.frozen.remove(0);
        }
        let state = lease.state.metadata();
        let turns = lease
            .frozen
            .iter()
            .find(|snapshot| {
                snapshot.branch_epoch == state.branch_epoch
                    && snapshot.catalog_revision == state.catalog_revision
            })
            .map(|snapshot| snapshot.turns.clone())
            .unwrap_or_else(|| Arc::new(lease.state.catalog().to_vec()));
        let value = json!({
            "kind":"ready","paneId":pane,"runId":lease.run_id,
            "instanceId":lease.registration.instance_id,"sessionId":lease.registration.session_id,
            "revision":lease.revision,"scope":state.scope,"branchEpoch":state.branch_epoch,
            "displayEpoch":state.display_epoch,"catalogRevision":state.catalog_revision,
            "position":state.position,"latestRequest":state.latest_request,
            "catalogSnapshotId":id,"turnCount":turns.len(),"pageSize":256
        });
        lease.frozen.push(FrozenCatalog {
            id,
            expires_at: now.saturating_add(30000),
            branch_epoch: state.branch_epoch,
            catalog_revision: state.catalog_revision,
            turns,
        });
        Ok(value)
    }

    fn page(&mut self, pane: &str, id: &str, index: usize, now: u64) -> Result<Value, String> {
        let lease = self.pane_mut(pane)?;
        let frozen = lease
            .frozen
            .iter()
            .find(|item| item.id == id && item.expires_at > now)
            .ok_or("snapshot_expired")?;
        let start = index
            .checked_mul(256)
            .filter(|start| *start <= frozen.turns.len())
            .ok_or("invalid_page")?;
        let end = start.saturating_add(256).min(frozen.turns.len());
        serde_json::to_value(&frozen.turns[start..end]).map_err(|_| "invalid_catalog".into())
    }
}

struct PendingPoll {
    token: String,
    through: u64,
    expires_at: u64,
    request: tiny_http::Request,
}

#[derive(Default)]
struct Broker {
    state: Mutex<BrokerState>,
    pending: Mutex<Vec<PendingPoll>>,
    poll_tokens: Mutex<BTreeSet<String>>,
    signal: Mutex<()>,
    wake: Condvar,
}

impl Broker {
    fn admit_poll(&self, poll: PendingPoll) -> Result<(), (PendingPoll, u16, &'static str)> {
        let state = self.state.lock().unwrap();
        if state.stopped || !state.leases.contains_key(&poll.token) {
            return Err((poll, 503, "unavailable"));
        }
        let mut tokens = self.poll_tokens.lock().unwrap();
        if tokens.len() >= 128 || tokens.contains(&poll.token) {
            return Err((poll, 429, "poll_already_pending"));
        }
        tokens.insert(poll.token.clone());
        drop(tokens);
        self.pending.lock().unwrap().push(poll);
        drop(state);
        self.wake.notify_one();
        Ok(())
    }

    fn stop_admission(&self) {
        let mut state = self.state.lock().unwrap();
        state.stopped = true;
        state.leases.clear();
        drop(state);
        self.wake.notify_all();
    }
}

static BROKER: LazyLock<Broker> = LazyLock::new(Broker::default);
static APP: OnceLock<AppHandle> = OnceLock::new();
static STOPPED: AtomicBool = AtomicBool::new(false);
static WORKER: OnceLock<Mutex<Option<std::thread::JoinHandle<()>>>> = OnceLock::new();

fn now_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

fn random_id() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("system rng");
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}

fn state_error(error: StateError) -> String {
    serde_json::to_value(error)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "invalid_state".into())
}

fn changed(pane: &str) {
    BROKER.wake.notify_one();
    if let Some(app) = APP.get() {
        let _ = app.emit("omp:navigation", json!({"paneId":pane}));
    }
}

fn reply(request: tiny_http::Request, status: u16, value: Value) {
    let response = tiny_http::Response::from_string(value.to_string())
        .with_status_code(status)
        .with_header(tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap())
        .with_header(tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap());
    let _ = request.respond(response);
}

fn validate_token(token: &str) -> Result<String, String> {
    let registration = BROKER
        .state
        .lock()
        .unwrap()
        .leases
        .get(token)
        .filter(|lease| now_ms().saturating_sub(lease.touched_at) < 30000)
        .map(|lease| lease.registration.clone())
        .ok_or("unauthorized")?;
    if crate::hooks::current_omp_binding(&registration.pane_id, &registration.origin)
        != Some((registration.root, registration.actor))
    {
        BROKER.state.lock().unwrap().leases.remove(token);
        changed(&registration.pane_id);
        return Err("unauthorized".into());
    }
    let mut state = BROKER.state.lock().unwrap();
    let lease = state.leases.get_mut(token).ok_or("unauthorized")?;
    lease.touched_at = now_ms();
    Ok(registration.pane_id)
}

fn validate_pane(pane: &str) -> Result<(), String> {
    let token = BROKER
        .state
        .lock()
        .unwrap()
        .leases
        .iter()
        .find(|(_, lease)| lease.registration.pane_id == pane)
        .map(|(token, _)| token.clone())
        .ok_or("unavailable")?;
    validate_token(&token).map(|_| ())
}

pub(crate) fn initialize(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    let worker = std::thread::spawn(|| {
        let mut last_cleanup = 0;
        loop {
            if STOPPED.load(Ordering::Acquire) {
                break;
            }
            let now = now_ms();
            let updated: Vec<_> = BROKER
                .state
                .lock()
                .unwrap()
                .leases
                .values_mut()
                .filter_map(|lease| {
                    if lease.state.tick(now) {
                        lease.revision = lease.revision.saturating_add(1);
                        Some(lease.registration.pane_id.clone())
                    } else {
                        None
                    }
                })
                .collect();
            for pane in updated {
                changed(&pane);
            }
            if now.saturating_sub(last_cleanup) >= 1000 {
                last_cleanup = now;
                let registrations: Vec<_> = BROKER
                    .state
                    .lock()
                    .unwrap()
                    .leases
                    .iter()
                    .map(|(token, lease)| {
                        (token.clone(), lease.registration.clone(), lease.touched_at)
                    })
                    .collect();
                for (token, registration, touched) in registrations {
                    if now.saturating_sub(touched) >= 30000
                        || crate::hooks::current_omp_binding(
                            &registration.pane_id,
                            &registration.origin,
                        ) != Some((registration.root, registration.actor))
                    {
                        BROKER.state.lock().unwrap().leases.remove(&token);
                        changed(&registration.pane_id);
                    }
                }
            }
            let pending = std::mem::take(&mut *BROKER.pending.lock().unwrap());
            let mut waiting = Vec::new();
            for poll in pending {
                let answer = {
                    let mut state = BROKER.state.lock().unwrap();
                    match state.leases.get_mut(&poll.token) {
                        None => Some((401, json!({"error":"unauthorized"}))),
                        Some(lease) => match lease.state.poll(poll.through, now) {
                            Some(command) => Some((200, json!({"command":command}))),
                            None if now >= poll.expires_at => Some((200, json!({"command":null}))),
                            None => None,
                        },
                    }
                };
                if let Some((status, value)) = answer {
                    BROKER.poll_tokens.lock().unwrap().remove(&poll.token);
                    reply(poll.request, status, value);
                } else {
                    waiting.push(poll);
                }
            }
            BROKER.pending.lock().unwrap().extend(waiting);
            let guard = BROKER.signal.lock().unwrap();
            let _ = BROKER
                .wake
                .wait_timeout(guard, Duration::from_millis(50))
                .unwrap();
        }
        let pending = std::mem::take(&mut *BROKER.pending.lock().unwrap());
        BROKER.poll_tokens.lock().unwrap().clear();
        for poll in pending {
            reply(poll.request, 503, json!({"error":"unavailable"}));
        }
    });
    let _ = WORKER.set(Mutex::new(Some(worker)));
}

pub(crate) fn stop() {
    STOPPED.store(true, Ordering::Release);
    BROKER.stop_admission();
    if let Some(worker) = WORKER
        .get()
        .and_then(|worker| worker.lock().unwrap().take())
    {
        let _ = worker.join();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PollRequest {
    received_through: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AcceptRequest {
    request_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorizeRequest {
    request_id: String,
    admission_id: String,
}

pub(crate) fn handle_http(mut request: tiny_http::Request, secret: &str) {
    if STOPPED.load(Ordering::Acquire) {
        reply(request, 503, json!({"error":"unavailable"}));
        return;
    }
    if request.method() != &tiny_http::Method::Post {
        reply(request, 405, json!({"error":"method_not_allowed"}));
        return;
    }
    let path = request.url().to_string();
    let token = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .and_then(|header| header.value.as_str().strip_prefix("Bearer "))
        .unwrap_or("")
        .to_string();
    if token.len() > 128 || token.is_empty() {
        reply(request, 401, json!({"error":"unauthorized"}));
        return;
    }
    let pane = if path == "/omp/register" {
        if !authenticated(&token, secret) {
            reply(request, 401, json!({"error":"unauthorized"}));
            return;
        }
        None
    } else {
        match validate_token(&token) {
            Ok(pane) => Some(pane),
            Err(_) => {
                reply(request, 401, json!({"error":"unauthorized"}));
                return;
            }
        }
    };
    let limit = if path == "/omp/event" {
        256 * 1024
    } else {
        MAX_BODY
    };
    if request.body_length().is_some_and(|size| size > limit) {
        reply(request, 413, json!({"error":"too_large"}));
        return;
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take((limit + 1) as u64)
        .read_to_end(&mut body)
        .is_err()
        || body.len() > limit
    {
        reply(request, 400, json!({"error":"invalid_body"}));
        return;
    }
    if path == "/omp/register" {
        let result = parse_registration(&body, &token, secret, crate::hooks::current_omp_binding);
        match result {
            Ok(registration) => {
                let pane = registration.pane_id.clone();
                let result = BROKER.state.lock().unwrap().register(
                    registration,
                    random_id(),
                    random_id(),
                    now_ms(),
                );
                match result {
                    Ok(value) => {
                        changed(&pane);
                        reply(request, 200, value);
                    }
                    Err(error) => reply(request, 429, json!({"error":error})),
                }
            }
            Err(error) => {
                let status = match error {
                    ProtocolError::Unauthorized => 401,
                    ProtocolError::TooLarge => 413,
                    ProtocolError::Unsupported => 409,
                    ProtocolError::Invalid => 400,
                };
                reply(
                    request,
                    status,
                    json!({"error":format!("{error:?}").to_lowercase()}),
                );
            }
        }
        return;
    }
    let Some(pane) = pane else {
        reply(request, 401, json!({"error":"unauthorized"}));
        return;
    };
    if path == "/omp/poll" {
        let Ok(poll) = serde_json::from_slice::<PollRequest>(&body) else {
            reply(request, 400, json!({"error":"invalid_poll"}));
            return;
        };
        if let Err((poll, status, error)) = BROKER.admit_poll(PendingPoll {
            token,
            through: poll.received_through,
            expires_at: now_ms().saturating_add(20000),
            request,
        }) {
            reply(poll.request, status, json!({"error":error}));
        }
        return;
    }
    let result = {
        let mut state = BROKER.state.lock().unwrap();
        match state.leases.get_mut(&token) {
            None => Err("unauthorized".to_string()),
            Some(lease) => {
                let result = match path.as_str() {
                    "/omp/event" => serde_json::from_slice::<StateEvent>(&body).map_err(|_| "invalid_event".to_string())
                        .and_then(|event| lease.state.apply(event, now_ms()).map_err(state_error)).map(|()| json!({"ok":true})),
                    "/omp/accept" => serde_json::from_slice::<AcceptRequest>(&body).map_err(|_| "invalid_request".to_string())
                        .and_then(|value| lease.state.accept(&value.request_id, random_id(), now_ms()).map_err(state_error))
                        .map(|admission| { lease.revision = lease.revision.saturating_add(1); json!({"admission":admission}) }),
                    "/omp/authorize" => serde_json::from_slice::<AuthorizeRequest>(&body).map_err(|_| "invalid_request".to_string())
                        .and_then(|value| lease.state.authorize(&value.request_id, &value.admission_id, now_ms()).map_err(state_error))
                        .map(|admission| json!({"authorized":true,"executionBudgetMs":admission.execution_budget_ms})),
                    "/omp/revoke" => Ok(json!({"ok":true})),
                    _ => Err("unknown_endpoint".into()),
                };
                result.map(|value| {
                    lease.revision = lease.revision.saturating_add(1);
                    value
                })
            }
        }
    };
    if path == "/omp/revoke" {
        BROKER.state.lock().unwrap().leases.remove(&token);
    }
    changed(&pane);
    match result {
        Ok(value) => reply(request, 200, value),
        Err(error) => reply(request, 409, json!({"error":error})),
    }
}

pub(crate) fn remove_pane(pane: &str, root: ProcessKey) {
    BROKER
        .state
        .lock()
        .unwrap()
        .leases
        .retain(|_, lease| lease.registration.pane_id != pane || lease.registration.root != root);
    changed(pane);
}

#[tauri::command]
pub(crate) fn omp_navigation_snapshot(pane_id: String, client_id: String) -> Result<Value, String> {
    if client_id.is_empty() || client_id.len() > 128 {
        return Err("invalid_client".into());
    }
    if validate_pane(&pane_id).is_err() {
        return Ok(json!({"kind":"unavailable","paneId":pane_id}));
    }
    let mut state = BROKER.state.lock().unwrap();
    let lease = state.pane_mut(&pane_id)?;
    if lease.client_id.as_ref() != Some(&client_id) {
        let epoch = lease
            .state
            .metadata()
            .scope
            .map(|scope| scope.control_epoch)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or("resource_limit")?;
        lease.state.begin_scope(Scope {
            scope_id: random_id(),
            control_epoch: epoch,
        });
        lease.client_id = Some(client_id);
        lease.revision = lease.revision.saturating_add(1);
    }
    state.freeze(&pane_id, random_id(), now_ms())
}

#[tauri::command]
pub(crate) fn omp_navigation_status(pane_id: String) -> Result<Value, String> {
    if validate_pane(&pane_id).is_err() {
        return Ok(json!({"kind":"unavailable","paneId":pane_id}));
    }
    BROKER
        .state
        .lock()
        .unwrap()
        .freeze(&pane_id, random_id(), now_ms())
}

#[tauri::command]
pub(crate) fn omp_navigation_catalog_page(
    pane_id: String,
    snapshot_id: String,
    page_index: usize,
) -> Result<Value, String> {
    validate_pane(&pane_id)?;
    BROKER
        .state
        .lock()
        .unwrap()
        .page(&pane_id, &snapshot_id, page_index, now_ms())
}

#[tauri::command]
pub(crate) fn omp_navigation_request(
    pane_id: String,
    client_id: String,
    intent: NavigationIntent,
) -> Result<Value, String> {
    validate_pane(&pane_id)?;
    if intent.request_id.is_empty() || intent.request_id.len() > 128 {
        return Err("invalid_request".into());
    }
    let command = {
        let mut state = BROKER.state.lock().unwrap();
        let lease = state.pane_mut(&pane_id)?;
        if lease.client_id.as_ref() != Some(&client_id) {
            return Err("stale_scope".into());
        }
        let command = lease.state.enqueue(intent, now_ms()).map_err(state_error)?;
        lease.revision = lease.revision.saturating_add(1);
        command
    };
    changed(&pane_id);
    Ok(json!({"requestId":command.request_id}))
}

#[tauri::command]
pub(crate) fn omp_navigation_observe(pane_id: String, position: Position) -> Result<(), String> {
    validate_pane(&pane_id)?;
    {
        let mut state = BROKER.state.lock().unwrap();
        let lease = state.pane_mut(&pane_id)?;
        lease
            .state
            .observe_frame(position, now_ms())
            .map_err(state_error)?;
        lease.revision = lease.revision.saturating_add(1);
    }
    changed(&pane_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn omp_navigation_release(
    pane_id: String,
    client_id: String,
    scope: Scope,
) -> Result<(), String> {
    let mut state = BROKER.state.lock().unwrap();
    let lease = state.pane_mut(&pane_id)?;
    if lease.client_id.as_ref() != Some(&client_id) {
        return Err("stale_scope".into());
    }
    lease.state.end_scope(&scope).map_err(state_error)?;
    lease.client_id = None;
    drop(state);
    changed(&pane_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    fn registration_body() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "protocolVersion": 1,
            "paneId": "pane-1",
            "origin": {
                "processId": 20,
                "sequence": 1,
                "emittedAt": 100,
                "instanceId": "instance-1",
                "conversationId": "session-1"
            },
            "capabilities": {
                "transcriptNavigation": 1,
                "catalogSnapshot": 1,
                "nativeHistoryViewport": 1,
                "frameObservation": 1
            }
        }))
        .unwrap()
    }

    #[test]
    fn invalid_authentication_never_resolves_or_registers_a_process() {
        let calls = Cell::new(0);
        let result = parse_registration(&registration_body(), "wrong", "expected", |_, _| {
            calls.set(calls.get() + 1);
            None
        });
        assert_eq!(result.unwrap_err(), ProtocolError::Unauthorized);
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn navigation_registration_requires_a_verified_current_actor() {
        assert_eq!(
            parse_registration(&registration_body(), "expected", "expected", |_, _| None)
                .unwrap_err(),
            ProtocolError::Unauthorized
        );
        let root = ProcessKey {
            pid: 10,
            created: 100,
        };
        let actor = ProcessKey {
            pid: 20,
            created: 200,
        };
        let result = parse_registration(
            &registration_body(),
            "expected",
            "expected",
            |pane, origin| {
                assert_eq!(pane, "pane-1");
                assert_eq!(origin.conversation_id.as_deref(), Some("session-1"));
                Some((root, actor))
            },
        )
        .unwrap();
        assert_eq!(result.pane_id, "pane-1");
        assert_eq!(result.root, root);
        assert_eq!(result.actor, actor);
        assert_eq!(result.session_id(), "session-1");
    }

    #[test]
    fn unsupported_or_oversized_payloads_cannot_create_a_lease() {
        let mut body: serde_json::Value = serde_json::from_slice(&registration_body()).unwrap();
        body["capabilities"]["nativeHistoryViewport"] = json!(0);
        assert_eq!(
            parse_registration(
                &serde_json::to_vec(&body).unwrap(),
                "expected",
                "expected",
                |_, _| panic!("must not resolve unsupported clients")
            )
            .unwrap_err(),
            ProtocolError::Unsupported
        );
        assert_eq!(
            parse_registration(
                &vec![b' '; MAX_BODY + 1],
                "expected",
                "expected",
                |_, _| panic!("must not resolve oversized clients")
            )
            .unwrap_err(),
            ProtocolError::TooLarge
        );
        body["capabilities"]["nativeHistoryViewport"] = json!(1);
        body["origin"]["sequence"] = json!(0);
        assert_eq!(
            parse_registration(
                &serde_json::to_vec(&body).unwrap(),
                "expected",
                "expected",
                |_, _| panic!("must not resolve malformed clients")
            )
            .unwrap_err(),
            ProtocolError::Invalid
        );
    }

    fn verified(instance: &str) -> VerifiedRegistration {
        let mut value: serde_json::Value = serde_json::from_slice(&registration_body()).unwrap();
        value["origin"]["instanceId"] = json!(instance);
        parse_registration(
            &serde_json::to_vec(&value).unwrap(),
            "expected",
            "expected",
            |_, _| {
                Some((
                    ProcessKey {
                        pid: 10,
                        created: 100,
                    },
                    ProcessKey {
                        pid: 20,
                        created: 200,
                    },
                ))
            },
        )
        .unwrap()
    }

    #[test]
    fn retries_keep_a_lease_but_a_new_instance_revokes_the_old_token() {
        let mut registry = BrokerState::default();
        let first = registry
            .register(verified("instance-1"), "token-1".into(), "run-1".into(), 10)
            .unwrap();
        let retry = registry
            .register(
                verified("instance-1"),
                "unused-token".into(),
                "unused-run".into(),
                11,
            )
            .unwrap();
        assert_eq!(first, retry);
        let next = registry
            .register(verified("instance-2"), "token-2".into(), "run-2".into(), 12)
            .unwrap();
        assert_ne!(first, next);
        assert!(!registry.leases.contains_key("token-1"));
        assert_eq!(registry.leases.len(), 1);
        assert_eq!(
            registry
                .leases
                .get("token-2")
                .unwrap()
                .registration
                .instance_id,
            "instance-2"
        );
    }

    #[test]
    fn a_catalog_snapshot_remains_stable_across_new_live_content() {
        let mut registry = BrokerState::default();
        registry
            .register(verified("instance-1"), "token-1".into(), "run-1".into(), 10)
            .unwrap();
        let first = registry.freeze("pane-1", "snapshot-1".into(), 11).unwrap();
        assert_eq!(first["turnCount"], 0);
        assert!(first.get("leaseToken").is_none());
        assert!(first.get("token").is_none());
        registry
            .pane_mut("pane-1")
            .unwrap()
            .state
            .apply(
                StateEvent::CatalogPage {
                    snapshot_id: "upload-1".into(),
                    branch_epoch: 0,
                    catalog_revision: 1,
                    page_index: 0,
                    page_count: 1,
                    turns: vec![crate::omp_navigation_state::Turn {
                        entry_id: "turn-1".into(),
                        ordinal: 1,
                        preview: "First question".into(),
                        created_at: 100,
                    }],
                },
                12,
            )
            .unwrap();
        let next = registry.freeze("pane-1", "snapshot-2".into(), 13).unwrap();
        assert_eq!(next["turnCount"], 1);
        assert_eq!(
            registry.page("pane-1", "snapshot-2", 0, 14).unwrap(),
            json!([
                {"entryId":"turn-1","ordinal":1,"preview":"First question","createdAt":100}
            ])
        );
        assert_eq!(
            registry.page("pane-1", "snapshot-1", 0, 12).unwrap(),
            json!([])
        );
        assert!(registry.page("pane-1", "snapshot-1", 0, 30012).is_err());
    }

    #[test]
    fn stopped_broker_rejects_a_poll_whose_body_finishes_after_shutdown() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpStream;
        use std::sync::mpsc;

        let broker = Arc::new(Broker::default());
        broker
            .state
            .lock()
            .unwrap()
            .register(verified("instance-1"), "token-1".into(), "run-1".into(), 10)
            .unwrap();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let (reading_tx, reading_rx) = mpsc::channel();
        let handler_broker = broker.clone();
        let handler = std::thread::spawn(move || {
            let mut request = server.recv().unwrap();
            assert!(handler_broker
                .state
                .lock()
                .unwrap()
                .leases
                .contains_key("token-1"));
            reading_tx.send(()).unwrap();
            let mut body = Vec::new();
            request.as_reader().read_to_end(&mut body).unwrap();
            let poll: PollRequest = serde_json::from_slice(&body).unwrap();
            if let Err((poll, status, error)) = handler_broker.admit_poll(PendingPoll {
                token: "token-1".into(),
                through: poll.received_through,
                expires_at: 20_000,
                request,
            }) {
                reply(poll.request, status, json!({"error":error}));
            }
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut body = br#"{"receivedThrough":0}"#.to_vec();
        body.resize(2048, b' ');
        write!(client, "POST /omp/poll HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer token-1\r\nConnection: close\r\nContent-Length: {}\r\n\r\n", body.len()).unwrap();
        client.write_all(&body[..1]).unwrap();
        reading_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        broker.stop_admission();
        client.write_all(&body[1..]).unwrap();
        let mut status = String::new();
        BufReader::new(client).read_line(&mut status).unwrap();
        handler.join().unwrap();
        assert_eq!(status.trim(), "HTTP/1.1 503 Service Unavailable");
        assert!(broker.pending.lock().unwrap().is_empty());
        assert!(broker.poll_tokens.lock().unwrap().is_empty());
        assert_eq!(
            broker.state.lock().unwrap().register(
                verified("instance-1"),
                "token-2".into(),
                "run-2".into(),
                20
            ),
            Err("unavailable".into())
        );
    }
}
