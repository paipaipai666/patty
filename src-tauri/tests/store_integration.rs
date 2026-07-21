use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

/// All store tests share a global lock because they mutate the module-level
/// TEST_DATA_DIR and SETTINGS_CACHE. Rust runs tests in parallel within a
/// binary, so each test must serialize to avoid races on globals.
static SERIAL: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn tmp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("patty-store-test-{}-{}", std::process::id(), tag));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh_dir(name: &str) -> (PathBuf, std::sync::MutexGuard<'static, ()>) {
    let guard = SERIAL.lock().unwrap();
    let dir = tmp_dir(name);
    patty::store::set_data_dir_for_test(dir.clone());
    (dir, guard)
}

#[test]
fn save_and_load_state_roundtrip() {
    let (_dir, _g) = fresh_dir("save_load");

    let state = serde_json::json!({
        "sessions": [{"id": "s1", "title": "T1", "color": "blue", "cwd": "", "shell": "powershell", "collectionId": null, "createdAt": 100}],
        "collections": [],
        "activeSessionId": "s1",
        "sidebarVisible": true,
        "sidebarWidth": 220,
        "workspaces": [],
        "activeWorkspaceId": null,
    });
    patty::store::save_state(&state).unwrap();
    let loaded = patty::store::load_state();
    assert_eq!(loaded["sessions"][0]["id"], "s1");
    assert_eq!(loaded["activeSessionId"], "s1");
    assert_eq!(loaded["sidebarWidth"], 220);
}

#[test]
fn load_state_returns_defaults_when_no_file() {
    let (_dir, _g) = fresh_dir("defaults");

    let state = patty::store::load_state();
    assert_eq!(state["sessions"], serde_json::json!([]));
    assert!(state["activeSessionId"].is_null());
    assert_eq!(state["sidebarWidth"], 220);
}

#[test]
fn save_state_overwrites_previous() {
    let (_dir, _g) = fresh_dir("overwrite");

    let first = serde_json::json!({
        "sessions": [{"id": "s1", "title": "Old", "color": "blue", "cwd": "", "shell": "powershell", "collectionId": null, "createdAt": 100}],
        "collections": [],
        "activeSessionId": "s1",
        "sidebarVisible": true,
        "sidebarWidth": 220,
        "workspaces": [],
        "activeWorkspaceId": null,
    });
    patty::store::save_state(&first).unwrap();

    let second = serde_json::json!({
        "sessions": [{"id": "s2", "title": "New", "color": "green", "cwd": "/home", "shell": "bash", "collectionId": null, "createdAt": 200}],
        "collections": [],
        "activeSessionId": "s2",
        "sidebarVisible": false,
        "sidebarWidth": 180,
        "workspaces": [],
        "activeWorkspaceId": null,
    });
    patty::store::save_state(&second).unwrap();

    let loaded = patty::store::load_state();
    assert_eq!(loaded["sessions"][0]["id"], "s2");
    assert_eq!(loaded["sidebarVisible"], false);
    assert_eq!(loaded["sidebarWidth"], 180);
}

#[test]
fn validate_state_rejects_invalid() {
    let (_dir, _g) = fresh_dir("validate");

    assert!(patty::store::validate_state(&serde_json::json!(null)).is_err());
    assert!(patty::store::validate_state(&serde_json::json!({})).is_err());
    assert!(patty::store::validate_state(&serde_json::json!({
        "sessions": [], "collections": [], "sidebarWidth": 220, "sidebarVisible": true
    })).is_ok());
}

#[test]
fn state_save_rejects_invalid() {
    let (_dir, _g) = fresh_dir("reject");

    let invalid = serde_json::json!({"sessions": "not-an-array"});
    assert!(patty::store::validate_state(&invalid).is_err());
}

#[test]
fn settings_roundtrip() {
    let (_dir, _g) = fresh_dir("settings");

    let settings = serde_json::json!({"theme": "nord", "fontSize": 18, "fontFamily": "Fira Code"});
    patty::store::save_settings(&settings).unwrap();
    let loaded = patty::store::load_settings();
    assert_eq!(loaded["theme"], "nord");
    assert_eq!(loaded["fontSize"], 18);
}

#[test]
fn load_settings_returns_defaults_when_no_file() {
    let (_dir, _g) = fresh_dir("settings_defaults");

    let settings = patty::store::load_settings();
    assert_eq!(settings["theme"], "dark");
    assert_eq!(settings["fontFamily"], "Cascadia Code");
    assert_eq!(settings["fontSize"], 14);
}

#[test]
fn settings_cache_invalidates_after_save() {
    let (_dir, _g) = fresh_dir("cache");

    let loaded = patty::store::load_settings();
    assert_eq!(loaded["theme"], "dark");

    let updated = serde_json::json!({"theme": "light", "fontSize": 16});
    patty::store::save_settings(&updated).unwrap();

    let reloaded = patty::store::load_settings();
    assert_eq!(reloaded["theme"], "light");
    assert_eq!(reloaded["fontSize"], 16);
}

#[test]
fn settings_merge_preserves_unknown_keys() {
    let (_dir, _g) = fresh_dir("merge");

    let settings = serde_json::json!({
        "shortcuts": {"newTerminal": "Ctrl+Alt+T"},
        "theme": "dracula",
    });
    patty::store::save_settings(&settings).unwrap();
    let loaded = patty::store::load_settings();
    assert_eq!(loaded["shortcuts"]["newTerminal"], "Ctrl+Alt+T");
    assert_eq!(loaded["theme"], "dracula");
}

#[test]
fn corrupt_state_file_yields_defaults() {
    let (dir, _g) = fresh_dir("corrupt_state");

    patty::store::data_dir();
    fs::write(dir.join("state.json"), "{not json").unwrap();
    let state = patty::store::load_state();
    assert_eq!(state["sessions"], serde_json::json!([]));
    assert_eq!(state["sidebarWidth"], 220);
}

#[test]
fn corrupt_settings_file_yields_defaults() {
    let (dir, _g) = fresh_dir("corrupt_settings");

    patty::store::data_dir();
    fs::write(dir.join("settings.json"), "{garbage").unwrap();
    let settings = patty::store::load_settings();
    assert_eq!(settings["theme"], "dark");
}

#[test]
fn state_supports_workspaces_field() {
    let (_dir, _g) = fresh_dir("workspaces");

    let state = serde_json::json!({
        "sessions": [{"id": "s1", "title": "T", "color": "blue", "cwd": "", "shell": "powershell", "collectionId": null, "createdAt": 100}],
        "collections": [],
        "activeSessionId": "s1",
        "sidebarVisible": true,
        "sidebarWidth": 220,
        "workspaces": [{
            "id": "w1", "name": "Default", "collectionId": null,
            "paneTree": {"id": "p1", "type": "leaf", "sessionId": "s1"},
            "focusedPaneId": "p1"
        }],
        "activeWorkspaceId": "w1",
    });
    patty::store::save_state(&state).unwrap();
    let loaded = patty::store::load_state();
    assert_eq!(loaded["workspaces"][0]["id"], "w1");
    assert_eq!(loaded["workspaces"][0]["paneTree"]["sessionId"], "s1");
    assert_eq!(loaded["activeWorkspaceId"], "w1");
}

#[test]
fn default_settings_has_all_required_keys() {
    let defaults = patty::store::default_settings();
    assert!(defaults.get("theme").is_some());
    assert!(defaults.get("fontFamily").is_some());
    assert!(defaults.get("fontSize").is_some());
    assert!(defaults.get("shortcuts").is_some());
    assert!(defaults.get("shortcuts").unwrap().get("newTerminal").is_some());
    assert!(defaults.get("notifications").is_some());
    assert!(defaults.get("customThemes").is_some());
}
