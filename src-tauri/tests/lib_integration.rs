use std::sync::{LazyLock, Mutex};

static SERIAL: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[test]
fn boot_bg_reads_from_persisted_settings() {
    let _g = SERIAL.lock().unwrap();
    let dir = std::env::temp_dir().join(format!("patty-lib-test-boot-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    patty::store::set_data_dir_for_test(dir.clone());

    let settings = serde_json::json!({
        "theme": "light",
        "shortcuts": patty::store::default_settings()["shortcuts"],
        "notifications": patty::store::default_settings()["notifications"],
        "customThemes": [],
        "fontFamily": "Cascadia Code",
        "fontSize": 14,
    });
    patty::store::save_settings(&settings).unwrap();

    let c = patty::boot_background_color();
    assert_eq!(c, tauri::window::Color(246, 247, 249, 255));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn boot_bg_dark_default_from_no_settings() {
    let _g = SERIAL.lock().unwrap();
    let dir = std::env::temp_dir().join(format!("patty-lib-test-dark-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    patty::store::set_data_dir_for_test(dir.clone());

    let c = patty::boot_background_color();
    assert_eq!(c, tauri::window::Color(10, 10, 12, 255));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn boot_bg_custom_theme_from_persisted_settings() {
    let _g = SERIAL.lock().unwrap();
    let dir = std::env::temp_dir().join(format!("patty-lib-test-custom-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    patty::store::set_data_dir_for_test(dir.clone());

    let settings = serde_json::json!({
        "theme": "my-dark",
        "shortcuts": patty::store::default_settings()["shortcuts"],
        "notifications": patty::store::default_settings()["notifications"],
        "customThemes": [
            {"id": "my-dark", "ui": {"--bg-app": "#445566"}, "terminal": {}}
        ],
        "fontFamily": "Cascadia Code",
        "fontSize": 14,
    });
    patty::store::save_settings(&settings).unwrap();

    let c = patty::boot_background_color();
    assert_eq!(c, tauri::window::Color(68, 85, 102, 255));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn parse_hex_color_integration() {
    assert_eq!(
        patty::parse_hex_color("#ff0000"),
        Some(tauri::window::Color(255, 0, 0, 255))
    );
    assert!(patty::parse_hex_color("invalid").is_none());
}
