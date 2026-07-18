#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::sync::{LazyLock, Mutex};

// In-memory stand-ins so the renderer boots before the persistent store lands
// in the next commit. Values mirror src/shared/defaultSettings.ts.
static SETTINGS: LazyLock<Mutex<Value>> = LazyLock::new(|| {
    Mutex::new(json!({
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
    }))
});

static STATE: LazyLock<Mutex<Value>> = LazyLock::new(|| {
    Mutex::new(json!({
        "sessions": [],
        "collections": [],
        "activeSessionId": null,
        "sidebarVisible": true,
        "sidebarWidth": 220,
        "workspaces": [],
        "activeWorkspaceId": null,
        "paneTree": null,
        "focusedPaneId": null
    }))
});

#[tauri::command]
fn settings_get_all() -> Value {
    SETTINGS.lock().unwrap().clone()
}

#[tauri::command]
fn settings_set(key: &str, value: Value) -> Result<Value, String> {
    // The in-memory map starts from the defaults and keys are never removed,
    // so a contains-key check is equivalent to checking DEFAULT_SETTINGS.
    let mut settings = SETTINGS.lock().unwrap();
    let obj = settings.as_object_mut().ok_or("settings corrupt")?;
    if !obj.contains_key(key) {
        return Err(format!("Unknown settings key: {key}"));
    }
    obj.insert(key.to_string(), value);
    Ok(settings.clone())
}

#[tauri::command]
fn state_load() -> Value {
    STATE.lock().unwrap().clone()
}

#[tauri::command]
fn state_save(state: Value) -> Result<(), String> {
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
    *STATE.lock().unwrap() = state;
    Ok(())
}

#[tauri::command]
fn create_pty() -> Value {
    json!({ "pid": 0, "success": false, "error": "pty: not implemented yet" })
}

#[tauri::command]
fn write_pty() {}

#[tauri::command]
fn resize_pty() {}

#[tauri::command]
fn kill_pty() -> Value {
    json!({ "success": false, "error": "pty: not implemented yet" })
}

#[tauri::command]
fn detect_shells() -> Vec<Value> {
    Vec::new()
}

#[tauri::command]
fn get_fonts() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
fn get_hook_port() -> u16 {
    0
}

#[tauri::command]
fn reset_attention() {}

#[tauri::command]
fn select_directory() -> Result<Value, String> {
    Err("dialog: not implemented yet".into())
}

#[tauri::command]
fn theme_export() -> Result<Value, String> {
    Err("dialog: not implemented yet".into())
}

#[tauri::command]
fn theme_import() -> Result<Value, String> {
    Err("dialog: not implemented yet".into())
}

#[tauri::command]
fn perf_dump() -> Value {
    json!({ "success": true })
}

#[tauri::command]
fn metrics_history() -> Value {
    json!({ "firstTerminal": [], "samples": [] })
}

#[tauri::command]
fn metrics_set_sampling() {}

#[tauri::command]
fn metrics_record_first_terminal() -> Value {
    json!({ "success": true })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            settings_get_all,
            settings_set,
            state_load,
            state_save,
            create_pty,
            write_pty,
            resize_pty,
            kill_pty,
            detect_shells,
            get_fonts,
            get_hook_port,
            reset_attention,
            select_directory,
            theme_export,
            theme_import,
            perf_dump,
            metrics_history,
            metrics_set_sampling,
            metrics_record_first_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
