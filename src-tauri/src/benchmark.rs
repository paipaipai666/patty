use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct OutputTrace {
    buckets: BTreeMap<u64, OutputBucket>,
    markers: BTreeMap<u32, u64>,
}

#[derive(Default)]
struct OutputBucket {
    read_bytes: usize,
    dispatched_bytes: usize,
    events: usize,
    dispatch_ns: u64,
}

impl OutputTrace {
    fn bucket(&mut self, at: u64) -> &mut OutputBucket {
        self.buckets.entry(at / 20 * 20).or_default()
    }

    fn read(&mut self, at: u64, bytes: usize) {
        self.bucket(at).read_bytes += bytes;
    }

    fn dispatched(&mut self, at: u64, bytes: usize, duration_ns: u64, text: &str) {
        let bucket = self.bucket(at);
        bucket.dispatched_bytes += bytes;
        bucket.events += 1;
        bucket.dispatch_ns += duration_ns;
        for (index, prefix) in text.match_indices("PATTY_") {
            let suffix = &text[index + prefix.len()..];
            let digits = suffix.bytes().take_while(u8::is_ascii_digit).count();
            if suffix[digits..].starts_with("_DONE") {
                if let Ok(id) = suffix[..digits].parse() {
                    let first = self.markers.entry(id).or_insert(at);
                    *first = (*first).min(at);
                }
            }
        }
    }
}

impl Serialize for OutputTrace {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Snapshot<'a> {
            buckets: Vec<(u64, usize, usize, usize, u64)>,
            markers: &'a BTreeMap<u32, u64>,
        }
        Snapshot {
            buckets: self.buckets.iter().map(|(&at, bucket)| (
                at, bucket.read_bytes, bucket.dispatched_bytes, bucket.events, bucket.dispatch_ns,
            )).collect(),
            markers: &self.markers,
        }.serialize(serializer)
    }
}

static OUTPUT: OnceLock<Mutex<OutputTrace>> = OnceLock::new();

fn epoch_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

pub(crate) fn record_read(bytes: usize) {
    if let Some(trace) = OUTPUT.get() {
        let at = epoch_ms();
        trace.lock().unwrap().read(at, bytes);
    }
}

pub(crate) fn dispatch_probe() -> Option<(u64, Instant)> {
    OUTPUT.get().map(|_| (epoch_ms(), Instant::now()))
}

pub(crate) fn record_dispatch(probe: (u64, Instant), text: &str) {
    let (at, start) = probe;
    let duration_ns = start.elapsed().as_nanos() as u64;
    if let Some(trace) = OUTPUT.get() {
        trace.lock().unwrap().dispatched(at, text.len(), duration_ns, text);
    }
}

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
    let trace = OUTPUT.get_or_init(Mutex::default);
    if let Some(mut report) = report {
        let trace = serde_json::to_value(&*trace.lock().unwrap()).map_err(|error| error.to_string())?;
        let fields = report.as_object_mut().ok_or("Expected a benchmark report object")?;
        fields.insert("ptyOutput".into(), trace);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_trace_counts_bytes_at_each_boundary_and_ignores_echoed_probes() {
        let mut trace = OutputTrace::default();
        trace.read(19, 5);
        trace.read(20, 8);
        trace.dispatched(24, 6, 37, "PATTY_'+'7_DONE'");
        trace.dispatched(39, 12, 53, "PATTY_7_DONE\r\n");
        trace.dispatched(41, 12, 23, "PATTY_7_DONE\r\n");

        assert_eq!(serde_json::to_value(trace).unwrap(), serde_json::json!({
            "buckets": [[0, 5, 0, 0, 0], [20, 8, 18, 2, 90], [40, 0, 12, 1, 23]],
            "markers": { "7": 39 }
        }));
    }
}
