use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const MAX_ENTRY_ID_BYTES: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Turn {
    pub entry_id: String,
    pub ordinal: u64,
    pub preview: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum NavTarget {
    Turn { entry_id: String },
    Live,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Scope {
    pub scope_id: String,
    pub control_epoch: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NavigationIntent {
    pub request_id: String,
    pub scope: Scope,
    pub target: NavTarget,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Command {
    pub request_id: String,
    pub seq: u64,
    pub scope_id: String,
    pub control_epoch: u64,
    pub display_epoch: u64,
    pub branch_epoch: u64,
    pub session_id: String,
    pub target: NavTarget,
    pub remaining_admission_ttl_ms: u64,
    pub execution_budget_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum RequestStatus {
    Queued,
    Accepted { admission_id: String },
    Applied { position: Position, shown: bool },
    Failed { error: String },
    Cancelled,
    Superseded,
    Expired,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Admission {
    pub request_id: String,
    pub admission_id: String,
    pub execution_budget_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceAnchor {
    pub part_id: String,
    pub scalar_offset: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Position {
    Live {
        session_id: String,
        branch_epoch: u64,
        display_epoch: u64,
        view_revision: u64,
        frame_id: String,
    },
    Browsing {
        session_id: String,
        branch_epoch: u64,
        display_epoch: u64,
        view_revision: u64,
        frame_id: String,
        entry_id: String,
        anchor: SourceAnchor,
    },
}

impl Position {
    pub fn session_id(&self) -> &str {
        match self {
            Self::Live { session_id, .. } | Self::Browsing { session_id, .. } => session_id,
        }
    }

    pub fn branch_epoch(&self) -> u64 {
        match self {
            Self::Live { branch_epoch, .. } | Self::Browsing { branch_epoch, .. } => *branch_epoch,
        }
    }

    pub fn display_epoch(&self) -> u64 {
        match self {
            Self::Live { display_epoch, .. } | Self::Browsing { display_epoch, .. } => {
                *display_epoch
            }
        }
    }

    pub fn view_revision(&self) -> u64 {
        match self {
            Self::Live { view_revision, .. } | Self::Browsing { view_revision, .. } => {
                *view_revision
            }
        }
    }

    pub fn frame_id(&self) -> &str {
        match self {
            Self::Live { frame_id, .. } | Self::Browsing { frame_id, .. } => frame_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequestSummary {
    pub request_id: String,
    pub status: RequestStatus,
    pub observation_timed_out: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StateSnapshot {
    pub scope: Option<Scope>,
    pub branch_epoch: u64,
    pub display_epoch: u64,
    pub catalog_revision: u64,
    pub turns: Vec<Turn>,
    pub position: Position,
    pub latest_request: Option<RequestSummary>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StateError {
    StaleScope,
    DuplicateRequest,
    ResourceLimit,
    UnknownRequest,
    Expired,
    Superseded,
    StalePosition,
    InvalidEvent,
    ResyncRequired,
    NotAccepted,
    Cancelled,
    Busy,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum CatalogChange {
    Append { turn: Turn },
    Update { turn: Turn },
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum StateEvent {
    CatalogPage {
        snapshot_id: String,
        branch_epoch: u64,
        catalog_revision: u64,
        page_index: u32,
        page_count: u32,
        turns: Vec<Turn>,
    },
    CatalogDelta {
        branch_epoch: u64,
        base_revision: u64,
        catalog_revision: u64,
        changes: Vec<CatalogChange>,
    },
    Position {
        position: Position,
    },
    Applied {
        request_id: String,
        admission_id: String,
        position: Position,
    },
    Failed {
        request_id: String,
        admission_id: String,
        error: String,
    },
    Abandoned {
        request_id: String,
        admission_id: String,
    },
}

struct Request {
    command: Command,
    status: RequestStatus,
    admission_deadline: u64,
    admission_id: Option<String>,
    finished_at: Option<u64>,
    applied_at: Option<u64>,
    observation_timed_out: bool,
    abandoned: bool,
}

#[derive(Clone, PartialEq, Eq)]
struct CatalogRevisionDelta {
    revision: u64,
    changes: Vec<CatalogChange>,
}

struct CatalogUpload {
    snapshot_id: String,
    revision: u64,
    page_count: u32,
    pages: BTreeMap<u32, Vec<Turn>>,
    deltas: BTreeMap<u64, CatalogRevisionDelta>,
    started_at: u64,
    committed: bool,
}

pub(crate) struct NavigationState {
    session_id: String,
    scope: Option<Scope>,
    next_seq: u64,
    requests: BTreeMap<String, Request>,
    branch_epoch: u64,
    display_epoch: u64,
    catalog_revision: u64,
    catalog_ready: bool,
    turns: Vec<Turn>,
    position: Position,
    observed_frames: BTreeMap<String, (Position, u64)>,
    catalog_upload: Option<CatalogUpload>,
    expired_snapshot_id: Option<String>,
    now_ms: u64,
    execution_slot: Option<String>,
}

impl NavigationState {
    pub fn new(session_id: String) -> Self {
        let position = Position::Live {
            session_id: session_id.clone(),
            branch_epoch: 0,
            display_epoch: 0,
            view_revision: 0,
            frame_id: String::new(),
        };
        Self {
            session_id,
            scope: None,
            next_seq: 0,
            requests: BTreeMap::new(),
            branch_epoch: 0,
            display_epoch: 0,
            catalog_revision: 0,
            catalog_ready: false,
            turns: Vec::new(),
            position,
            observed_frames: BTreeMap::new(),
            catalog_upload: None,
            expired_snapshot_id: None,
            now_ms: 0,
            execution_slot: None,
        }
    }

    pub fn begin_scope(&mut self, scope: Scope) -> Scope {
        if self.scope.as_ref() != Some(&scope) {
            for request in self.requests.values_mut() {
                if matches!(
                    request.status,
                    RequestStatus::Queued | RequestStatus::Accepted { .. }
                ) {
                    request.status = RequestStatus::Superseded;
                    request.finished_at = Some(self.now_ms);
                }
            }
            self.observed_frames.clear();
            self.scope = Some(scope.clone());
        }
        scope
    }

    pub fn end_scope(&mut self, scope: &Scope) -> Result<(), StateError> {
        if self.scope.as_ref().is_some_and(|current| current != scope) {
            return Err(StateError::StaleScope);
        }
        for request in self.requests.values_mut() {
            if matches!(
                request.status,
                RequestStatus::Queued | RequestStatus::Accepted { .. }
            ) {
                request.status = RequestStatus::Superseded;
                request.finished_at = Some(self.now_ms);
            }
        }
        self.scope = None;
        self.observed_frames.clear();
        Ok(())
    }

    pub fn enqueue(
        &mut self,
        intent: NavigationIntent,
        now_ms: u64,
    ) -> Result<Command, StateError> {
        if let NavTarget::Turn { entry_id } = &intent.target {
            validate_entry_id(entry_id)?;
        }
        self.tick(now_ms);
        if self.scope.as_ref() != Some(&intent.scope) {
            return Err(StateError::StaleScope);
        }
        if let Some(request) = self.requests.get(&intent.request_id) {
            if request.command.target != intent.target
                || request.command.scope_id != intent.scope.scope_id
                || request.command.control_epoch != intent.scope.control_epoch
            {
                return Err(StateError::DuplicateRequest);
            }
            let mut command = request.command.clone();
            command.remaining_admission_ttl_ms = request.admission_deadline.saturating_sub(now_ms);
            return Ok(command);
        }
        if self.requests.len() >= 1024 {
            return Err(StateError::ResourceLimit);
        }
        let seq = self
            .next_seq
            .checked_add(1)
            .ok_or(StateError::ResourceLimit)?;
        for request in self.requests.values_mut() {
            if matches!(
                request.status,
                RequestStatus::Queued | RequestStatus::Accepted { .. }
            ) {
                request.status = RequestStatus::Superseded;
                request.finished_at = Some(now_ms);
            }
        }
        let command = Command {
            request_id: intent.request_id,
            seq,
            scope_id: intent.scope.scope_id,
            control_epoch: intent.scope.control_epoch,
            display_epoch: self.display_epoch,
            branch_epoch: self.branch_epoch,
            session_id: self.session_id.clone(),
            target: intent.target,
            remaining_admission_ttl_ms: 5000,
            execution_budget_ms: 5000,
        };
        self.next_seq = seq;
        self.requests.insert(
            command.request_id.clone(),
            Request {
                command: command.clone(),
                status: RequestStatus::Queued,
                admission_deadline: now_ms.saturating_add(5000),
                admission_id: None,
                finished_at: None,
                applied_at: None,
                observation_timed_out: false,
                abandoned: false,
            },
        );
        Ok(command)
    }

    pub fn poll(&mut self, received_through: u64, now_ms: u64) -> Option<Command> {
        self.tick(now_ms);
        let request = self
            .requests
            .values()
            .filter(|request| {
                request.status == RequestStatus::Queued && request.command.seq > received_through
            })
            .max_by_key(|request| request.command.seq)?;
        let mut command = request.command.clone();
        command.remaining_admission_ttl_ms = request.admission_deadline.saturating_sub(now_ms);
        Some(command)
    }

    pub fn request_status(&self, request_id: &str) -> Option<&RequestStatus> {
        self.requests.get(request_id).map(|request| &request.status)
    }

    pub fn accept(
        &mut self,
        request_id: &str,
        admission_id: String,
        now_ms: u64,
    ) -> Result<Admission, StateError> {
        self.tick(now_ms);
        let request = self
            .requests
            .get_mut(request_id)
            .ok_or(StateError::UnknownRequest)?;
        if matches!(
            request.status,
            RequestStatus::Accepted { .. } | RequestStatus::Superseded | RequestStatus::Cancelled
        ) {
            if let Some(admission_id) = &request.admission_id {
                return Ok(Admission {
                    request_id: request_id.into(),
                    admission_id: admission_id.clone(),
                    execution_budget_ms: request.command.execution_budget_ms,
                });
            }
        }
        match &request.status {
            RequestStatus::Accepted { admission_id } => {
                return Ok(Admission {
                    request_id: request_id.into(),
                    admission_id: admission_id.clone(),
                    execution_budget_ms: request.command.execution_budget_ms,
                })
            }
            RequestStatus::Expired => return Err(StateError::Expired),
            RequestStatus::Superseded => return Err(StateError::Superseded),
            RequestStatus::Cancelled => return Err(StateError::Cancelled),
            RequestStatus::Applied { .. } | RequestStatus::Failed { .. } => {
                return Err(StateError::NotAccepted)
            }
            RequestStatus::Queued => {}
        }
        if now_ms >= request.admission_deadline {
            request.status = RequestStatus::Expired;
            return Err(StateError::Expired);
        }
        if self
            .execution_slot
            .as_deref()
            .is_some_and(|running| running != request_id)
        {
            return Err(StateError::Busy);
        }
        request.status = RequestStatus::Accepted {
            admission_id: admission_id.clone(),
        };
        request.admission_id = Some(admission_id.clone());
        self.execution_slot = Some(request_id.into());
        Ok(Admission {
            request_id: request_id.into(),
            admission_id,
            execution_budget_ms: request.command.execution_budget_ms,
        })
    }

    pub fn authorize(
        &mut self,
        request_id: &str,
        admission_id: &str,
        now_ms: u64,
    ) -> Result<Admission, StateError> {
        self.tick(now_ms);
        let request = self
            .requests
            .get(request_id)
            .ok_or(StateError::UnknownRequest)?;
        if request.admission_id.as_deref() != Some(admission_id) {
            return Err(StateError::NotAccepted);
        }
        match request.status {
            RequestStatus::Accepted { .. } => {}
            RequestStatus::Superseded => return Err(StateError::Superseded),
            RequestStatus::Cancelled => return Err(StateError::Cancelled),
            RequestStatus::Expired => return Err(StateError::Expired),
            _ => return Err(StateError::NotAccepted),
        }
        if self.execution_slot.as_deref() != Some(request_id) {
            return Err(StateError::NotAccepted);
        }
        if !self.scope.as_ref().is_some_and(|scope| {
            scope.scope_id == request.command.scope_id
                && scope.control_epoch == request.command.control_epoch
        }) {
            return Err(StateError::StaleScope);
        }
        if request.command.seq != self.next_seq {
            return Err(StateError::Superseded);
        }
        if request.command.branch_epoch != self.branch_epoch
            || request.command.display_epoch != self.display_epoch
        {
            return Err(StateError::StalePosition);
        }
        Ok(Admission {
            request_id: request_id.into(),
            admission_id: admission_id.into(),
            execution_budget_ms: request.command.execution_budget_ms,
        })
    }

    pub fn snapshot(&self) -> StateSnapshot {
        let mut snapshot = self.metadata();
        snapshot.turns = self.turns.clone();
        snapshot
    }

    pub fn catalog(&self) -> &[Turn] {
        &self.turns
    }

    pub fn metadata(&self) -> StateSnapshot {
        StateSnapshot {
            scope: self.scope.clone(),
            branch_epoch: self.branch_epoch,
            display_epoch: self.display_epoch,
            catalog_revision: self.catalog_revision,
            turns: Vec::new(),
            position: self.position.clone(),
            latest_request: self
                .requests
                .values()
                .max_by_key(|request| request.command.seq)
                .map(|request| RequestSummary {
                    request_id: request.command.request_id.clone(),
                    status: request.status.clone(),
                    observation_timed_out: request.observation_timed_out,
                }),
        }
    }

    pub fn apply(&mut self, event: StateEvent, now_ms: u64) -> Result<(), StateError> {
        self.tick(now_ms);
        match event {
            StateEvent::Position { position } => {
                if position.session_id() != self.session_id
                    || position.branch_epoch() < self.branch_epoch
                    || (position.branch_epoch() == self.branch_epoch
                        && (position.display_epoch() < self.display_epoch
                            || position.view_revision() < self.position.view_revision()))
                {
                    return Err(StateError::StalePosition);
                }
                if position.branch_epoch() == self.branch_epoch
                    && position.display_epoch() == self.display_epoch
                    && position.view_revision() == self.position.view_revision()
                    && position != self.position
                {
                    return Err(StateError::StalePosition);
                }
                let new_branch = position.branch_epoch() > self.branch_epoch;
                if new_branch || position.display_epoch() > self.display_epoch {
                    for request in self.requests.values_mut() {
                        if matches!(
                            request.status,
                            RequestStatus::Queued | RequestStatus::Accepted { .. }
                        ) {
                            request.status = RequestStatus::Superseded;
                            request.finished_at = Some(now_ms);
                        }
                    }
                }
                if new_branch {
                    self.turns.clear();
                    self.catalog_revision = 0;
                    self.catalog_ready = false;
                    self.catalog_upload = None;
                    self.expired_snapshot_id = None;
                }
                if new_branch || position.display_epoch() > self.display_epoch {
                    self.observed_frames.clear();
                }
                self.branch_epoch = position.branch_epoch();
                self.display_epoch = position.display_epoch();
                self.position = position;
                Ok(())
            }
            StateEvent::Applied {
                request_id,
                admission_id,
                position,
            } => {
                let request = self
                    .requests
                    .get(&request_id)
                    .ok_or(StateError::UnknownRequest)?;
                if request.admission_id.as_ref() != Some(&admission_id) {
                    return Err(StateError::NotAccepted);
                }
                if self.execution_slot.as_deref() == Some(request_id.as_str())
                    && matches!(
                        request.status,
                        RequestStatus::Superseded | RequestStatus::Cancelled
                    )
                {
                    self.execution_slot = None;
                }
                if let RequestStatus::Applied {
                    position: previous, ..
                } = &request.status
                {
                    return if previous == &position {
                        Ok(())
                    } else {
                        Err(StateError::InvalidEvent)
                    };
                }
                match request.status {
                    RequestStatus::Superseded => return Err(StateError::Superseded),
                    RequestStatus::Cancelled => return Err(StateError::Cancelled),
                    RequestStatus::Accepted { .. } => {}
                    _ => return Err(StateError::NotAccepted),
                }
                let target_matches = match (&request.command.target, &position) {
                    (NavTarget::Live, Position::Live { .. }) => true,
                    (NavTarget::Turn { entry_id: target }, Position::Browsing { entry_id, .. }) => {
                        target == entry_id
                    }
                    _ => false,
                };
                if !target_matches || position.frame_id().is_empty() {
                    return Err(StateError::InvalidEvent);
                }
                if position.session_id() != self.session_id
                    || position.branch_epoch() != self.branch_epoch
                    || position.display_epoch() != self.display_epoch
                    || (position.view_revision() == self.position.view_revision()
                        && position != self.position)
                {
                    return Err(StateError::StalePosition);
                }
                self.prune_frames(now_ms);
                let shown = self
                    .observed_frames
                    .remove(position.frame_id())
                    .is_some_and(|(frame, _)| frame == position);
                if position.view_revision() >= self.position.view_revision() {
                    self.position = position.clone();
                }
                let request = self.requests.get_mut(&request_id).unwrap();
                request.status = RequestStatus::Applied { position, shown };
                request.applied_at = Some(now_ms);
                request.finished_at = Some(now_ms);
                self.execution_slot = None;
                Ok(())
            }
            StateEvent::Failed {
                request_id,
                admission_id,
                error,
            } => {
                let request = self
                    .requests
                    .get_mut(&request_id)
                    .ok_or(StateError::UnknownRequest)?;
                if request.admission_id.as_ref() != Some(&admission_id) {
                    return Err(StateError::NotAccepted);
                }
                if self.execution_slot.as_deref() == Some(request_id.as_str()) {
                    self.execution_slot = None;
                }
                match &request.status {
                    RequestStatus::Accepted { .. } => {
                        request.status = RequestStatus::Failed { error };
                        request.finished_at = Some(now_ms);
                    }
                    RequestStatus::Failed { error: previous } if previous == &error => {}
                    RequestStatus::Superseded => return Err(StateError::Superseded),
                    RequestStatus::Cancelled => return Err(StateError::Cancelled),
                    _ => return Err(StateError::InvalidEvent),
                }
                Ok(())
            }
            StateEvent::Abandoned {
                request_id,
                admission_id,
            } => {
                let request = self
                    .requests
                    .get_mut(&request_id)
                    .ok_or(StateError::UnknownRequest)?;
                if request.admission_id.as_ref() != Some(&admission_id) {
                    return Err(StateError::NotAccepted);
                }
                if !matches!(
                    request.status,
                    RequestStatus::Superseded | RequestStatus::Cancelled
                ) {
                    return Err(StateError::InvalidEvent);
                }
                if request.abandoned {
                    return Ok(());
                }
                if self.execution_slot.as_deref() != Some(request_id.as_str()) {
                    return Err(StateError::NotAccepted);
                }
                request.abandoned = true;
                self.execution_slot = None;
                Ok(())
            }
            StateEvent::CatalogPage {
                snapshot_id,
                branch_epoch,
                catalog_revision,
                page_index,
                page_count,
                turns,
            } => {
                if branch_epoch != self.branch_epoch {
                    return Err(StateError::ResyncRequired);
                }
                self.catalog_page(
                    snapshot_id,
                    catalog_revision,
                    page_index,
                    page_count,
                    turns,
                    now_ms,
                )
            }
            StateEvent::CatalogDelta {
                branch_epoch,
                base_revision,
                catalog_revision,
                changes,
            } => {
                if branch_epoch != self.branch_epoch {
                    return Err(StateError::ResyncRequired);
                }
                self.catalog_delta(base_revision, catalog_revision, changes)
            }
        }
    }

    pub fn observe_frame(&mut self, position: Position, now_ms: u64) -> Result<(), StateError> {
        self.tick(now_ms);
        self.validate_current_position(&position)?;
        if position.frame_id().is_empty() {
            return Err(StateError::InvalidEvent);
        }
        self.prune_frames(now_ms);
        for request in self.requests.values_mut() {
            if let RequestStatus::Applied {
                position: applied,
                shown,
            } = &mut request.status
            {
                if applied == &position
                    && !request.observation_timed_out
                    && self.scope.as_ref().is_some_and(|scope| {
                        scope.scope_id == request.command.scope_id
                            && scope.control_epoch == request.command.control_epoch
                    })
                {
                    *shown = true;
                    return Ok(());
                }
            }
        }
        if !self
            .requests
            .values()
            .any(|request| matches!(request.status, RequestStatus::Accepted { .. }))
        {
            return Ok(());
        }
        if self.observed_frames.len() >= 64 {
            let oldest = self
                .observed_frames
                .iter()
                .min_by_key(|(_, (_, at))| *at)
                .map(|(id, _)| id.clone());
            if let Some(oldest) = oldest {
                self.observed_frames.remove(&oldest);
            }
        }
        self.observed_frames
            .insert(position.frame_id().into(), (position, now_ms));
        Ok(())
    }

    pub fn tick(&mut self, now_ms: u64) -> bool {
        self.now_ms = self.now_ms.max(now_ms);
        let mut changed = false;
        for request in self.requests.values_mut() {
            if request.status == RequestStatus::Queued && now_ms >= request.admission_deadline {
                request.status = RequestStatus::Expired;
                request.finished_at = Some(now_ms);
                changed = true;
            }
            if matches!(request.status, RequestStatus::Applied { shown: false, .. })
                && !request.observation_timed_out
                && request
                    .applied_at
                    .is_some_and(|at| now_ms.saturating_sub(at) >= 10_000)
            {
                request.observation_timed_out = true;
                changed = true;
            }
        }
        let previous_count = self.requests.len();
        self.requests.retain(|_, request| {
            request.command.seq == self.next_seq
                || request
                    .finished_at
                    .is_none_or(|at| now_ms.saturating_sub(at) < 600_000)
        });
        changed |= previous_count != self.requests.len();
        self.prune_frames(now_ms);
        if self
            .catalog_upload
            .as_ref()
            .is_some_and(|upload| now_ms.saturating_sub(upload.started_at) >= 30_000)
        {
            self.expired_snapshot_id = self.catalog_upload.take().map(|upload| upload.snapshot_id);
            changed = true;
        }
        changed
    }

    fn validate_current_position(&self, position: &Position) -> Result<(), StateError> {
        if position.session_id() != self.session_id
            || position.branch_epoch() != self.branch_epoch
            || position.display_epoch() != self.display_epoch
            || position.view_revision() < self.position.view_revision()
        {
            return Err(StateError::StalePosition);
        }
        if position.view_revision() == self.position.view_revision() && position != &self.position {
            return Err(StateError::StalePosition);
        }
        Ok(())
    }

    fn prune_frames(&mut self, now_ms: u64) {
        self.observed_frames
            .retain(|_, (_, at)| now_ms.saturating_sub(*at) < 10_000);
    }

    fn catalog_page(
        &mut self,
        snapshot_id: String,
        revision: u64,
        page_index: u32,
        page_count: u32,
        turns: Vec<Turn>,
        now_ms: u64,
    ) -> Result<(), StateError> {
        if snapshot_id.is_empty()
            || snapshot_id.len() > 256
            || page_count == 0
            || page_count > 1024
            || page_index >= page_count
        {
            return Err(StateError::InvalidEvent);
        }
        if self.expired_snapshot_id.as_ref() == Some(&snapshot_id) {
            return Err(StateError::ResyncRequired);
        }
        validate_turns(&turns)?;
        if self
            .catalog_upload
            .as_ref()
            .is_some_and(|upload| now_ms.saturating_sub(upload.started_at) >= 30_000)
        {
            self.catalog_upload = None;
            return Err(StateError::ResyncRequired);
        }
        if self
            .catalog_upload
            .as_ref()
            .is_none_or(|upload| upload.snapshot_id != snapshot_id)
        {
            if revision < self.catalog_revision {
                return Err(StateError::ResyncRequired);
            }
            self.catalog_upload = Some(CatalogUpload {
                snapshot_id,
                revision,
                page_count,
                pages: BTreeMap::new(),
                deltas: BTreeMap::new(),
                started_at: now_ms,
                committed: false,
            });
        }
        let upload = self.catalog_upload.as_mut().unwrap();
        if upload.revision != revision || upload.page_count != page_count {
            self.catalog_upload = None;
            return Err(StateError::ResyncRequired);
        }
        if let Some(previous) = upload.pages.get(&page_index) {
            if previous != &turns {
                self.catalog_upload = None;
                return Err(StateError::ResyncRequired);
            }
            return Ok(());
        }
        upload.pages.insert(page_index, turns);
        let total_bytes: usize = upload.pages.values().flatten().map(turn_bytes).sum();
        let total_count: usize = upload.pages.values().map(Vec::len).sum();
        if total_bytes > 16 * 1024 * 1024 || total_count > 100_000 {
            self.catalog_upload = None;
            return Err(StateError::ResourceLimit);
        }
        if upload.pages.len() != upload.page_count as usize {
            return Ok(());
        }
        let mut candidate: Vec<Turn> = upload.pages.values().flatten().cloned().collect();
        let mut candidate_revision = upload.revision;
        if let Err(error) = validate_turns(&candidate) {
            self.catalog_upload = None;
            return Err(error);
        }
        for (base, delta) in &upload.deltas {
            if *base != candidate_revision {
                self.catalog_upload = None;
                return Err(StateError::ResyncRequired);
            }
            if let Err(error) = apply_changes(&mut candidate, &delta.changes) {
                self.catalog_upload = None;
                return Err(error);
            }
            candidate_revision = delta.revision;
        }
        self.turns = candidate;
        self.catalog_revision = candidate_revision;
        self.catalog_ready = true;
        let upload = self.catalog_upload.as_mut().unwrap();
        upload.deltas.clear();
        upload.committed = true;
        Ok(())
    }

    fn catalog_delta(
        &mut self,
        base_revision: u64,
        revision: u64,
        changes: Vec<CatalogChange>,
    ) -> Result<(), StateError> {
        if revision <= base_revision {
            return Err(StateError::InvalidEvent);
        }
        let delta_bytes: usize = changes
            .iter()
            .map(|change| match change {
                CatalogChange::Append { turn } | CatalogChange::Update { turn } => turn_bytes(turn),
            })
            .sum();
        if changes.len() > 1024 || delta_bytes > 1024 * 1024 {
            self.catalog_upload = None;
            return Err(StateError::ResourceLimit);
        }
        if let Some(upload) = self
            .catalog_upload
            .as_mut()
            .filter(|upload| !upload.committed)
        {
            if base_revision < upload.revision {
                return Err(StateError::ResyncRequired);
            }
            let delta = CatalogRevisionDelta { revision, changes };
            if let Some(previous) = upload.deltas.get(&base_revision) {
                return if previous == &delta {
                    Ok(())
                } else {
                    Err(StateError::ResyncRequired)
                };
            }
            upload.deltas.insert(base_revision, delta);
            let count: usize = upload
                .deltas
                .values()
                .map(|delta| delta.changes.len())
                .sum();
            let bytes: usize = upload
                .deltas
                .values()
                .flat_map(|delta| &delta.changes)
                .map(|change| match change {
                    CatalogChange::Append { turn } | CatalogChange::Update { turn } => {
                        turn_bytes(turn)
                    }
                })
                .sum();
            if upload.deltas.len() > 1024 || count > 1024 || bytes > 1024 * 1024 {
                self.catalog_upload = None;
                return Err(StateError::ResourceLimit);
            }
            return Ok(());
        }
        if !self.catalog_ready {
            return Err(StateError::ResyncRequired);
        }
        if revision <= self.catalog_revision {
            return Ok(());
        }
        if base_revision != self.catalog_revision {
            return Err(StateError::ResyncRequired);
        }
        let mut candidate = self.turns.clone();
        apply_changes(&mut candidate, &changes)?;
        self.turns = candidate;
        self.catalog_revision = revision;
        Ok(())
    }
}

fn turn_bytes(turn: &Turn) -> usize {
    turn.entry_id
        .len()
        .saturating_add(turn.preview.len())
        .saturating_add(32)
}

fn validate_entry_id(entry_id: &str) -> Result<(), StateError> {
    if entry_id.is_empty() || entry_id.len() > MAX_ENTRY_ID_BYTES {
        return Err(StateError::ResourceLimit);
    }
    Ok(())
}

fn validate_turns(turns: &[Turn]) -> Result<(), StateError> {
    if turns.len() > 100_000 || turns.iter().map(turn_bytes).sum::<usize>() > 16 * 1024 * 1024 {
        return Err(StateError::ResourceLimit);
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut ordinal = 0;
    for turn in turns {
        validate_entry_id(&turn.entry_id)?;
        if turn.preview.len() > 4096 {
            return Err(StateError::ResourceLimit);
        }
        if turn.ordinal <= ordinal || !ids.insert(&turn.entry_id) {
            return Err(StateError::InvalidEvent);
        }
        ordinal = turn.ordinal;
    }
    Ok(())
}

fn apply_changes(turns: &mut Vec<Turn>, changes: &[CatalogChange]) -> Result<(), StateError> {
    for change in changes {
        match change {
            CatalogChange::Append { turn } => turns.push(turn.clone()),
            CatalogChange::Update { turn } => {
                let previous = turns
                    .iter_mut()
                    .find(|previous| previous.entry_id == turn.entry_id)
                    .ok_or(StateError::ResyncRequired)?;
                if previous.ordinal != turn.ordinal {
                    return Err(StateError::ResyncRequired);
                }
                *previous = turn.clone();
            }
        }
    }
    validate_turns(turns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn selecting_a_new_turn_delivers_only_the_latest_target() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Turn {
                        entry_id: "turn-1".into(),
                    },
                },
                100,
            )
            .unwrap();
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-2".into(),
                    scope,
                    target: NavTarget::Turn {
                        entry_id: "turn-2".into(),
                    },
                },
                101,
            )
            .unwrap();
        let command = state.poll(0, 102).unwrap();
        assert_eq!(
            serde_json::to_value(command).unwrap(),
            json!({
                "requestId": "request-2", "seq": 2, "scopeId": "scope-1", "controlEpoch": 1,
                "displayEpoch": 0, "branchEpoch": 0, "sessionId": "session-1",
                "target": { "kind": "turn", "entryId": "turn-2" },
                "remainingAdmissionTtlMs": 4999, "executionBudgetMs": 5000
            })
        );
        assert_eq!(
            state.request_status("request-1"),
            Some(&RequestStatus::Superseded)
        );
        assert!(state.poll(2, 102).is_none());
    }

    #[test]
    fn admission_is_idempotent_and_expiration_applies_only_before_acceptance() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        let accepted = state
            .accept("request-1", "admission-1".into(), 5099)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&accepted).unwrap(),
            json!({
                "requestId": "request-1", "admissionId": "admission-1", "executionBudgetMs": 5000
            })
        );
        assert_eq!(
            state
                .accept("request-1", "retry-admission".into(), 6000)
                .unwrap(),
            accepted
        );
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-2".into(),
                    scope,
                    target: NavTarget::Live,
                },
                6000,
            )
            .unwrap();
        assert_eq!(
            state.accept("request-2", "too-late".into(), 11000),
            Err(StateError::Expired)
        );
        assert_eq!(
            state.request_status("request-2"),
            Some(&RequestStatus::Expired)
        );
    }

    #[test]
    fn snapshot_exposes_the_latest_request_without_authentication_material() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope,
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(state.snapshot()).unwrap(),
            json!({
                "scope": { "scopeId": "scope-1", "controlEpoch": 1 },
                "branchEpoch": 0, "displayEpoch": 0, "catalogRevision": 0, "turns": [],
                "position": { "mode": "live", "sessionId": "session-1", "branchEpoch": 0,
                    "displayEpoch": 0, "viewRevision": 0, "frameId": "" },
                "latestRequest": { "requestId": "request-1", "status": { "kind": "queued" }, "observationTimedOut": false }
            })
        );
    }

    #[test]
    fn local_input_and_branch_changes_reject_old_remote_navigation() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .apply(
                StateEvent::Position {
                    position: Position::Live {
                        session_id: "session-1".into(),
                        branch_epoch: 0,
                        display_epoch: 1,
                        view_revision: 1,
                        frame_id: "local-input".into(),
                    },
                },
                101,
            )
            .unwrap();
        assert_eq!(
            state.accept("request-1", "old".into(), 102),
            Err(StateError::Superseded)
        );
        let command = state
            .enqueue(
                NavigationIntent {
                    request_id: "request-2".into(),
                    scope,
                    target: NavTarget::Live,
                },
                103,
            )
            .unwrap();
        assert_eq!(command.display_epoch, 1);
        state
            .accept("request-2", "admission-2".into(), 104)
            .unwrap();
        state
            .apply(
                StateEvent::Position {
                    position: Position::Live {
                        session_id: "session-1".into(),
                        branch_epoch: 2,
                        display_epoch: 2,
                        view_revision: 2,
                        frame_id: "new-branch".into(),
                    },
                },
                105,
            )
            .unwrap();
        assert_eq!(
            state.request_status("request-2"),
            Some(&RequestStatus::Superseded)
        );
        assert_eq!(state.snapshot().branch_epoch, 2);
        assert!(state.poll(0, 106).is_none());
    }

    #[test]
    fn shown_requires_matching_trusted_result_and_terminal_frame_in_either_order() {
        for frame_first in [true, false] {
            let mut state = NavigationState::new("session-1".into());
            let scope = state.begin_scope(Scope {
                scope_id: "scope-1".into(),
                control_epoch: 1,
            });
            state
                .enqueue(
                    NavigationIntent {
                        request_id: "request-1".into(),
                        scope,
                        target: NavTarget::Turn {
                            entry_id: "turn-1".into(),
                        },
                    },
                    100,
                )
                .unwrap();
            state
                .accept("request-1", "admission-1".into(), 101)
                .unwrap();
            let position = Position::Browsing {
                session_id: "session-1".into(),
                branch_epoch: 0,
                display_epoch: 0,
                view_revision: 1,
                frame_id: "frame-1".into(),
                entry_id: "turn-1".into(),
                anchor: SourceAnchor {
                    part_id: "body".into(),
                    scalar_offset: 0,
                },
            };
            let event = StateEvent::Applied {
                request_id: "request-1".into(),
                admission_id: "admission-1".into(),
                position: position.clone(),
            };
            if frame_first {
                state.observe_frame(position.clone(), 102).unwrap();
                assert_eq!(state.snapshot().position.view_revision(), 0);
                state.apply(event.clone(), 103).unwrap();
            } else {
                state.apply(event.clone(), 102).unwrap();
                assert_eq!(
                    state.request_status("request-1"),
                    Some(&RequestStatus::Applied {
                        position: position.clone(),
                        shown: false
                    })
                );
                state.observe_frame(position.clone(), 103).unwrap();
            }
            assert_eq!(
                state.request_status("request-1"),
                Some(&RequestStatus::Applied {
                    position: position.clone(),
                    shown: true
                })
            );
            state.apply(event, 104).unwrap();
            assert_eq!(state.snapshot().position, position);
        }
    }

    #[test]
    fn catalog_pages_commit_atomically_with_contiguous_buffered_deltas() {
        let mut state = NavigationState::new("session-1".into());
        let turn = |id: &str, ordinal| Turn {
            entry_id: id.into(),
            ordinal,
            preview: format!("Question {ordinal}"),
            created_at: 100 + ordinal,
        };
        let second_page = StateEvent::CatalogPage {
            snapshot_id: "snapshot-1".into(),
            branch_epoch: 0,
            catalog_revision: 4,
            page_index: 1,
            page_count: 2,
            turns: vec![turn("turn-2", 2)],
        };
        state.apply(second_page.clone(), 100).unwrap();
        assert_eq!(state.snapshot().turns, vec![]);
        assert_eq!(state.snapshot().catalog_revision, 0);
        state
            .apply(
                StateEvent::CatalogDelta {
                    branch_epoch: 0,
                    base_revision: 4,
                    catalog_revision: 5,
                    changes: vec![CatalogChange::Append {
                        turn: turn("turn-3", 3),
                    }],
                },
                101,
            )
            .unwrap();
        assert_eq!(state.snapshot().catalog_revision, 0);
        state
            .apply(
                StateEvent::CatalogPage {
                    snapshot_id: "snapshot-1".into(),
                    branch_epoch: 0,
                    catalog_revision: 4,
                    page_index: 0,
                    page_count: 2,
                    turns: vec![turn("turn-1", 1)],
                },
                102,
            )
            .unwrap();
        assert_eq!(
            state.snapshot().turns,
            vec![turn("turn-1", 1), turn("turn-2", 2), turn("turn-3", 3)]
        );
        assert_eq!(state.snapshot().catalog_revision, 5);
        state.apply(second_page, 103).unwrap();
        assert_eq!(state.snapshot().catalog_revision, 5);
    }

    #[test]
    fn closing_a_scope_blocks_late_results_without_closing_a_new_scope() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        state.end_scope(&scope).unwrap();
        state.end_scope(&scope).unwrap();
        assert_eq!(
            state.apply(
                StateEvent::Applied {
                    request_id: "request-1".into(),
                    admission_id: "admission-1".into(),
                    position: Position::Live {
                        session_id: "session-1".into(),
                        branch_epoch: 0,
                        display_epoch: 0,
                        view_revision: 1,
                        frame_id: "late".into()
                    }
                },
                102
            ),
            Err(StateError::Superseded)
        );
        let new_scope = state.begin_scope(Scope {
            scope_id: "scope-2".into(),
            control_epoch: 2,
        });
        assert_eq!(state.end_scope(&scope), Err(StateError::StaleScope));
        assert_eq!(state.snapshot().scope, Some(new_scope));
        assert_eq!(state.snapshot().position.view_revision(), 0);
    }

    #[test]
    fn tick_expires_unaccepted_work_and_reclaims_terminal_cache() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        for index in 0..1024 {
            state
                .enqueue(
                    NavigationIntent {
                        request_id: format!("request-{index}"),
                        scope: scope.clone(),
                        target: NavTarget::Live,
                    },
                    100,
                )
                .unwrap();
        }
        assert_eq!(
            state.enqueue(
                NavigationIntent {
                    request_id: "overflow".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live
                },
                101
            ),
            Err(StateError::ResourceLimit)
        );
        assert!(state.tick(5100));
        assert!(state.poll(0, 5100).is_none());
        assert_eq!(
            state.request_status("request-1023"),
            Some(&RequestStatus::Expired)
        );
        state.tick(605_100);
        assert!(state
            .enqueue(
                NavigationIntent {
                    request_id: "after-cache-expiry".into(),
                    scope,
                    target: NavTarget::Live
                },
                605_101
            )
            .is_ok());
    }

    #[test]
    fn observation_timeout_preserves_applied_fact_without_automatic_navigation() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope,
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        let position = Position::Live {
            session_id: "session-1".into(),
            branch_epoch: 0,
            display_epoch: 0,
            view_revision: 1,
            frame_id: "frame-1".into(),
        };
        state
            .apply(
                StateEvent::Applied {
                    request_id: "request-1".into(),
                    admission_id: "admission-1".into(),
                    position: position.clone(),
                },
                102,
            )
            .unwrap();
        state.tick(10_102);
        assert!(
            state
                .snapshot()
                .latest_request
                .unwrap()
                .observation_timed_out
        );
        state.observe_frame(position.clone(), 10_103).unwrap();
        assert_eq!(
            state.request_status("request-1"),
            Some(&RequestStatus::Applied {
                position: position.clone(),
                shown: false
            })
        );
        assert_eq!(state.snapshot().position, position);
        assert!(state.poll(0, 10_104).is_none());
    }

    #[test]
    fn conflicting_catalog_pages_and_revision_gaps_preserve_committed_catalog() {
        let mut state = NavigationState::new("session-1".into());
        let turn = |id: &str, ordinal| Turn {
            entry_id: id.into(),
            ordinal,
            preview: id.into(),
            created_at: ordinal,
        };
        let page = |snapshot: &str, revision, index, turns| StateEvent::CatalogPage {
            snapshot_id: snapshot.into(),
            branch_epoch: 0,
            catalog_revision: revision,
            page_index: index,
            page_count: if revision == 1 { 1 } else { 2 },
            turns,
        };
        state
            .apply(page("committed", 1, 0, vec![turn("turn-1", 1)]), 100)
            .unwrap();
        state
            .apply(page("conflict", 2, 0, vec![turn("turn-1", 1)]), 101)
            .unwrap();
        assert_eq!(
            state.apply(page("conflict", 2, 0, vec![turn("different", 1)]), 102),
            Err(StateError::ResyncRequired)
        );
        state
            .apply(page("gap", 3, 0, vec![turn("turn-1", 1)]), 103)
            .unwrap();
        state
            .apply(
                StateEvent::CatalogDelta {
                    branch_epoch: 0,
                    base_revision: 4,
                    catalog_revision: 5,
                    changes: vec![CatalogChange::Append {
                        turn: turn("turn-3", 3),
                    }],
                },
                104,
            )
            .unwrap();
        assert_eq!(
            state.apply(page("gap", 3, 1, vec![turn("turn-2", 2)]), 105),
            Err(StateError::ResyncRequired)
        );
        assert_eq!(state.snapshot().turns, vec![turn("turn-1", 1)]);
        assert_eq!(state.snapshot().catalog_revision, 1);
        state
            .apply(page("expired", 4, 0, vec![turn("turn-1", 1)]), 106)
            .unwrap();
        state.tick(30_106);
        assert_eq!(
            state.apply(page("expired", 4, 1, vec![turn("turn-2", 2)]), 30_107),
            Err(StateError::ResyncRequired)
        );
        assert_eq!(state.snapshot().catalog_revision, 1);
    }

    #[test]
    fn catalog_delta_validation_is_atomic_and_branch_changes_drop_staging() {
        let mut state = NavigationState::new("session-1".into());
        let turn = |id: &str, ordinal| Turn {
            entry_id: id.into(),
            ordinal,
            preview: id.into(),
            created_at: ordinal,
        };
        state
            .apply(
                StateEvent::CatalogPage {
                    snapshot_id: "snapshot-1".into(),
                    branch_epoch: 0,
                    catalog_revision: 1,
                    page_index: 0,
                    page_count: 1,
                    turns: vec![turn("turn-1", 1)],
                },
                100,
            )
            .unwrap();
        assert_eq!(
            state.apply(
                StateEvent::CatalogDelta {
                    branch_epoch: 0,
                    base_revision: 1,
                    catalog_revision: 2,
                    changes: vec![
                        CatalogChange::Append {
                            turn: turn("turn-2", 2)
                        },
                        CatalogChange::Append {
                            turn: turn("turn-1", 3)
                        }
                    ]
                },
                101
            ),
            Err(StateError::InvalidEvent)
        );
        assert_eq!(state.snapshot().turns, vec![turn("turn-1", 1)]);
        state
            .apply(
                StateEvent::Position {
                    position: Position::Live {
                        session_id: "session-1".into(),
                        branch_epoch: 1,
                        display_epoch: 1,
                        view_revision: 2,
                        frame_id: "branch-1".into(),
                    },
                },
                102,
            )
            .unwrap();
        assert_eq!(state.snapshot().turns, vec![]);
        assert_eq!(state.snapshot().catalog_revision, 0);
        assert_eq!(
            state.apply(
                StateEvent::CatalogDelta {
                    branch_epoch: 0,
                    base_revision: 1,
                    catalog_revision: 2,
                    changes: vec![]
                },
                103
            ),
            Err(StateError::ResyncRequired)
        );
    }

    #[test]
    fn late_frames_cannot_roll_back_a_newer_view_after_a_delayed_result() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope,
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        let old_position = Position::Live {
            session_id: "session-1".into(),
            branch_epoch: 0,
            display_epoch: 0,
            view_revision: 1,
            frame_id: "frame-1".into(),
        };
        state.observe_frame(old_position.clone(), 102).unwrap();
        state
            .apply(
                StateEvent::Position {
                    position: Position::Live {
                        session_id: "session-1".into(),
                        branch_epoch: 0,
                        display_epoch: 0,
                        view_revision: 2,
                        frame_id: "frame-2".into(),
                    },
                },
                103,
            )
            .unwrap();
        assert_eq!(
            state.apply(
                StateEvent::Applied {
                    request_id: "request-1".into(),
                    admission_id: "admission-1".into(),
                    position: old_position.clone()
                },
                104
            ),
            Ok(())
        );
        assert_eq!(
            state.observe_frame(old_position, 105),
            Err(StateError::StalePosition)
        );
        assert_eq!(state.snapshot().position.view_revision(), 2);
    }

    #[test]
    fn empty_delta_records_are_bounded_while_a_catalog_snapshot_is_incomplete() {
        let mut state = NavigationState::new("session-1".into());
        state
            .apply(
                StateEvent::CatalogPage {
                    snapshot_id: "snapshot-1".into(),
                    branch_epoch: 0,
                    catalog_revision: 1,
                    page_index: 0,
                    page_count: 2,
                    turns: vec![],
                },
                100,
            )
            .unwrap();
        for revision in 1..=1024 {
            state
                .apply(
                    StateEvent::CatalogDelta {
                        branch_epoch: 0,
                        base_revision: revision,
                        catalog_revision: revision + 1,
                        changes: vec![],
                    },
                    101,
                )
                .unwrap();
        }
        assert_eq!(
            state.apply(
                StateEvent::CatalogDelta {
                    branch_epoch: 0,
                    base_revision: 1025,
                    catalog_revision: 1026,
                    changes: vec![]
                },
                102
            ),
            Err(StateError::ResourceLimit)
        );
        assert_eq!(state.snapshot().catalog_revision, 0);
    }

    #[test]
    fn retried_identical_intents_keep_the_original_sequence_and_admission() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        let intent = NavigationIntent {
            request_id: "request-1".into(),
            scope: scope.clone(),
            target: NavTarget::Live,
        };
        state.enqueue(intent.clone(), 100).unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        let retry = state.enqueue(intent, 102).unwrap();
        assert_eq!(retry.seq, 1);
        assert_eq!(retry.remaining_admission_ttl_ms, 4998);
        assert_eq!(
            state.request_status("request-1"),
            Some(&RequestStatus::Accepted {
                admission_id: "admission-1".into()
            })
        );
        assert_eq!(
            state.enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope,
                    target: NavTarget::Turn {
                        entry_id: "different".into()
                    }
                },
                103
            ),
            Err(StateError::DuplicateRequest)
        );
    }

    #[test]
    fn failed_results_are_idempotent_but_mismatched_admissions_cannot_finish_requests() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope,
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        assert_eq!(
            state.apply(
                StateEvent::Failed {
                    request_id: "request-1".into(),
                    admission_id: "wrong".into(),
                    error: "busy_modal".into()
                },
                102
            ),
            Err(StateError::NotAccepted)
        );
        let event = StateEvent::Failed {
            request_id: "request-1".into(),
            admission_id: "admission-1".into(),
            error: "busy_modal".into(),
        };
        state.apply(event.clone(), 103).unwrap();
        state.apply(event, 104).unwrap();
        assert_eq!(
            state.request_status("request-1"),
            Some(&RequestStatus::Failed {
                error: "busy_modal".into()
            })
        );
        assert_eq!(state.snapshot().position.view_revision(), 0);
    }

    #[test]
    fn deltas_require_an_initial_committed_snapshot_even_when_revision_is_zero() {
        let mut state = NavigationState::new("session-1".into());
        let delta = StateEvent::CatalogDelta {
            branch_epoch: 0,
            base_revision: 0,
            catalog_revision: 1,
            changes: vec![],
        };
        assert_eq!(
            state.apply(delta.clone(), 100),
            Err(StateError::ResyncRequired)
        );
        state
            .apply(
                StateEvent::CatalogPage {
                    snapshot_id: "initial".into(),
                    branch_epoch: 0,
                    catalog_revision: 0,
                    page_index: 0,
                    page_count: 1,
                    turns: vec![],
                },
                101,
            )
            .unwrap();
        state.apply(delta, 102).unwrap();
        assert_eq!(state.snapshot().catalog_revision, 1);
    }

    #[test]
    fn position_metadata_does_not_copy_the_committed_catalog() {
        let mut state = NavigationState::new("session-1".into());
        let turn = Turn {
            entry_id: "turn-1".into(),
            ordinal: 1,
            preview: "Question".into(),
            created_at: 1,
        };
        state
            .apply(
                StateEvent::CatalogPage {
                    snapshot_id: "snapshot-1".into(),
                    branch_epoch: 0,
                    catalog_revision: 1,
                    page_index: 0,
                    page_count: 1,
                    turns: vec![turn.clone()],
                },
                100,
            )
            .unwrap();
        assert_eq!(state.metadata().turns, vec![]);
        assert_eq!(state.metadata().catalog_revision, 1);
        assert_eq!(state.catalog(), &[turn]);
    }

    #[test]
    fn only_one_execution_is_admitted_until_a_superseded_request_finishes() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-2".into(),
                    scope,
                    target: NavTarget::Live,
                },
                102,
            )
            .unwrap();
        assert_eq!(
            state.accept("request-2", "admission-2".into(), 103),
            Err(StateError::Busy)
        );
        assert_eq!(
            state.apply(
                StateEvent::Failed {
                    request_id: "request-1".into(),
                    admission_id: "admission-1".into(),
                    error: "superseded".into()
                },
                104
            ),
            Err(StateError::Superseded)
        );
        assert_eq!(
            state
                .accept("request-2", "admission-2".into(), 105)
                .unwrap()
                .admission_id,
            "admission-2"
        );
        assert_eq!(state.snapshot().position.view_revision(), 0);
    }

    #[test]
    fn conflicting_positions_cannot_share_a_view_revision() {
        let mut state = NavigationState::new("session-1".into());
        let position = Position::Live {
            session_id: "session-1".into(),
            branch_epoch: 0,
            display_epoch: 0,
            view_revision: 1,
            frame_id: "frame-1".into(),
        };
        state
            .apply(
                StateEvent::Position {
                    position: position.clone(),
                },
                100,
            )
            .unwrap();
        state
            .apply(
                StateEvent::Position {
                    position: position.clone(),
                },
                101,
            )
            .unwrap();
        assert_eq!(
            state.apply(
                StateEvent::Position {
                    position: Position::Live {
                        session_id: "session-1".into(),
                        branch_epoch: 0,
                        display_epoch: 0,
                        view_revision: 1,
                        frame_id: "different-frame".into()
                    }
                },
                102
            ),
            Err(StateError::StalePosition)
        );
        assert_eq!(state.snapshot().position, position);
    }

    #[test]
    fn authorization_rechecks_latest_scope_after_a_delayed_admission_response() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        let admission = state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        assert_eq!(
            state.authorize("request-1", "admission-1", 102).unwrap(),
            admission
        );
        assert_eq!(
            state.authorize("request-1", "wrong-admission", 102),
            Err(StateError::NotAccepted)
        );
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-2".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                103,
            )
            .unwrap();
        assert_eq!(
            state.authorize("request-1", "admission-1", 104),
            Err(StateError::Superseded)
        );
        assert_eq!(
            state
                .accept("request-1", "lost-response-retry".into(), 105)
                .unwrap(),
            admission
        );
        assert_eq!(
            state.apply(
                StateEvent::Failed {
                    request_id: "request-1".into(),
                    admission_id: "admission-1".into(),
                    error: "superseded".into()
                },
                106
            ),
            Err(StateError::Superseded)
        );
        state
            .accept("request-2", "admission-2".into(), 107)
            .unwrap();
        state.end_scope(&scope).unwrap();
        assert_eq!(
            state.authorize("request-2", "admission-2", 108),
            Err(StateError::Superseded)
        );
        assert_eq!(
            state
                .accept("request-2", "another-retry".into(), 109)
                .unwrap()
                .admission_id,
            "admission-2"
        );
    }

    #[test]
    fn unaccepted_superseded_work_never_receives_an_admission() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-2".into(),
                    scope,
                    target: NavTarget::Live,
                },
                101,
            )
            .unwrap();
        assert_eq!(
            state.accept("request-1", "invalid".into(), 102),
            Err(StateError::Superseded)
        );
        assert_eq!(
            state.authorize("request-1", "invalid", 103),
            Err(StateError::NotAccepted)
        );
    }

    #[test]
    fn abandoning_superseded_admissions_is_idempotent_and_cannot_release_another_execution() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                100,
            )
            .unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        let abandoned = StateEvent::Abandoned {
            request_id: "request-1".into(),
            admission_id: "admission-1".into(),
        };
        assert_eq!(
            state.apply(abandoned.clone(), 102),
            Err(StateError::InvalidEvent)
        );
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-2".into(),
                    scope: scope.clone(),
                    target: NavTarget::Live,
                },
                103,
            )
            .unwrap();
        assert_eq!(
            state.apply(
                StateEvent::Abandoned {
                    request_id: "request-1".into(),
                    admission_id: "wrong".into()
                },
                104
            ),
            Err(StateError::NotAccepted)
        );
        state.apply(abandoned.clone(), 105).unwrap();
        assert_eq!(
            state.request_status("request-1"),
            Some(&RequestStatus::Superseded)
        );
        state
            .accept("request-2", "admission-2".into(), 106)
            .unwrap();
        state.apply(abandoned, 107).unwrap();
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-3".into(),
                    scope,
                    target: NavTarget::Live,
                },
                108,
            )
            .unwrap();
        assert_eq!(
            state.accept("request-3", "admission-3".into(), 109),
            Err(StateError::Busy)
        );
        state
            .apply(
                StateEvent::Abandoned {
                    request_id: "request-2".into(),
                    admission_id: "admission-2".into(),
                },
                110,
            )
            .unwrap();
        state
            .accept("request-3", "admission-3".into(), 111)
            .unwrap();
        assert_eq!(state.snapshot().position.view_revision(), 0);
    }

    #[test]
    fn invalid_turn_targets_do_not_enter_the_queue_or_replace_the_latest_intent() {
        for invalid in [
            "x".repeat(1_000_000),
            String::new(),
            "x".repeat(257),
            "é".repeat(129),
        ] {
            let mut state = NavigationState::new("session-1".into());
            let scope = state.begin_scope(Scope {
                scope_id: "scope-1".into(),
                control_epoch: 1,
            });
            let result = state.enqueue(
                NavigationIntent {
                    request_id: "invalid-empty-queue".into(),
                    scope: scope.clone(),
                    target: NavTarget::Turn {
                        entry_id: invalid.clone(),
                    },
                },
                100,
            );
            assert!(
                matches!(result, Err(StateError::ResourceLimit)),
                "invalid target length {} was accepted",
                invalid.len()
            );
            assert!(state.poll(0, 101).is_none());
            assert!(state.snapshot().latest_request.is_none());
            let valid = state
                .enqueue(
                    NavigationIntent {
                        request_id: "valid".into(),
                        scope: scope.clone(),
                        target: NavTarget::Turn {
                            entry_id: "é".repeat(128),
                        },
                    },
                    102,
                )
                .unwrap();
            assert_eq!(valid.seq, 1);
            let snapshot = state.snapshot();
            let result = state.enqueue(
                NavigationIntent {
                    request_id: "invalid-after-valid".into(),
                    scope,
                    target: NavTarget::Turn { entry_id: invalid },
                },
                103,
            );
            assert!(matches!(result, Err(StateError::ResourceLimit)));
            assert_eq!(state.snapshot(), snapshot);
            assert_eq!(state.poll(0, 104).unwrap().request_id, "valid");
        }
    }

    #[test]
    fn observed_seek_application_is_retained_after_a_newer_trusted_highlight_frame() {
        let mut state = NavigationState::new("session-1".into());
        let scope = state.begin_scope(Scope {
            scope_id: "scope-1".into(),
            control_epoch: 1,
        });
        state
            .enqueue(
                NavigationIntent {
                    request_id: "request-1".into(),
                    scope,
                    target: NavTarget::Turn {
                        entry_id: "turn-1".into(),
                    },
                },
                100,
            )
            .unwrap();
        state
            .accept("request-1", "admission-1".into(), 101)
            .unwrap();
        let original = Position::Browsing {
            session_id: "session-1".into(),
            branch_epoch: 0,
            display_epoch: 0,
            view_revision: 1,
            frame_id: "seek-frame".into(),
            entry_id: "turn-1".into(),
            anchor: SourceAnchor {
                part_id: "body".into(),
                scalar_offset: 0,
            },
        };
        state.observe_frame(original.clone(), 102).unwrap();
        state
            .apply(
                StateEvent::Position {
                    position: Position::Browsing {
                        session_id: "session-1".into(),
                        branch_epoch: 0,
                        display_epoch: 0,
                        view_revision: 2,
                        frame_id: "highlight-frame".into(),
                        entry_id: "turn-1".into(),
                        anchor: SourceAnchor {
                            part_id: "body".into(),
                            scalar_offset: 0,
                        },
                    },
                },
                103,
            )
            .unwrap();
        assert_eq!(
            state.apply(
                StateEvent::Applied {
                    request_id: "request-1".into(),
                    admission_id: "admission-1".into(),
                    position: Position::Browsing {
                        session_id: "session-1".into(),
                        branch_epoch: 0,
                        display_epoch: 0,
                        view_revision: 2,
                        frame_id: "conflicting-frame".into(),
                        entry_id: "turn-1".into(),
                        anchor: SourceAnchor {
                            part_id: "body".into(),
                            scalar_offset: 0
                        }
                    }
                },
                104
            ),
            Err(StateError::StalePosition)
        );
        state
            .apply(
                StateEvent::Applied {
                    request_id: "request-1".into(),
                    admission_id: "admission-1".into(),
                    position: original,
                },
                105,
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(state.snapshot()).unwrap(),
            json!({
                "scope": { "scopeId": "scope-1", "controlEpoch": 1 }, "branchEpoch": 0, "displayEpoch": 0,
                "catalogRevision": 0, "turns": [],
                "position": { "mode": "browsing", "sessionId": "session-1", "branchEpoch": 0, "displayEpoch": 0, "viewRevision": 2, "frameId": "highlight-frame", "entryId": "turn-1", "anchor": { "partId": "body", "scalarOffset": 0 } },
                "latestRequest": { "requestId": "request-1", "observationTimedOut": false, "status": { "kind": "applied", "shown": true,
                    "position": { "mode": "browsing", "sessionId": "session-1", "branchEpoch": 0, "displayEpoch": 0, "viewRevision": 1, "frameId": "seek-frame", "entryId": "turn-1", "anchor": { "partId": "body", "scalarOffset": 0 } }
                } }
            })
        );
    }
}
