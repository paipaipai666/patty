use std::fs;
use std::sync::{LazyLock, Mutex};

static SERIAL: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn serial_lock() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn fresh_dir(name: &str) -> (std::path::PathBuf, std::sync::MutexGuard<'static, ()>) {
    let g = serial_lock();
    let dir = std::env::temp_dir().join(format!("patty-installer-it-{}-{}", std::process::id(), name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    patty::store::set_data_dir_for_test(dir.clone());
    (dir, g)
}

#[test]
fn installed_hook_path_under_data_dir() {
    let (dir, _g) = fresh_dir("hook_path");
    let path = patty::installer::installed_hook_path();
    assert!(path.starts_with(&dir), "installed_hook_path should be under data_dir");
    assert_eq!(path.file_name().unwrap(), "patty-hook.ps1");
}

#[test]
fn ensure_hook_script_copies_to_data_dir() {
    let (_dir, _g) = fresh_dir("copy_script");
    let result = patty::installer::ensure_hook_script_exists();
    assert!(result.exists(), "result path should exist: {}", result.display());

    let expected = patty::installer::installed_hook_path();
    assert_eq!(result, expected);

    let content = fs::read_to_string(&result).unwrap();
    assert!(content.contains("PATTY_HOOK_SECRET"), "hook script must contain PATTY_HOOK_SECRET");
    assert!(content.contains("patty-hook"), "hook script must contain patty-hook reference");
}

#[test]
fn ensure_hook_script_idempotent() {
    let (_dir, _g) = fresh_dir("idempotent");
    let first = patty::installer::ensure_hook_script_exists();
    let first_meta = fs::metadata(&first).unwrap();
    let second = patty::installer::ensure_hook_script_exists();
    let second_meta = fs::metadata(&second).unwrap();
    assert_eq!(first_meta.len(), second_meta.len(), "second call should not change file");
}

#[test]
fn opencode_plugin_source_exists() {
    let path = patty::installer::opencode_plugin_source();
    assert!(path.exists(), "opencode plugin source should exist: {}", path.display());
    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("PATTY_HOOK_SECRET"), "plugin must send the hook secret");
    assert!(content.contains("PATTY_PORT"), "plugin must reference PATTY_PORT");
    assert!(content.contains("PATTY_PANE_ID"), "plugin must reference PATTY_PANE_ID");
    assert!(content.contains("PattyNotifier"), "plugin must export PattyNotifier");
}

#[test]
fn claude_settings_path_format() {
    let path = patty::installer::claude_settings_path();
    assert_eq!(path.file_name().unwrap(), "settings.json");
    assert!(path.to_string_lossy().contains(".claude"));
}

#[test]
fn codex_settings_path_format() {
    let path = patty::installer::codex_settings_path();
    assert_eq!(path.file_name().unwrap(), "hooks.json");
    assert!(path.to_string_lossy().contains(".codex"));
}
