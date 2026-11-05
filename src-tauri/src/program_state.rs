use crate::program_status::{Selected, Tracker};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex, Weak};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub pane_id: String,
    pub revision: u64,
    pub run_id: String,
    pub program: Option<Selected>,
    pub record_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Batch {
    pub revision: u64,
    pub programs: Vec<Update>,
}

#[derive(Default)]
pub struct Registry {
    data: Mutex<Data>,
    wake: Mutex<Option<mpsc::SyncSender<()>>>,
}

#[derive(Default)]
struct Data {
    revision: u64,
    current: HashMap<String, Slot>,
    pending: HashMap<String, Update>,
}

struct Slot {
    run: Arc<Run>,
    update: Update,
}

pub struct Run {
    pane: String,
    id: u64,
    tracker: Mutex<Tracker>,
    registry: Weak<Registry>,
    reply_pending: Arc<AtomicBool>,
}

pub struct Reply(Arc<AtomicBool>);

impl Reply {
    pub fn bytes(&self) -> &'static [u8] {
        crate::program_status::CAPABILITY_REPLY
    }
}

impl Drop for Reply {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl Registry {
    pub fn start(self: &Arc<Self>, pane: &str) -> Arc<Run> {
        let mut data = self.data.lock().unwrap();
        data.revision += 1;
        let run = Arc::new(Run {
            pane: pane.into(),
            id: data.revision,
            tracker: Mutex::new(Tracker::default()),
            registry: Arc::downgrade(self),
            reply_pending: Arc::new(AtomicBool::new(false)),
        });
        let update = Update {
            pane_id: pane.into(),
            revision: data.revision,
            run_id: run.id.to_string(),
            program: None,
            record_count: 0,
        };
        data.current.insert(
            pane.into(),
            Slot {
                run: run.clone(),
                update: update.clone(),
            },
        );
        data.pending.insert(pane.into(), update);
        drop(data);
        self.signal();
        run
    }

    fn signal(&self) {
        if let Some(wake) = self.wake.lock().unwrap().as_ref() {
            let _ = wake.try_send(());
        }
    }

    fn current(&self, pane: &str, id: u64) -> bool {
        self.data
            .lock()
            .unwrap()
            .current
            .get(pane)
            .is_some_and(|slot| slot.run.id == id)
    }

    fn publish(&self, run: &Run, tracker: &Tracker) {
        let mut data = self.data.lock().unwrap();
        let Some(slot) = data
            .current
            .get(&run.pane)
            .filter(|slot| slot.run.id == run.id)
        else {
            return;
        };
        let program = tracker.selected();
        let record_count = tracker.record_count();
        if slot.update.program == program && slot.update.record_count == record_count {
            return;
        }
        data.revision += 1;
        let update = Update {
            pane_id: run.pane.clone(),
            revision: data.revision,
            run_id: run.id.to_string(),
            program,
            record_count,
        };
        data.current.get_mut(&run.pane).unwrap().update = update.clone();
        data.pending.insert(run.pane.clone(), update);
        drop(data);
        self.signal();
    }

    fn forget(&self, pane: &str, expected: Option<u64>) {
        let mut data = self.data.lock().unwrap();
        if !data
            .current
            .get(pane)
            .is_some_and(|slot| expected.is_none_or(|id| id == slot.run.id))
        {
            return;
        }
        let slot = data.current.remove(pane).unwrap();
        data.revision += 1;
        let update = Update {
            pane_id: pane.into(),
            revision: data.revision,
            run_id: slot.run.id.to_string(),
            program: None,
            record_count: 0,
        };
        data.pending.insert(pane.into(), update);
        drop(data);
        self.signal();
    }

    pub fn snapshot(&self) -> Batch {
        let data = self.data.lock().unwrap();
        let mut programs: Vec<_> = data
            .current
            .values()
            .map(|slot| slot.update.clone())
            .collect();
        programs.sort_by(|a, b| a.pane_id.cmp(&b.pane_id));
        Batch {
            revision: data.revision,
            programs,
        }
    }

    pub fn drain(&self) -> Batch {
        let mut data = self.data.lock().unwrap();
        let mut programs: Vec<_> = std::mem::take(&mut data.pending).into_values().collect();
        programs.sort_by(|a, b| a.pane_id.cmp(&b.pane_id));
        Batch {
            revision: data.revision,
            programs,
        }
    }
}

impl Run {
    pub fn feed(&self, bytes: &[u8]) -> Option<Reply> {
        let mut tracker = self.tracker.lock().unwrap();
        let effects = tracker.feed(bytes);
        let registry = self.registry.upgrade()?;
        if effects.changed {
            registry.publish(self, &tracker);
        }
        if !effects.query || !registry.current(&self.pane, self.id) {
            return None;
        }
        self.reply_pending
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()?;
        Some(Reply(self.reply_pending.clone()))
    }

    pub fn eof(&self) {
        let mut tracker = self.tracker.lock().unwrap();
        if tracker.eof() {
            if let Some(registry) = self.registry.upgrade() {
                registry.publish(self, &tracker);
            }
        }
    }

    pub fn retire(&self) {
        if let Some(registry) = self.registry.upgrade() {
            registry.forget(&self.pane, Some(self.id));
        }
    }
}

static REGISTRY: LazyLock<Arc<Registry>> = LazyLock::new(|| Arc::new(Registry::default()));

pub fn start(id: &str) -> Arc<Run> {
    REGISTRY.start(id)
}
pub fn forget(id: &str) {
    REGISTRY.forget(id, None);
}
pub fn update(id: &str) -> Option<Update> {
    REGISTRY
        .data
        .lock()
        .unwrap()
        .current
        .get(id)
        .map(|slot| slot.update.clone())
}

#[tauri::command]
pub fn program_state_snapshot() -> Batch {
    REGISTRY.snapshot()
}

pub fn initialize(app: AppHandle) -> Result<(), String> {
    let mut wake = REGISTRY.wake.lock().unwrap();
    if wake.is_some() {
        return Ok(());
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("program-status".into())
        .spawn(move || {
            while receiver.recv().is_ok() {
                std::thread::sleep(std::time::Duration::from_millis(50));
                let batch = REGISTRY.drain();
                if !batch.programs.is_empty() {
                    let _ = app.emit("pty:program", batch);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let _ = sender.try_send(());
    *wake = Some(sender);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshots_expose_the_program_report_with_its_own_run_identity() {
        let registry = Arc::new(Registry::default());
        let run = registry.start("pane-1");
        let _ = run.feed(b"\x1b]7501;state=blocked:kind=question:app=deploy\x07");
        assert_eq!(
            serde_json::to_value(registry.snapshot()).unwrap(),
            json!({
                "revision":2,"programs":[{"paneId":"pane-1","revision":2,"runId":"1","program":{"revision":1,"id":"","state":"blocked","kind":"question","app":"deploy"},"recordCount":1}]
            })
        );
    }

    #[test]
    fn retired_readers_cannot_overwrite_or_remove_a_replacement_run() {
        let registry = Arc::new(Registry::default());
        let old = registry.start("pane-1");
        let _ = old.feed(b"\x1b]7501;state=blocked\x07");
        let gate = Arc::new(std::sync::Barrier::new(2));
        let old_gate = gate.clone();
        let worker = std::thread::spawn(move || {
            old_gate.wait();
            let _ = old.feed(b"\x1b]7501;state=error\x07");
            old.eof();
            old.retire();
            assert!(old.feed(b"\x1b]7501;?\x07").is_none());
        });
        let current = registry.start("pane-1");
        let _ = current.feed(b"\x1b]7501;state=working:app=cargo\x07");
        gate.wait();
        worker.join().unwrap();
        let batch = registry.snapshot();
        assert_eq!(batch.revision, 4);
        assert_eq!(batch.programs[0].run_id, "3");
        assert_eq!(
            batch.programs[0].program.as_ref().unwrap().record.state,
            crate::program_status::State::Working { progress: None }
        );
        assert!(current.feed(b"\x1b]7501;?\x07").is_some());
        current.retire();
        assert!(registry.snapshot().programs.is_empty());
        assert_eq!(
            serde_json::to_value(registry.drain()).unwrap(),
            json!({"revision":5,"programs":[{"paneId":"pane-1","revision":5,"runId":"3","program":null,"recordCount":0}]})
        );
    }

    #[test]
    fn bursts_coalesce_to_one_latest_update_and_identical_reports_do_not_republish() {
        let registry = Arc::new(Registry::default());
        let run = registry.start("pane-1");
        for progress in 0..1000 {
            let _ = run.feed(
                format!("\x1b]7501;state=working:progress={}\x07", progress % 101).as_bytes(),
            );
        }
        let batch = registry.drain();
        assert_eq!(batch.programs.len(), 1);
        assert_eq!(
            batch.programs[0].program.as_ref().unwrap().record.state,
            crate::program_status::State::Working { progress: Some(90) }
        );
        assert!(registry.drain().programs.is_empty());
        let _ = run.feed(b"\x1b]7501;state=working:progress=90\x07");
        let _ = run.feed(b"ordinary terminal output");
        assert!(registry.drain().programs.is_empty());
        assert_eq!(registry.snapshot().revision, batch.revision);
    }

    #[test]
    fn completed_results_survive_eof_and_explicit_session_removal_clears_them() {
        let registry = Arc::new(Registry::default());
        let run = registry.start("pane-1");
        let _ = run.feed(b"\x1b]7501;state=done\x07\x1b]7501;state=working:id=child\x07");
        run.eof();
        let batch = registry.snapshot();
        assert_eq!(batch.programs[0].record_count, 1);
        assert_eq!(
            batch.programs[0].program.as_ref().unwrap().record.state,
            crate::program_status::State::Done
        );
        registry.forget("pane-1", None);
        assert!(registry.snapshot().programs.is_empty());
        let new = registry.start("pane-1");
        assert_eq!(registry.snapshot().programs[0].program, None);
        assert!(new.feed(b"\x1b]7501;?\x07").is_some());
    }

    #[test]
    fn unread_capability_responses_do_not_allow_an_unbounded_input_queue() {
        let registry = Arc::new(Registry::default());
        let run = registry.start("pane-1");
        let pending = run.feed(b"\x1b]7501;?\x07").unwrap();
        assert_eq!(pending.bytes(),b"\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\");
        for _ in 0..1000 {
            assert!(run.feed(b"\x1b]7501;?\x07").is_none());
        }
        drop(pending);
        assert!(run.feed(b"\x1b]7501;?\x07").is_some());
    }
}
