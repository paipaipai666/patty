use std::fs;
use std::sync::{LazyLock, Mutex};

/// Tests share the process-level `metrics::DATA` static, so serialize within
/// this binary.  Use poison recovery: a panicked test poisons the mutex, but
/// `.into_inner()` lets the next test proceed with a clean DATA.
static SERIAL: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn serial_lock() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn fresh_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("patty-metrics-it-{}-{}", std::process::id(), name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    patty::store::set_data_dir_for_test(dir.clone());
    dir
}

fn isolate(name: &str) -> (std::path::PathBuf, std::sync::MutexGuard<'static, ()>) {
    let g = serial_lock();
    patty::metrics::reset_for_test();
    let dir = fresh_dir(name);
    (dir, g)
}

#[test]
fn snapshot_is_empty_initially() {
    let (_dir, _g) = isolate("empty_init");
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 0);
    assert_eq!(s["samples"].as_array().unwrap().len(), 0);
}

#[test]
fn record_first_terminal_appears_in_snapshot() {
    let (_dir, _g) = isolate("record_once");
    patty::metrics::record_first_terminal(serde_json::json!({
        "iso": "2026-07-21T12:00:00Z", "shell": "pwsh", "durationMs": 150
    }));
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 1);
    assert_eq!(s["firstTerminal"][0]["shell"], "pwsh");
    assert_eq!(s["firstTerminal"][0]["durationMs"], 150);
}

#[test]
fn multiple_record_first_terminals_ordered() {
    let (_dir, _g) = isolate("record_multi");
    for i in 0..5 {
        patty::metrics::record_first_terminal(serde_json::json!({
            "iso": format!("2026-07-21T12:00:{i:02}Z"),
            "shell": "pwsh", "durationMs": 100 + i
        }));
    }
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 5);
    assert_eq!(s["firstTerminal"][0]["durationMs"], 100);
    assert_eq!(s["firstTerminal"][4]["durationMs"], 104);
}

#[test]
fn record_first_terminal_persists_to_disk() {
    let (dir, _g) = isolate("persist_file");
    patty::metrics::record_first_terminal(serde_json::json!({
        "shell": "cmd", "durationMs": 200, "iso": "t1"
    }));
    let path = dir.join("metrics-history.json");
    assert!(path.exists(), "metrics-history.json should exist after record");
    let raw = fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["version"], 1);
    assert_eq!(parsed["firstTerminal"][0]["shell"], "cmd");
}

#[test]
fn load_history_restores_from_disk() {
    let (_dir, _g) = isolate("load_restore");
    fs::write(
        patty::store::data_dir().join("metrics-history.json"),
        serde_json::json!({
            "version": 1,
            "firstTerminal": [{"shell": "pwsh", "durationMs": 100, "iso": "a"}],
            "samples": [{"timestamp": 1000, "appCpu": 5.0, "appMemMB": 100.0}]
        }).to_string(),
    ).unwrap();

    patty::metrics::load_history();
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 1);
    assert_eq!(s["firstTerminal"][0]["shell"], "pwsh");
    assert_eq!(s["samples"].as_array().unwrap().len(), 1);
    assert_eq!(s["samples"][0]["appCpu"], 5.0);
}

#[test]
fn load_history_ignores_wrong_version() {
    let (_dir, _g) = isolate("load_wrong_ver");
    fs::write(
        patty::store::data_dir().join("metrics-history.json"),
        serde_json::json!({"version": 2, "firstTerminal": [{"shell":"pwsh","durationMs":1,"iso":""}]}).to_string(),
    ).unwrap();

    patty::metrics::load_history();
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 0);
}

#[test]
fn load_history_ignores_corrupt_file() {
    let (_dir, _g) = isolate("load_corrupt");
    fs::write(patty::store::data_dir().join("metrics-history.json"), "{not json").unwrap();
    patty::metrics::load_history();
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 0);
}

#[test]
fn load_history_no_file_is_noop() {
    let (_dir, _g) = isolate("load_no_file");
    patty::metrics::load_history();
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 0);
}

#[test]
fn record_first_terminal_caps_at_max() {
    let (_dir, _g) = isolate("capping");
    for i in 0..35 {
        patty::metrics::record_first_terminal(serde_json::json!({
            "shell": "pwsh", "durationMs": i, "iso": format!("{i}")
        }));
    }
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 30);
    assert_eq!(s["firstTerminal"][0]["durationMs"], 5);
}

#[test]
fn load_history_caps_on_read() {
    let (_dir, _g) = isolate("load_cap");
    let entries: Vec<serde_json::Value> = (0..40)
        .map(|i| serde_json::json!({"shell":"pwsh","durationMs":i,"iso":format!("{i}")}))
        .collect();
    fs::write(
        patty::store::data_dir().join("metrics-history.json"),
        serde_json::json!({"version": 1, "firstTerminal": entries, "samples": []}).to_string(),
    ).unwrap();

    patty::metrics::load_history();
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 30);
    assert_eq!(s["firstTerminal"][0]["durationMs"], 10);
}

#[test]
fn records_via_persist_survive_reload() {
    let (_dir, _g) = isolate("survive");
    patty::metrics::record_first_terminal(serde_json::json!({"shell":"bash","durationMs":50,"iso":"a"}));
    patty::metrics::record_first_terminal(serde_json::json!({"shell":"zsh","durationMs":80,"iso":"b"}));

    // Persist is called by record_first_terminal.  Verify by clearing DATA
    // then reloading from that file.
    patty::metrics::reset_for_test();
    patty::metrics::load_history();
    let s = patty::metrics::snapshot();
    assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 2);
    assert_eq!(s["firstTerminal"][0]["shell"], "bash");
    assert_eq!(s["firstTerminal"][1]["shell"], "zsh");
}
