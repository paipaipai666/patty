#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fonts;
mod hooks;
mod installer;
mod metrics;
mod pty;
mod store;

use serde_json::{json, Value};
use tauri::Manager;

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
fn get_fonts() -> Result<Vec<String>, String> {
    fonts::get_fonts()
}

#[tauri::command]
fn get_hook_port() -> u16 {
    hooks::hook_port()
}

#[tauri::command]
fn reset_attention() {}

#[tauri::command]
async fn select_directory() -> Value {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Select project directory")
        .pick_folder()
        .await;
    match folder {
        Some(f) => json!({ "canceled": false, "directory": f.path().to_string_lossy() }),
        None => json!({ "canceled": true, "directory": Value::Null }),
    }
}

#[tauri::command]
async fn theme_export(theme: Value) -> Value {
    let name = theme.get("name").and_then(Value::as_str).unwrap_or("theme");
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Export Theme")
        .set_file_name(format!("{name}.json"))
        .add_filter("JSON", &["json"])
        .save_file()
        .await
    else {
        return json!({ "success": false });
    };
    match serde_json::to_string_pretty(&theme) {
        Ok(payload) => match std::fs::write(file.path(), payload) {
            Ok(_) => json!({ "success": true }),
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        },
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
async fn theme_import() -> Value {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Import Theme")
        .add_filter("JSON", &["json"])
        .pick_file()
        .await
    else {
        return json!({ "success": false });
    };
    let parse = (|| -> Result<Value, String> {
        let raw = std::fs::read_to_string(file.path()).map_err(|e| e.to_string())?;
        let mut theme: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if theme.get("name").is_none() || theme.get("ui").is_none() || theme.get("terminal").is_none() {
            return Err("Invalid theme file".into());
        }
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let mut entropy = [0u8; 4];
        let _ = getrandom::fill(&mut entropy);
        theme["id"] = json!(format!("custom-{millis}-{:06x}", u32::from_le_bytes(entropy) & 0xFFFFFF));
        Ok(theme)
    })();
    match parse {
        Ok(theme) => json!({ "success": true, "theme": theme }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

#[tauri::command]
fn perf_dump() -> Value {
    json!({ "success": true })
}

#[tauri::command]
fn metrics_history() -> Value {
    metrics::snapshot()
}

#[tauri::command]
fn metrics_set_sampling(app: tauri::AppHandle, enabled: bool) {
    metrics::set_sampling(&app, enabled)
}

#[tauri::command]
fn metrics_record_first_terminal(entry: Value) -> Value {
    metrics::record_first_terminal(entry);
    json!({ "success": true })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: restore and focus the existing window.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            pty::init_resource_dir(app.handle());
            // Hook server first: PTYs spawned after this point get a real
            // PATTY_PORT / PATTY_HOOK_SECRET in their environment.
            if let Err(e) = hooks::start_hook_server(app.handle().clone()) {
                eprintln!("[main] hook server failed to start: {e}");
            }
            // Install AI-tool hooks only when the user has them enabled.
            let settings = store::load_settings();
            if settings["notifications"]["claudeCode"].as_bool().unwrap_or(true) {
                installer::ensure_claude_code_hook();
            }
            if settings["notifications"]["openCode"].as_bool().unwrap_or(true) {
                installer::ensure_opencode_plugin();
            }
            if settings["notifications"]["codex"].as_bool().unwrap_or(true) {
                installer::ensure_codex_hook();
            }
            hooks::start_heartbeat_watchdog(app.handle().clone());
            metrics::load_history();
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
