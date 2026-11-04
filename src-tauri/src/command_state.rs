use serde::Serialize;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, LazyLock, Mutex,
};
use std::time::Instant;

#[derive(Clone, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CommandState {
    Unavailable,
    Ready,
    Running {
        elapsed_ms: u64,
    },
    Finished {
        duration_ms: u64,
        exit_code: Option<i32>,
    },
    Interrupted {
        duration_ms: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    run_id: String,
    revision: u64,
    #[serde(flatten)]
    state: CommandState,
}

enum Phase {
    Unavailable,
    Ready,
    Running(u64),
    Finished(u64, Option<i32>),
    Interrupted(u64),
}

enum Scan {
    Ground,
    Escape,
    Osc {
        bytes: Vec<u8>,
        escape: bool,
        overflow: bool,
    },
    String {
        escape: bool,
    },
}

pub struct Tracker {
    run_id: u64,
    revision: u64,
    phase: Phase,
    scan: Scan,
}

impl Tracker {
    fn new(run_id: u64) -> Self {
        Self {
            run_id,
            revision: 0,
            phase: Phase::Unavailable,
            scan: Scan::Ground,
        }
    }

    pub fn feed(&mut self, text: &str, now: u64) {
        for byte in text.bytes() {
            self.scan = match std::mem::replace(&mut self.scan, Scan::Ground) {
                Scan::Ground => {
                    if byte == 0x1b {
                        Scan::Escape
                    } else {
                        Scan::Ground
                    }
                }
                Scan::Escape => match byte {
                    b']' => Scan::Osc {
                        bytes: Vec::new(),
                        escape: false,
                        overflow: false,
                    },
                    b'P' | b'X' | b'^' | b'_' => Scan::String { escape: false },
                    0x1b => Scan::Escape,
                    _ => Scan::Ground,
                },
                Scan::String { escape } => {
                    if (escape && byte == b'\\') || matches!(byte, 0x18 | 0x1a) {
                        Scan::Ground
                    } else {
                        Scan::String {
                            escape: byte == 0x1b,
                        }
                    }
                }
                Scan::Osc {
                    mut bytes,
                    escape,
                    mut overflow,
                } => {
                    if byte == 7 || (escape && byte == b'\\') {
                        if !overflow {
                            self.marker(&bytes, now);
                        }
                        Scan::Ground
                    } else if matches!(byte, 0x18 | 0x1a) {
                        Scan::Ground
                    } else if byte == 0x1b {
                        Scan::Osc {
                            bytes,
                            escape: true,
                            overflow,
                        }
                    } else {
                        if escape || bytes.len() >= 96 {
                            overflow = true;
                        }
                        if !overflow {
                            bytes.push(byte);
                        }
                        Scan::Osc {
                            bytes,
                            escape: false,
                            overflow,
                        }
                    }
                }
            };
        }
    }

    fn marker(&mut self, bytes: &[u8], now: u64) {
        let Ok(text) = std::str::from_utf8(bytes) else {
            return;
        };
        let Some(marker) = text.strip_prefix("133;") else {
            return;
        };
        let next = match marker {
            "A" | "B" => match self.phase {
                Phase::Unavailable => Some(Phase::Ready),
                Phase::Running(started) => Some(Phase::Interrupted(now.saturating_sub(started))),
                _ => None,
            },
            "C" if !matches!(self.phase, Phase::Running(_)) => Some(Phase::Running(now)),
            "D" => match self.phase {
                Phase::Running(started) => Some(Phase::Finished(now.saturating_sub(started), None)),
                _ => None,
            },
            _ => {
                if let (Some(value), Phase::Running(started)) =
                    (marker.strip_prefix("D;"), &self.phase)
                {
                    value
                        .parse::<i32>()
                        .ok()
                        .map(|code| Phase::Finished(now.saturating_sub(*started), Some(code)))
                } else {
                    None
                }
            }
        };
        if let Some(phase) = next {
            self.phase = phase;
            self.revision += 1;
        }
    }

    pub fn eof(&mut self, now: u64) {
        if let Phase::Running(started) = self.phase {
            self.phase = Phase::Interrupted(now.saturating_sub(started));
            self.revision += 1;
        }
    }

    fn snapshot(&self, now: u64) -> Snapshot {
        Snapshot {
            run_id: self.run_id.to_string(),
            revision: self.revision,
            state: match self.phase {
                Phase::Unavailable => CommandState::Unavailable,
                Phase::Ready => CommandState::Ready,
                Phase::Running(started) => CommandState::Running {
                    elapsed_ms: now.saturating_sub(started),
                },
                Phase::Finished(duration_ms, exit_code) => CommandState::Finished {
                    duration_ms,
                    exit_code,
                },
                Phase::Interrupted(duration_ms) => CommandState::Interrupted { duration_ms },
            },
        }
    }

    #[cfg(test)]
    fn pending_bytes(&self) -> usize {
        match &self.scan {
            Scan::Osc { bytes, .. } => bytes.len(),
            _ => 0,
        }
    }
}

type SharedTracker = Arc<Mutex<Tracker>>;
static TRACKERS: LazyLock<Mutex<HashMap<String, SharedTracker>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_RUN: AtomicU64 = AtomicU64::new(1);

pub fn now_ms() -> u64 {
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    START.elapsed().as_millis() as u64
}

pub fn start(id: &str) -> SharedTracker {
    let tracker = Arc::new(Mutex::new(Tracker::new(
        NEXT_RUN.fetch_add(1, Ordering::Relaxed),
    )));
    TRACKERS.lock().unwrap().insert(id.into(), tracker.clone());
    tracker
}

pub fn forget(id: &str) {
    TRACKERS.lock().unwrap().remove(id);
}

#[tauri::command]
pub fn command_state_snapshot(id: &str) -> Option<Snapshot> {
    snapshot(id)
}

pub fn snapshot(id: &str) -> Option<Snapshot> {
    let tracker = TRACKERS.lock().unwrap().get(id).cloned()?;
    let snapshot = tracker.lock().unwrap().snapshot(now_ms());
    Some(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn split_markers_report_start_result_and_duration_without_prompt_overwriting_it() {
        let mut tracker = Tracker::new(1);
        tracker.feed("\x1b]133;A\x07", 10);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(10)).unwrap()["status"],
            "ready"
        );
        tracker.feed("text\x1b]13", 20);
        tracker.feed("3;C\x1b", 21);
        tracker.feed("\\output", 25);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(50)).unwrap(),
            json!({ "runId": "1", "revision": 2, "status": "running", "elapsedMs": 25 })
        );
        tracker.feed("\x1b]133;D;7\x07\x1b]133;A\x07", 125);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(999)).unwrap(),
            json!({ "runId": "1", "revision": 3, "status": "finished", "exitCode": 7, "durationMs": 100 })
        );
    }

    #[test]
    fn missing_results_and_aborted_commands_never_claim_success() {
        let mut tracker = Tracker::new(2);
        tracker.feed("\x1b]133;D;0\x07", 0);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(1)).unwrap()["status"],
            "unavailable"
        );
        tracker.feed("\x1b]133;C\x07", 10);
        tracker.feed("\x1b]133;C\x07", 15);
        tracker.feed("\x1b]133;D\x07", 60);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(60)).unwrap(),
            json!({ "runId": "2", "revision": 2, "status": "finished", "exitCode": null, "durationMs": 50 })
        );
        tracker.feed("\x1b]133;C\x07", 70);
        tracker.eof(90);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(100)).unwrap(),
            json!({ "runId": "2", "revision": 4, "status": "interrupted", "durationMs": 20 })
        );
    }

    #[test]
    fn malformed_oversized_and_embedded_control_strings_do_not_change_state() {
        let mut tracker = Tracker::new(3);
        for text in [
            "133;C",
            "\x1b]1337;File=\x1b]133;C\x07",
            "\x1bPpayload\x1b]133;C\x1b\\",
            "\x1b]133;C;unexpected\x07",
            "\x1b]133;D;nope\x07",
        ] {
            tracker.feed(text, 1);
        }
        tracker.feed(&format!("\x1b]{}\x07", "x".repeat(10_000)), 2);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(3)).unwrap()["status"],
            "unavailable"
        );
        assert!(tracker.pending_bytes() <= 96);
        tracker.feed("\x1b]133;C\x07", 4);
        tracker.feed("\x1b]133;D;0\x07", 8);
        assert_eq!(
            serde_json::to_value(tracker.snapshot(8)).unwrap()["exitCode"],
            0
        );
    }

    #[test]
    fn a_replaced_process_cannot_overwrite_its_successor_and_close_releases_state() {
        let old = start("command-replacement-test");
        old.lock().unwrap().feed("\x1b]133;C\x07", 0);
        let new = start("command-replacement-test");
        new.lock().unwrap().feed("\x1b]133;A\x07", 0);
        old.lock().unwrap().eof(5);
        assert_eq!(
            snapshot("command-replacement-test").unwrap().run_id,
            new.lock().unwrap().run_id.to_string()
        );
        assert_eq!(
            serde_json::to_value(snapshot("command-replacement-test")).unwrap()["status"],
            "ready"
        );
        forget("command-replacement-test");
        assert!(snapshot("command-replacement-test").is_none());
    }
}
