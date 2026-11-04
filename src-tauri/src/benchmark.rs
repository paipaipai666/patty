use serde_json::Value;
use std::path::Path;

pub(crate) fn request_count(data: &Path, integrations: Option<&Path>, text: &str) -> Result<u8, String> {
    if !data.is_absolute()
        || data.parent().map(|parent| parent.join("integrations")).as_deref() != integrations
        || integrations.is_none()
    {
        return Err("Benchmark requires the isolated E2E data directory".into());
    }
    match text.trim().parse() {
        Ok(count @ (1 | 10 | 30)) => Ok(count),
        _ => Err("Benchmark session count must be 1, 10 or 30".into()),
    }
}

#[tauri::command]
pub fn benchmark_exchange(report: Option<Value>) -> Result<u8, String> {
    let data = crate::store::data_dir();
    let count = load_count(&data)?;
    if let Some(report) = report {
        let payload = serde_json::to_vec(&report).map_err(|error| error.to_string())?;
        if payload.len() > 1024 * 1024 {
            return Err("Benchmark report exceeds 1 MiB".into());
        }
        let temporary = data.join("benchmark-report.tmp");
        std::fs::write(&temporary, payload).map_err(|error| error.to_string())?;
        std::fs::rename(temporary, data.join("benchmark-report.json")).map_err(|error| error.to_string())?;
    }
    Ok(count)
}

pub(crate) fn load_count(data: &Path) -> Result<u8, String> {
    let integrations = std::env::var_os("PATTY_E2E_INTEGRATION_HOME")
        .ok_or("Benchmark requires PATTY_E2E_INTEGRATION_HOME")?;
    let request = std::fs::read_to_string(data.join("benchmark-request")).map_err(|error| error.to_string())?;
    request_count(data, Some(Path::new(&integrations)), &request)
}
