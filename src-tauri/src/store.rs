use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

// Same directory the Electron build used for userData (%APPDATA%\Patty), so
// existing installs keep their settings.json / state.json after the switch.
pub fn data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Patty")
}

pub fn default_settings() -> Value {
    json!({
        "theme": "dark",
        "fontFamily": "Cascadia Code",
        "fontSize": 14,
        "cursorStyle": "bar",
        "cursorBlink": true,
        "opacity": 1.0,
        "scrollback": 5000,
        "defaultShell": "powershell",
        "sidebarPosition": "left",
        "shortcuts": {
            "newTerminal": "Ctrl+T",
            "closeTerminal": "Ctrl+W",
            "nextTab": "Ctrl+]",
            "prevTab": "Ctrl+[",
            "toggleSidebar": "Ctrl+B",
            "settings": "Ctrl+,",
            "splitHorizontal": "Ctrl+Shift+D",
            "splitVertical": "Ctrl+Shift+E",
            "closePane": "Ctrl+Shift+W"
        },
        "customThemes": [],
        "notifications": { "claudeCode": true, "openCode": true, "codex": true }
    })
}

pub fn default_state() -> Value {
    json!({
        "sessions": [],
        "collections": [],
        "activeSessionId": null,
        "sidebarVisible": true,
        "sidebarWidth": 220,
        "workspaces": [],
        "activeWorkspaceId": null,
        "paneTree": null,
        "focusedPaneId": null
    })
}

fn deep_merge_subobject(defaults: &Value, parsed: &Value, target: &mut Value, key: &str) {
    let mut merged = defaults.get(key).and_then(Value::as_object).cloned().unwrap_or_default();
    if let Some(p) = parsed.get(key).and_then(Value::as_object) {
        for (k, v) in p {
            merged.insert(k.clone(), v.clone());
        }
    }
    target[key] = Value::Object(merged);
}

fn merge_settings(parsed: &Value, defaults: &Value) -> Value {
    let mut merged = defaults.clone();
    let obj = merged.as_object_mut().expect("defaults is an object");
    if let Some(p) = parsed.as_object() {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    }
    deep_merge_subobject(defaults, parsed, &mut merged, "shortcuts");
    deep_merge_subobject(defaults, parsed, &mut merged, "notifications");
    merged
}

fn merge_state(parsed: &Value, defaults: &Value) -> Value {
    let mut merged = defaults.clone();
    let obj = merged.as_object_mut().expect("defaults is an object");
    if let Some(p) = parsed.as_object() {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    }
    if !merged.get("sessions").is_some_and(Value::is_array) {
        merged["sessions"] = json!([]);
    }
    if !merged.get("collections").is_some_and(Value::is_array) {
        merged["collections"] = json!([]);
    }
    merged
}

fn load_json_from(path: &Path, defaults: &Value, merge: fn(&Value, &Value) -> Value) -> Value {
    let Ok(raw) = fs::read_to_string(path) else {
        return defaults.clone();
    };
    match serde_json::from_str::<Value>(&raw) {
        Ok(parsed) => merge(&parsed, defaults),
        Err(_) => defaults.clone(),
    }
}

fn save_atomic_to(path: &Path, data: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let payload = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&tmp, payload).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

// One-time migration from the pre-rename app directory (sibling of data_dir).
fn migrate_old_data_from(user_data: &Path, file_name: &str, old_app_name: &str) {
    let current = user_data.join(file_name);
    if current.exists() {
        return;
    }
    let old = user_data.with_file_name(old_app_name).join(file_name);
    if old.exists() {
        if let Err(e) = fs::create_dir_all(user_data).and_then(|_| fs::copy(&old, &current)) {
            eprintln!("[store] failed to migrate {file_name}: {e}");
        }
    }
}

// In-memory cache so repeated settings reads don't re-read and re-merge the
// JSON file. Invalidated whenever we persist (mirrors the old TS handler).
static SETTINGS_CACHE: LazyLock<Mutex<Option<Value>>> = LazyLock::new(|| Mutex::new(None));

pub fn load_settings() -> Value {
    let mut cache = SETTINGS_CACHE.lock().unwrap();
    if let Some(cached) = cache.as_ref() {
        return cached.clone();
    }
    migrate_old_data_from(&data_dir(), "settings.json", "terminal-sidebar");
    let defaults = default_settings();
    let settings = load_json_from(&data_dir().join("settings.json"), &defaults, merge_settings);
    *cache = Some(settings.clone());
    settings
}

pub fn save_settings(settings: &Value) -> Result<(), String> {
    save_atomic_to(&data_dir().join("settings.json"), settings)?;
    *SETTINGS_CACHE.lock().unwrap() = Some(settings.clone());
    Ok(())
}

pub fn load_state() -> Value {
    migrate_old_data_from(&data_dir(), "state.json", "terminal-sidebar");
    let defaults = default_state();
    load_json_from(&data_dir().join("state.json"), &defaults, merge_state)
}

pub fn save_state(state: &Value) -> Result<(), String> {
    save_atomic_to(&data_dir().join("state.json"), state)
}

// Guard against a malformed/partial state payload being written over good
// persisted state (same checks as the old validatePersistedState).
pub fn validate_state(state: &Value) -> Result<(), String> {
    let obj = state.as_object().ok_or("Invalid state payload: not an object")?;
    if !obj.get("sessions").is_some_and(Value::is_array) {
        return Err("Invalid state: sessions must be an array".into());
    }
    if !obj.get("collections").is_some_and(Value::is_array) {
        return Err("Invalid state: collections must be an array".into());
    }
    if !obj.get("sidebarWidth").is_some_and(Value::is_number) {
        return Err("Invalid state: sidebarWidth must be a number".into());
    }
    if !obj.get("sidebarVisible").is_some_and(Value::is_boolean) {
        return Err("Invalid state: sidebarVisible must be a boolean".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_settings_deep_merges_shortcuts() {
        let parsed = json!({ "shortcuts": { "newTerminal": "Ctrl+N" } });
        let merged = merge_settings(&parsed, &default_settings());
        assert_eq!(merged["shortcuts"]["newTerminal"], "Ctrl+N");
        assert_eq!(merged["shortcuts"]["closeTerminal"], "Ctrl+W");
        assert_eq!(merged["theme"], "dark");
    }

    #[test]
    fn merge_settings_overrides_top_level() {
        let parsed = json!({ "fontSize": 20, "notifications": { "codex": false } });
        let merged = merge_settings(&parsed, &default_settings());
        assert_eq!(merged["fontSize"], 20);
        assert_eq!(merged["notifications"]["codex"], false);
        assert_eq!(merged["notifications"]["claudeCode"], true);
    }

    #[test]
    fn merge_state_forces_arrays() {
        let parsed = json!({ "sessions": "garbage", "sidebarWidth": 300 });
        let merged = merge_state(&parsed, &default_state());
        assert_eq!(merged["sessions"], json!([]));
        assert_eq!(merged["collections"], json!([]));
        assert_eq!(merged["sidebarWidth"], 300);
    }

    #[test]
    fn validate_state_checks_shape() {
        assert!(validate_state(&json!(null)).is_err());
        assert!(validate_state(&json!({})).is_err());
        assert!(validate_state(&json!({
            "sessions": [], "collections": [], "sidebarWidth": 220, "sidebarVisible": true
        }))
        .is_ok());
        assert!(validate_state(&json!({
            "sessions": [], "collections": [], "sidebarWidth": "220", "sidebarVisible": true
        }))
        .is_err());
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("patty-store-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_save_and_load_roundtrip() {
        let dir = tmp_dir("roundtrip");
        let file = dir.join("settings.json");
        let data = json!({ "theme": "nord", "fontSize": 16 });
        save_atomic_to(&file, &data).unwrap();
        // Second save must succeed too (rename over existing target).
        save_atomic_to(&file, &json!({ "theme": "light" })).unwrap();
        let loaded = load_json_from(&file, &default_settings(), merge_settings);
        assert_eq!(loaded["theme"], "light");
        assert!(!file.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_yields_defaults() {
        let dir = tmp_dir("corrupt");
        let file = dir.join("settings.json");
        fs::write(&file, "{not json").unwrap();
        let loaded = load_json_from(&file, &default_settings(), merge_settings);
        assert_eq!(loaded, default_settings());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migration_copies_only_when_missing() {
        let dir = tmp_dir("migrate");
        let user_data = dir.join("Patty");
        let old_dir = dir.join("terminal-sidebar");
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(old_dir.join("state.json"), r#"{"sessions":[1]}"#).unwrap();

        migrate_old_data_from(&user_data, "state.json", "terminal-sidebar");
        assert!(user_data.join("state.json").exists());

        // Existing file is never overwritten by migration.
        fs::write(user_data.join("state.json"), r#"{"sessions":[2]}"#).unwrap();
        migrate_old_data_from(&user_data, "state.json", "terminal-sidebar");
        assert_eq!(
            fs::read_to_string(user_data.join("state.json")).unwrap(),
            r#"{"sessions":[2]}"#
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
