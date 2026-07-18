#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pty;
mod store;

use serde_json::{json, Value};

#[tauri::command]
fn settings_get_all() -> Value {
    store::load_settings()
}

#[tauri::command]
fn settings_set(key: &str, value: Value) -> Result<Value, String> {
    // Reject keys outside AppSettings so a buggy renderer or spoofed call can't
    // silently write arbitrary fields into settings.json.
    let defaults = store::default_settings();
    if !defaults.as_object().unwrap().contains_key(key) {
        return Err(format!("Unknown settings key: {key}"));
    }
    let mut settings = store::load_settings();
    settings[key] = value;
    store::save_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
fn state_load() -> Value {
    store::load_state()
}

#[tauri::command]
fn state_save(state: Value) -> Result<(), String> {
    store::validate_state(&state)?;
    store::save_state(&state)
}

#[tauri::command]
fn create_pty(
    app: tauri::AppHandle,
    id: &str,
    cwd: Option<&str>,
    shell: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Value {
    pty::create(&app, id, cwd, shell, cols, rows)
}

#[tauri::command]
fn write_pty(id: &str, data: &str) {
    pty::write(id, data)
}

#[tauri::command]
fn resize_pty(id: &str, cols: u16, rows: u16) {
    pty::resize(id, cols, rows)
}

#[tauri::command]
fn kill_pty(id: &str) -> Value {
    pty::kill(id)
}

#[tauri::command]
fn detect_shells() -> Value {
    pty::detect_shells()
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
        .setup(|app| {
            pty::init_resource_dir(app.handle());
            // Preheat the persisted workspace's shells so they boot while the
            // renderer is still loading (replay attaches on pty:create).
            pty::warm_startup(app.handle());
            Ok(())
        })
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
