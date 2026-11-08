use crate::hook_identity::{HookOrigin, ProcessKey};
use crate::hooks::{
    heartbeat_timeout_ms, map_event_to_status, map_source_to_ai_type, AgentState, AgentStatus,
};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentUpdate {
    pub pane_id: String,
    pub revision: u64,
    pub agent: Option<AgentState>,
}

pub(crate) struct HookEvent<'a> {
    pub pane_id: &'a str,
    pub root: ProcessKey,
    pub actor: Option<ProcessKey>,
    pub source: &'a str,
    pub event: &'a str,
    pub role: &'a str,
    pub origin: &'a HookOrigin,
    pub enabled: bool,
    pub now: u64,
    pub nested: bool,
}

struct Lease {
    root: ProcessKey,
    actor: ProcessKey,
    source: String,
    instance_id: Option<String>,
    conversation_id: Option<String>,
    sequence: u64,
    last_seen: u64,
    status: Option<AgentStatus>,
    revision: u64,
    fresh_after: u64,
}

#[derive(Default)]
pub(crate) struct AgentRegistry {
    panes: HashMap<String, Lease>,
    revision: u64,
}

impl AgentRegistry {
    pub fn current_update(&self, pane_id: &str) -> Option<AgentUpdate> {
        let lease = self.panes.get(pane_id)?;
        Some(AgentUpdate {
            pane_id: pane_id.into(),
            revision: lease.revision,
            agent: lease.status.map(|status| AgentState {
                ai_type: map_source_to_ai_type(&lease.source).unwrap(),
                status,
            }),
        })
    }

    #[cfg(test)]
    pub fn current_actor(&self, pane_id: &str) -> Option<ProcessKey> {
        self.panes.get(pane_id).map(|lease| lease.actor)
    }

    pub fn actor_for_root(&self, pane_id: &str, root: ProcessKey) -> Option<ProcessKey> {
        self.panes
            .get(pane_id)
            .filter(|lease| lease.root == root)
            .map(|lease| lease.actor)
    }

    pub fn cached_actor(
        &self,
        pane_id: &str,
        root: ProcessKey,
        origin: &HookOrigin,
    ) -> Option<ProcessKey> {
        let lease = self.panes.get(pane_id)?;
        (lease.root == root
            && origin.process_id == lease.actor.pid
            && origin.instance_id.is_some()
            && origin.instance_id == lease.instance_id)
            .then_some(lease.actor)
    }

    pub(crate) fn verified_omp_actor(
        &self,
        pane_id: &str,
        root: ProcessKey,
        origin: &HookOrigin,
    ) -> Option<ProcessKey> {
        let lease = self.panes.get(pane_id)?;
        (lease.root == root
            && lease.source == "omp"
            && lease.status.is_some()
            && origin.process_id == lease.actor.pid
            && origin.instance_id.as_ref().is_some_and(|id| !id.is_empty())
            && origin.instance_id == lease.instance_id
            && origin.conversation_id.as_ref().is_some_and(|id| !id.is_empty())
            && origin.conversation_id == lease.conversation_id
            && origin.parent_conversation_id.is_none())
            .then_some(lease.actor)
    }

    fn publish(&mut self, pane_id: &str) -> AgentUpdate {
        self.revision += 1;
        let lease = self.panes.get_mut(pane_id).unwrap();
        lease.revision = self.revision;
        AgentUpdate {
            pane_id: pane_id.into(),
            revision: self.revision,
            agent: lease.status.map(|status| AgentState {
                ai_type: map_source_to_ai_type(&lease.source).unwrap(),
                status,
            }),
        }
    }

    pub fn apply(&mut self, input: HookEvent<'_>) -> Option<AgentUpdate> {
        map_source_to_ai_type(input.source)?;
        let start = matches!(input.event, "session_start" | "session_created");
        let end = matches!(input.event, "session_end" | "session_deleted");
        let status = map_event_to_status(input.event);
        if !start && !end && status.is_none() && !matches!(input.event, "alive" | "notification") {
            return None;
        }
        let existing = self.panes.get(input.pane_id);
        let same_actor = existing.is_some_and(|lease| {
            lease.root == input.root
                && lease.source == input.source
                && (input.actor == Some(lease.actor)
                    || (end
                        && input.actor.is_none()
                        && input.origin.process_id == lease.actor.pid
                        && input.origin.instance_id.is_some()
                        && input.origin.instance_id == lease.instance_id))
        });
        if !same_actor {
            if !start || input.role != "main" || !input.enabled || input.nested {
                return None;
            }
            let actor = input.actor?;
            self.panes.insert(
                input.pane_id.into(),
                Lease {
                    root: input.root,
                    actor,
                    source: input.source.into(),
                    instance_id: input.origin.instance_id.clone(),
                    conversation_id: input.origin.conversation_id.clone(),
                    sequence: input.origin.sequence,
                    last_seen: input.now,
                    status: Some(AgentStatus::Idle),
                    revision: 0,
                    fresh_after: 0,
                },
            );
            return Some(self.publish(input.pane_id));
        }
        let lease = self.panes.get_mut(input.pane_id).unwrap();
        if lease.instance_id != input.origin.instance_id {
            return None;
        }
        if input.role == "subagent" {
            if lease.status.is_some()
                && (lease.conversation_id.is_none()
                    || lease.conversation_id == input.origin.conversation_id
                    || lease.conversation_id == input.origin.parent_conversation_id)
            {
                lease.last_seen = input.now;
            }
            return None;
        }
        if !start
            && lease.conversation_id.is_some()
            && lease.conversation_id != input.origin.conversation_id
        {
            return None;
        }
        if input.origin.sequence <= lease.sequence {
            return None;
        }
        if !start && !end && input.origin.emitted_at <= lease.fresh_after {
            return None;
        }
        if !input.enabled || end {
            lease.sequence = input.origin.sequence;
            if lease.status.take().is_some() {
                return Some(self.publish(input.pane_id));
            }
            return None;
        }
        if !start && lease.status.is_none() {
            return None;
        }
        lease.last_seen = input.now;
        let Some(status) = status else { return None };
        lease.sequence = input.origin.sequence;
        lease.fresh_after = 0;
        if start {
            lease.conversation_id = input.origin.conversation_id.clone();
        }
        if lease.status == Some(status) {
            return None;
        }
        lease.status = Some(status);
        Some(self.publish(input.pane_id))
    }

    pub fn retire(&mut self, pane_id: &str, root: ProcessKey) -> Option<AgentUpdate> {
        let lease = self.panes.get_mut(pane_id)?;
        if lease.root != root {
            return None;
        }
        let update = if lease.status.take().is_some() {
            Some(self.publish(pane_id))
        } else {
            None
        };
        self.panes.remove(pane_id);
        update
    }

    pub fn clear_disabled(&mut self, enabled: impl Fn(&str) -> bool) -> Vec<AgentUpdate> {
        let panes: Vec<_> = self
            .panes
            .iter()
            .filter(|(_, lease)| lease.status.is_some() && !enabled(&lease.source))
            .map(|(pane, _)| pane.clone())
            .collect();
        panes
            .into_iter()
            .map(|pane| {
                self.panes.get_mut(&pane).unwrap().status = None;
                self.publish(&pane)
            })
            .collect()
    }

    pub fn expire(
        &mut self,
        now: u64,
        wall_now: u64,
        mut alive: impl FnMut(ProcessKey) -> bool,
    ) -> Vec<AgentUpdate> {
        let expired: Vec<_> = self
            .panes
            .iter()
            .filter_map(|(pane, lease)| {
                if lease.status.is_none() {
                    return None;
                }
                if !alive(lease.actor) {
                    return Some((pane.clone(), None));
                }
                (lease.status != Some(AgentStatus::Unknown)
                    && heartbeat_timeout_ms(&lease.source)
                        .is_some_and(|timeout| now.saturating_sub(lease.last_seen) > timeout))
                .then_some((pane.clone(), Some(AgentStatus::Unknown)))
            })
            .collect();
        expired
            .into_iter()
            .map(|(pane, status)| {
                let lease = self.panes.get_mut(&pane).unwrap();
                lease.status = status;
                lease.fresh_after = wall_now;
                self.publish(&pane)
            })
            .collect()
    }

    pub fn snapshot(&self) -> serde_json::Value {
        let agents: Vec<_> = self
            .panes
            .iter()
            .filter_map(|(pane, lease)| {
                lease.status.map(|status| AgentUpdate {
                    pane_id: pane.clone(),
                    revision: lease.revision,
                    agent: Some(AgentState {
                        ai_type: map_source_to_ai_type(&lease.source).unwrap(),
                        status,
                    }),
                })
            })
            .collect();
        serde_json::json!({ "revision": self.revision, "agents": agents })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn origin(sequence: u64) -> HookOrigin {
        HookOrigin {
            process_id: 20,
            sequence,
            emitted_at: sequence * 100,
            instance_id: Some("run-a".into()),
            conversation_id: Some("chat-a".into()),
            parent_conversation_id: None,
        }
    }

    fn event<'a>(kind: &'a str, origin: &'a HookOrigin) -> HookEvent<'a> {
        HookEvent {
            pane_id: "p1",
            root: ProcessKey {
                pid: 10,
                created: 100,
            },
            actor: Some(ProcessKey {
                pid: 20,
                created: 200,
            }),
            source: "opencode",
            event: kind,
            role: "main",
            origin,
            enabled: true,
            now: origin.sequence * 100,
            nested: false,
        }
    }

    #[test]
    fn navigation_requires_the_current_live_omp_conversation_and_instance() {
        let mut registry = AgentRegistry::default();
        let current = origin(1);
        let mut start = event("session_created", &current);
        start.source = "omp";
        let root = start.root;
        registry.apply(start).unwrap();
        assert_eq!(registry.verified_omp_actor("p1", root, &current), Some(ProcessKey { pid: 20, created: 200 }));
        let mut stale = current.clone();
        stale.conversation_id = Some("other-chat".into());
        assert_eq!(registry.verified_omp_actor("p1", root, &stale), None);
        stale = current.clone();
        stale.instance_id = Some("other-instance".into());
        assert_eq!(registry.verified_omp_actor("p1", root, &stale), None);
        stale = current.clone();
        stale.process_id = 21;
        assert_eq!(registry.verified_omp_actor("p1", root, &stale), None);
        assert_eq!(registry.verified_omp_actor("p1", ProcessKey { created: 999, ..root }, &current), None);
        let ended = origin(2);
        let mut end = event("session_deleted", &ended);
        end.source = "omp";
        registry.apply(end).unwrap();
        assert_eq!(registry.verified_omp_actor("p1", root, &ended), None);
    }

    #[test]
    fn a_different_agent_or_missing_conversation_cannot_register_navigation() {
        let mut registry = AgentRegistry::default();
        let current = origin(1);
        let start = event("session_created", &current);
        let root = start.root;
        registry.apply(start).unwrap();
        assert_eq!(registry.verified_omp_actor("p1", root, &current), None);
        registry.retire("p1", root);
        let mut missing = current.clone();
        missing.conversation_id = None;
        let mut start = event("session_created", &missing);
        start.source = "omp";
        registry.apply(start).unwrap();
        assert_eq!(registry.verified_omp_actor("p1", root, &missing), None);
    }

    #[test]
    fn closed_runtime_cannot_be_reopened_by_late_idle_or_heartbeat() {
        let mut registry = AgentRegistry::default();
        let start = registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        assert_eq!(
            serde_json::to_value(start).unwrap(),
            json!({ "paneId": "p1", "revision": 1, "agent": { "aiType": "opencode", "status": "idle" } })
        );
        let end = registry
            .apply(event("session_deleted", &origin(2)))
            .unwrap();
        assert_eq!(
            serde_json::to_value(end).unwrap(),
            json!({ "paneId": "p1", "revision": 2, "agent": null })
        );
        for kind in ["idle", "alive", "permission_prompt", "pre_tool_use"] {
            assert!(registry.apply(event(kind, &origin(3))).is_none());
        }
    }

    #[test]
    fn reordered_and_duplicate_states_cannot_replace_new_work() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        registry.apply(event("stop", &origin(3))).unwrap();
        let working = registry.apply(event("pre_tool_use", &origin(5))).unwrap();
        assert_eq!(
            serde_json::to_value(working).unwrap()["agent"]["status"],
            "working"
        );
        assert!(registry.apply(event("idle", &origin(4))).is_none());
        assert!(registry.apply(event("idle", &origin(5))).is_none());
        assert_eq!(
            registry.snapshot()["agents"][0]["agent"]["status"],
            "working"
        );
    }

    #[test]
    fn heartbeat_does_not_discard_a_delayed_but_current_attention_event() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        assert!(registry.apply(event("alive", &origin(3))).is_none());
        let approval = registry
            .apply(event("permission_prompt", &origin(2)))
            .unwrap();
        assert_eq!(
            serde_json::to_value(approval).unwrap()["agent"]["status"],
            "waiting_approval"
        );
    }

    #[test]
    fn expiry_rejects_old_events_and_new_start_survives_old_root_cleanup() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        assert!(registry.expire(8100, 8100, |_| true).is_empty());
        assert_eq!(registry.expire(8101, 8101, |_| true).len(), 1);
        assert!(registry.apply(event("idle", &origin(4))).is_none());
        let newer = origin(5);
        let mut start = event("session_created", &newer);
        start.root = ProcessKey {
            pid: 11,
            created: 300,
        };
        registry.apply(start).unwrap();
        assert!(registry
            .retire(
                "p1",
                ProcessKey {
                    pid: 10,
                    created: 100
                }
            )
            .is_none());
        assert_eq!(registry.snapshot()["agents"][0]["agent"]["status"], "idle");
    }

    #[test]
    fn old_conversation_and_subagents_cannot_clear_or_replace_a_new_main() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        let mut newer = origin(3);
        newer.conversation_id = Some("chat-b".into());
        registry.apply(event("session_created", &newer));
        assert!(registry
            .apply(event("session_deleted", &origin(4)))
            .is_none());
        let mut child = event("permission_prompt", &newer);
        child.role = "subagent";
        assert!(registry.apply(child).is_none());
        assert_eq!(registry.snapshot()["agents"][0]["agent"]["status"], "idle");
    }

    #[test]
    fn dead_processes_clear_without_waiting_for_the_heartbeat_deadline() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        assert_eq!(registry.expire(200, 200, |_| false).len(), 1);
        assert_eq!(registry.snapshot(), json!({ "revision": 2, "agents": [] }));
    }

    #[test]
    fn a_child_runtime_cannot_take_over_the_owning_agent() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        let next = origin(2);
        let mut child = event("session_created", &next);
        child.actor = Some(ProcessKey {
            pid: 30,
            created: 300,
        });
        child.nested = true;
        assert!(registry.apply(child).is_none());
        assert_eq!(
            registry.current_actor("p1"),
            Some(ProcessKey {
                pid: 20,
                created: 200
            })
        );
    }

    #[test]
    fn missed_heartbeats_keep_identity_and_only_fresh_state_recovers_status() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        let updates = registry.expire(8101, 9000, |_| true);
        assert_eq!(
            serde_json::to_value(&updates[0]).unwrap(),
            json!({ "paneId": "p1", "revision": 2, "agent": { "aiType": "opencode", "status": "unknown" } })
        );
        assert!(registry.expire(20000, 20000, |_| true).is_empty());
        assert!(registry
            .apply(event("permission_prompt", &origin(80)))
            .is_none());
        assert!(registry.apply(event("alive", &origin(92))).is_none());
        assert_eq!(
            registry.snapshot()["agents"][0]["agent"]["status"],
            "unknown"
        );
        let recovered = registry
            .apply(event("permission_prompt", &origin(91)))
            .unwrap();
        assert_eq!(
            serde_json::to_value(recovered).unwrap()["agent"]["status"],
            "waiting_approval"
        );
    }

    #[test]
    fn event_only_tools_remain_active_while_the_process_lives() {
        for source in ["claude-code", "codex", "qwen-code", "copilot-cli"] {
            let mut registry = AgentRegistry::default();
            let start = origin(1);
            let mut input = event("session_start", &start);
            input.source = source;
            registry.apply(input).unwrap();
            assert!(registry.expire(86400000, 86400000, |_| true).is_empty());
            assert_eq!(registry.snapshot()["agents"][0]["agent"]["status"], "idle");
            assert_eq!(registry.expire(86400001, 86400001, |_| false).len(), 1);
            assert_eq!(registry.snapshot()["agents"], json!([]));
        }
    }

    #[test]
    fn a_detached_end_from_an_old_instance_cannot_clear_its_replacement() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        let mut next = origin(1);
        next.instance_id = Some("run-b".into());
        let mut start = event("session_created", &next);
        start.actor = Some(ProcessKey {
            pid: 21,
            created: 300,
        });
        registry.apply(start).unwrap();
        let old = origin(99);
        let mut old_end = event("session_deleted", &old);
        old_end.actor = None;
        assert!(registry.apply(old_end).is_none());
        let mut next_end = next;
        next_end.process_id = 21;
        next_end.sequence = 2;
        let mut end = event("session_deleted", &next_end);
        end.actor = None;
        assert!(registry.apply(end).unwrap().agent.is_none());
        assert_eq!(registry.snapshot(), json!({ "revision": 3, "agents": [] }));
    }

    #[test]
    fn child_sessions_refresh_only_their_own_main_conversation() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        let mut child_origin = origin(20);
        child_origin.conversation_id = Some("child".into());
        child_origin.parent_conversation_id = Some("chat-a".into());
        let mut child = event("session_deleted", &child_origin);
        child.role = "subagent";
        assert!(registry.apply(child).is_none());
        assert!(registry.expire(9500, 9500, |_| true).is_empty());
        child_origin.parent_conversation_id = Some("unrelated".into());
        let mut unrelated = event("alive", &child_origin);
        unrelated.role = "subagent";
        unrelated.now = 9000;
        registry.apply(unrelated);
        assert_eq!(registry.expire(10001, 10001, |_| true).len(), 1);
    }

    #[test]
    fn disabling_a_tool_publishes_a_clear_once_and_requires_an_explicit_restart() {
        let mut registry = AgentRegistry::default();
        registry
            .apply(event("session_created", &origin(1)))
            .unwrap();
        let next = origin(1);
        let mut another = event("session_start", &next);
        another.pane_id = "p2";
        another.source = "codex";
        registry.apply(another).unwrap();
        let updates = registry.clear_disabled(|source| source != "opencode");
        assert_eq!(
            serde_json::to_value(&updates[0]).unwrap(),
            json!({ "paneId": "p1", "revision": 3, "agent": null })
        );
        assert!(registry
            .clear_disabled(|source| source != "opencode")
            .is_empty());
        assert!(registry.apply(event("alive", &origin(2))).is_none());
        assert!(registry.apply(event("idle", &origin(3))).is_none());
        assert_eq!(registry.snapshot()["agents"].as_array().unwrap().len(), 1);
        assert!(registry
            .apply(event("session_created", &origin(4)))
            .is_some());
    }
}
