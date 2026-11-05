use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const IDENTIFIER: &str = "com.patty.integration-test";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgramSample {
    Blocked,
    Working,
    Done,
    Error,
    Clear,
    Prompt,
    Invalid,
    Reset,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Snapshot,
    Select {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Notify {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Remove {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    OpenSettings,
    OpenDetails,
    NextAttention,
    ClosePanel,
    Minimize,
    Program {
        #[serde(rename = "sessionId")]
        session_id: String,
        report: ProgramSample,
    },
    Cleanup,
    CloseApp,
}

#[derive(Deserialize, Serialize)]
pub struct Request {
    sequence: u32,
    #[serde(flatten)]
    action: Action,
}

fn validate_root(root: &Path, integrations: &Path, temp: &Path) -> Result<(), String> {
    if !root.is_absolute()
        || root.parent() != Some(temp)
        || !root
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("patty-e2e-") && name.len() > 10)
        || integrations != root.join("integrations")
    {
        return Err("Native verification requires its isolated temporary directory".into());
    }
    Ok(())
}

fn request(bytes: &[u8]) -> Result<Request, String> {
    if bytes.len() > 65_536 {
        return Err("Native verification request exceeds 64 KiB".into());
    }
    let parsed: Request = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    if parsed.sequence == 0 {
        return Err("Invalid verification sequence".into());
    }
    Ok(parsed)
}

fn root() -> Result<PathBuf, String> {
    let root = std::env::var_os("APPDATA").ok_or("Missing APPDATA")?;
    let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    let temp = std::fs::canonicalize(std::env::temp_dir()).map_err(|error| error.to_string())?;
    let integrations =
        std::env::var_os("PATTY_E2E_INTEGRATION_HOME").ok_or("Missing isolated CLI directory")?;
    let integrations = Path::new(&integrations);
    if !integrations.is_absolute()
        || integrations.file_name() != Some(std::ffi::OsStr::new("integrations"))
        || std::fs::canonicalize(
            integrations
                .parent()
                .ok_or("Missing CLI directory parent")?,
        )
        .map_err(|error| error.to_string())?
            != root
    {
        return Err("Native verification CLI directory must belong to its temporary root".into());
    }
    validate_root(&root, &root.join("integrations"), &temp)?;
    Ok(root)
}

pub fn prepare(identifier: &str) -> Result<(), String> {
    if identifier != IDENTIFIER {
        return Ok(());
    }
    let args: Vec<_> = std::env::args_os().collect();
    if let Some(index) = args.iter().position(|arg| arg == "--integration-data") {
        let value = args
            .get(index + 1)
            .ok_or("Missing integration data directory")?;
        let candidate = std::fs::canonicalize(value).map_err(|error| error.to_string())?;
        let temp =
            std::fs::canonicalize(std::env::temp_dir()).map_err(|error| error.to_string())?;
        validate_root(&candidate, &candidate.join("integrations"), &temp)?;
        if !candidate.join("Patty/native-request.json").is_file() {
            return Err("Missing native verification request".into());
        }
        std::env::set_var("APPDATA", &candidate);
        std::env::set_var("PATTY_E2E_INTEGRATION_HOME", candidate.join("integrations"));
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", candidate.join("webview"));
    }
    root()?;
    Ok(())
}

pub fn protocol_arguments() -> Result<String, String> {
    Ok(format!("\"--integration-data\" \"{}\"", root()?.display()))
}

#[tauri::command]
pub async fn native_verification_exchange(
    app: AppHandle,
    report: Option<Value>,
) -> Result<Option<Request>, String> {
    tauri::async_runtime::spawn_blocking(move || exchange(app, report))
        .await
        .map_err(|error| error.to_string())?
}

fn exchange(app: AppHandle, report: Option<Value>) -> Result<Option<Request>, String> {
    if app.config().identifier != IDENTIFIER {
        return Err("Native verification is only available in its dedicated build".into());
    }
    let root = root()?;
    let data = root.join("Patty");
    if let Some(mut report) = report {
        let fields = report
            .as_object_mut()
            .ok_or("Expected a verification report")?;
        fields.insert("nativeProcessId".into(), Value::from(std::process::id()));
        fields.insert(
            "activationCount".into(),
            Value::from(crate::desktop_notifications::verification_activation_count()),
        );
        if let Some((class_id, identity)) =
            crate::desktop_notifications::verification_callback(&app)
        {
            fields.insert("callbackClassId".into(), Value::from(class_id));
            fields.insert("callbackIdentity".into(), Value::from(identity));
        }
        match crate::desktop_notifications::verification_association(&app) {
            Ok(handler) => {
                fields.insert("protocolHandler".into(), Value::from(handler));
            }
            Err(error) => {
                fields.insert("protocolHandlerError".into(), Value::from(error));
            }
        }
        fields.insert(
            "nativeFocused".into(),
            Value::from(
                app.get_webview_window("main")
                    .is_some_and(|window| window.is_focused().unwrap_or(false)),
            ),
        );
        fields.insert(
            "notificationXml".into(),
            Value::from(crate::desktop_notifications::verification_xml(&app)?),
        );
        let payload = serde_json::to_vec(&report).map_err(|error| error.to_string())?;
        if payload.len() > 65_536 {
            return Err("Native verification report exceeds 64 KiB".into());
        }
        let temporary = data.join("native-report.tmp");
        std::fs::write(&temporary, payload).map_err(|error| error.to_string())?;
        std::fs::rename(temporary, data.join("native-report.json"))
            .map_err(|error| error.to_string())?;
    }
    let path = data.join("native-request.json");
    if std::fs::metadata(&path).is_ok_and(|metadata| metadata.len() > 65_536) {
        return Err("Native verification request exceeds 64 KiB".into());
    }
    match std::fs::read(path) {
        Ok(bytes) => request(&bytes).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn native_verification_cleanup(app: AppHandle) -> Result<(), String> {
    if app.config().identifier != IDENTIFIER {
        return Err("Not a native verification build".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        root()?;
        crate::desktop_notifications::verification_cleanup(&app)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_only_accepts_a_direct_temporary_child_and_its_cli_directory() {
        let temp = std::env::temp_dir();
        let root = temp.join("patty-e2e-native-verification");
        assert!(validate_root(&root, &root.join("integrations"), &temp).is_ok());
        for invalid in [
            temp.clone(),
            temp.join("Patty"),
            temp.join("patty-e2e-"),
            temp.join("patty-e2e-x/nested"),
        ] {
            assert!(validate_root(&invalid, &invalid.join("integrations"), &temp).is_err());
        }
        assert!(validate_root(&root, &temp, &temp).is_err());
    }

    #[test]
    fn verification_requests_are_bounded_and_have_no_arbitrary_execution_operation() {
        assert!(request(r#"{"sequence":1,"action":"snapshot"}"#.as_bytes()).is_ok());
        assert!(
            request(r#"{"sequence":2,"action":"select","sessionId":"target"}"#.as_bytes()).is_ok()
        );
        assert!(request(r#"{"sequence":3,"action":"eval","code":"exit"}"#.as_bytes()).is_err());
        assert!(request(r#"{"sequence":0,"action":"snapshot"}"#.as_bytes()).is_err());
        assert!(request(&vec![b' '; 65_537]).is_err());
    }

    #[test]
    fn program_verification_only_accepts_named_output_samples() {
        for report in [
            "blocked", "working", "done", "error", "clear", "prompt", "invalid", "reset",
        ] {
            let value = serde_json::json!({ "sequence": 1, "action": "program", "sessionId": "target", "report": report });
            assert!(
                request(&serde_json::to_vec(&value).unwrap()).is_ok(),
                "{report}"
            );
        }
        for value in [
            serde_json::json!({ "sequence": 1, "action": "program", "sessionId": "target", "report": "custom" }),
            serde_json::json!({ "sequence": 1, "action": "program", "sessionId": "target", "report": "blocked", "command": "exit" }),
        ] {
            assert!(request(&serde_json::to_vec(&value).unwrap()).is_err());
        }
    }
}
