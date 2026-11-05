use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct OutputTrace {
    buckets: BTreeMap<u64, OutputBucket>,
    reads: MarkerTrace,
    dispatches: MarkerTrace,
    input_received: MarkerTrace<String>,
    input_queued: MarkerTrace,
    input_writes: MarkerTrace,
    input_written: MarkerTrace,
}

#[derive(Default)]
struct MarkerTrace<K = u64> {
    partial: BTreeMap<K, MarkerScan>,
    times: BTreeMap<u32, f64>,
}

#[derive(Default)]
enum MarkerScan {
    #[default]
    Seeking,
    Prefix(usize),
    Number(Option<u32>),
    Suffix { id: u32, matched: usize },
}

impl MarkerScan {
    fn consume(&mut self, byte: u8, prefix: &[u8]) -> Option<u32> {
        const SUFFIX: &[u8] = b"_DONE";
        let restart = || if byte == prefix[0] { Self::Prefix(1) } else { Self::Seeking };
        *self = match *self {
            Self::Prefix(matched) if byte == prefix[matched] => {
                if matched + 1 == prefix.len() { Self::Number(None) } else { Self::Prefix(matched + 1) }
            }
            Self::Number(value) if byte.is_ascii_digit() => {
                let digit = u32::from(byte - b'0');
                match value.unwrap_or(0).checked_mul(10).and_then(|prefix| prefix.checked_add(digit)) {
                    Some(id) => Self::Number(Some(id)),
                    None => restart(),
                }
            }
            Self::Number(Some(id)) if byte == SUFFIX[0] => Self::Suffix { id, matched: 1 },
            Self::Suffix { id, matched } if byte == SUFFIX[matched] => {
                if matched + 1 == SUFFIX.len() {
                    *self = Self::Seeking;
                    return Some(id);
                }
                Self::Suffix { id, matched: matched + 1 }
            }
            _ => restart(),
        };
        None
    }
}

impl<K: Ord> MarkerTrace<K> {
    fn record(&mut self, stream: K, at: f64, bytes: &[u8]) {
        self.pattern(stream, at, bytes, b"PATTY_");
    }

    fn input(&mut self, stream: K, at: f64, bytes: &[u8]) {
        self.pattern(stream, at, bytes, b"PATTY_'+'");
    }

    fn pattern(&mut self, stream: K, at: f64, bytes: &[u8], prefix: &[u8]) {
        let mut scan = self.partial.remove(&stream).unwrap_or_default();
        for &byte in bytes {
            if let Some(id) = scan.consume(byte, prefix) {
                let first = self.times.entry(id).or_insert(at);
                *first = first.min(at);
            }
        }
        if !matches!(scan, MarkerScan::Seeking) {
            self.partial.insert(stream, scan);
        }
    }
}

pub(crate) enum InputStage {
    Queued,
    WriteStarted,
    Written,
}

#[derive(Default)]
struct OutputBucket {
    read_bytes: usize,
    dispatched_bytes: usize,
    events: usize,
    dispatch_ns: u64,
}

impl OutputTrace {
    fn received(&mut self, pane: &str, at: f64, bytes: &[u8]) {
        self.input_received.input(pane.to_owned(), at, bytes);
    }

    fn input(&mut self, stage: InputStage, stream: u64, at: f64, bytes: &[u8]) {
        let trace = match stage {
            InputStage::Queued => &mut self.input_queued,
            InputStage::WriteStarted => &mut self.input_writes,
            InputStage::Written => &mut self.input_written,
        };
        trace.input(stream, at, bytes);
    }

    fn bucket(&mut self, at: u64) -> &mut OutputBucket {
        self.buckets.entry(at / 20 * 20).or_default()
    }

    fn read(&mut self, stream: u64, at: f64, bytes: &[u8]) {
        self.bucket(at as u64).read_bytes += bytes.len();
        self.reads.record(stream, at, bytes);
    }

    fn dispatched(&mut self, stream: u64, at: f64, duration_ns: u64, text: &str) {
        let bucket = self.bucket(at as u64);
        bucket.dispatched_bytes += text.len();
        bucket.events += 1;
        bucket.dispatch_ns += duration_ns;
        self.dispatches.record(stream, at, text.as_bytes());
    }
}

impl Serialize for OutputTrace {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Snapshot<'a> {
            buckets: Vec<(u64, usize, usize, usize, u64)>,
            markers: &'a BTreeMap<u32, f64>,
            read_markers: &'a BTreeMap<u32, f64>,
            input_received_markers: &'a BTreeMap<u32, f64>,
            input_queued_markers: &'a BTreeMap<u32, f64>,
            input_write_markers: &'a BTreeMap<u32, f64>,
            input_written_markers: &'a BTreeMap<u32, f64>,
        }
        Snapshot {
            buckets: self.buckets.iter().map(|(&at, bucket)| (
                at, bucket.read_bytes, bucket.dispatched_bytes, bucket.events, bucket.dispatch_ns,
            )).collect(),
            markers: &self.dispatches.times,
            read_markers: &self.reads.times,
            input_received_markers: &self.input_received.times,
            input_queued_markers: &self.input_queued.times,
            input_write_markers: &self.input_writes.times,
            input_written_markers: &self.input_written.times,
        }.serialize(serializer)
    }
}

static OUTPUT: OnceLock<Mutex<OutputTrace>> = OnceLock::new();

fn epoch_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() * 1000.0
}

pub(crate) fn record_input_received(pane: &str, text: &str) {
    if let Some(trace) = OUTPUT.get() {
        let at = epoch_ms();
        trace.lock().unwrap().received(pane, at, text.as_bytes());
    }
}

pub(crate) fn record_input(stage: InputStage, stream: u64, bytes: &[u8]) {
    if let Some(trace) = OUTPUT.get() {
        let at = epoch_ms();
        trace.lock().unwrap().input(stage, stream, at, bytes);
    }
}

pub(crate) fn record_read(stream: u64, bytes: &[u8]) {
    if let Some(trace) = OUTPUT.get() {
        let at = epoch_ms();
        trace.lock().unwrap().read(stream, at, bytes);
    }
}

pub(crate) fn dispatch_probe() -> Option<(f64, Instant)> {
    OUTPUT.get().map(|_| (epoch_ms(), Instant::now()))
}

pub(crate) fn record_dispatch(stream: u64, probe: (f64, Instant), text: &str) {
    let (at, start) = probe;
    let duration_ns = start.elapsed().as_nanos() as u64;
    if let Some(trace) = OUTPUT.get() {
        trace.lock().unwrap().dispatched(stream, at, duration_ns, text);
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
pub fn benchmark_exchange(report: Option<Value>) -> Result<BenchmarkRequest, String> {
    let data = crate::store::data_dir();
    let count = load_count(&data)?;
    let order = trace_order(std::env::var("PATTY_BENCHMARK_TRACE_ORDER").ok().as_deref())?;
    let trace = OUTPUT.get_or_init(Mutex::default);
    let integrations = std::env::var_os("PATTY_E2E_INTEGRATION_HOME").ok_or("Missing isolated integrations directory")?;
    if report.is_none() {
        std::fs::create_dir_all(&integrations).map_err(|error| error.to_string())?;
        std::fs::write(Path::new(&integrations).join("benchmark-shell-trace.ps1"), include_str!("../../src/renderer/benchmark/shellTrace.ps1"))
            .map_err(|error| error.to_string())?;
    }
    if let Some(mut report) = report {
        let trace = serde_json::to_value(&*trace.lock().unwrap()).map_err(|error| error.to_string())?;
        let fields = report.as_object_mut().ok_or("Expected a benchmark report object")?;
        fields.insert("ptyOutput".into(), trace);
        fields.insert("outputWaitMode".into(), Value::String(crate::pty_output::wait_mode().into()));
        if let Some(batches) = read_shell_traces(&Path::new(&integrations).join("benchmark-shell-traces.json"))? {
            fields.insert("shellTraces".into(), batches);
        }
        let payload = serde_json::to_vec(&report).map_err(|error| error.to_string())?;
        if payload.len() > 1024 * 1024 {
            return Err("Benchmark report exceeds 1 MiB".into());
        }
        let temporary = data.join("benchmark-report.tmp");
        std::fs::write(&temporary, payload).map_err(|error| error.to_string())?;
        std::fs::rename(temporary, data.join("benchmark-report.json")).map_err(|error| error.to_string())?;
    }
    Ok(BenchmarkRequest { count, trace_order: order })
}

pub(crate) fn load_count(data: &Path) -> Result<u8, String> {
    let integrations = std::env::var_os("PATTY_E2E_INTEGRATION_HOME")
        .ok_or("Benchmark requires PATTY_E2E_INTEGRATION_HOME")?;
    let request = std::fs::read_to_string(data.join("benchmark-request")).map_err(|error| error.to_string())?;
    request_count(data, Some(Path::new(&integrations)), &request)
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TraceOrder {
    RecordFirst,
    ControlFirst,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkRequest {
    count: u8,
    trace_order: TraceOrder,
}

fn trace_order(value: Option<&str>) -> Result<TraceOrder, String> {
    match value {
        None | Some("record-first") => Ok(TraceOrder::RecordFirst),
        Some("control-first") => Ok(TraceOrder::ControlFirst),
        _ => Err("Benchmark trace order must be record-first or control-first".into()),
    }
}

fn read_shell_traces(path: &Path) -> Result<Option<Value>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut bytes = Vec::new();
    file.take(65537).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() > 65536 { return Err("Shell trace exceeds 64 KiB".into()); }
    let batches: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let list = batches.as_array().ok_or("Expected Shell trace batch array")?;
    if list.is_empty() || list.len() > 4 { return Err("Expected one to four Shell trace batches".into()); }
    Ok(Some(batches))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_trace_order_rejects_unknown_requests() {
        assert_eq!(trace_order(None).unwrap(), TraceOrder::RecordFirst);
        assert_eq!(trace_order(Some("record-first")).unwrap(), TraceOrder::RecordFirst);
        assert_eq!(trace_order(Some("control-first")).unwrap(), TraceOrder::ControlFirst);
        assert!(trace_order(Some("anything")).is_err());
    }

    #[test]
    fn shell_trace_report_reads_only_bounded_json_batches() {
        let path = std::env::temp_dir().join(format!("patty-trace-reader-{}.json", std::process::id()));
        struct TraceFile(std::path::PathBuf);
        impl Drop for TraceFile { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }
        let file = TraceFile(path);
        assert_eq!(read_shell_traces(&file.0).unwrap(), None);
        let expected = serde_json::json!([{ "name": "diagnostic-input", "rows": [[7, 1, 2, 3, 4, 5, 6]] }]);
        std::fs::write(&file.0, expected.to_string()).unwrap();
        assert_eq!(read_shell_traces(&file.0).unwrap(), Some(expected));
        for invalid in ["{", "{}", "[1,2,3,4,5]"] {
            std::fs::write(&file.0, invalid).unwrap();
            assert!(read_shell_traces(&file.0).is_err(), "{invalid}");
        }
        std::fs::write(&file.0, vec![b' '; 65537]).unwrap();
        assert!(read_shell_traces(&file.0).is_err());
    }

    #[test]
    fn output_trace_counts_bytes_at_each_boundary_and_ignores_echoed_probes() {
        let mut trace = OutputTrace::default();
        trace.read(1, 19.0, b"PATTY");
        trace.read(1, 20.0, b"_7_DONE\n");
        trace.dispatched(1, 24.0, 37, "PATTY_'+'7_DONE'");
        trace.dispatched(1, 39.0, 53, "PATTY_7_DONE\r\n");
        trace.dispatched(1, 41.0, 23, "PATTY_7_DONE\r\n");

        assert_eq!(serde_json::to_value(trace).unwrap(), serde_json::json!({
            "buckets": [[0, 5, 0, 0, 0], [20, 8, 30, 2, 90], [40, 0, 14, 1, 23]],
            "markers": { "7": 39.0 },
            "readMarkers": { "7": 20.0 },
            "inputReceivedMarkers": {},
            "inputQueuedMarkers": {},
            "inputWriteMarkers": {},
            "inputWrittenMarkers": {}
        }));
    }

    #[test]
    fn records_the_batch_that_completes_a_split_probe() {
        let mut trace = OutputTrace::default();
        trace.dispatched(1, 21.0, 10, "PATTY_9");
        trace.dispatched(2, 22.0, 10, "_DONE\r");
        trace.dispatched(1, 23.0, 10, "_DO");
        trace.dispatched(1, 24.0, 10, "NE\r");
        assert_eq!(serde_json::to_value(trace).unwrap()["markers"], serde_json::json!({ "9": 24.0 }));
    }

    #[test]
    fn input_probe_boundaries_remain_paired_across_chunks_and_sessions() {
        let mut trace = OutputTrace::default();
        trace.received("pane-a", 10.0, b"PATTY_'+'");
        trace.received("pane-b", 11.0, b"7_DONE");
        trace.received("pane-a", 12.0, b"7_DONE");
        trace.input(InputStage::Queued, 1, 13.0, b"PATTY_'+'7_DONE");
        trace.input(InputStage::WriteStarted, 1, 15.0, b"PATTY_'+'7_DONE");
        trace.input(InputStage::Written, 1, 16.0, b"PATTY_'+'7_DONE");
        let report = serde_json::to_value(trace).unwrap();
        assert_eq!(report["inputReceivedMarkers"], serde_json::json!({ "7": 12.0 }));
        assert_eq!(report["inputQueuedMarkers"], serde_json::json!({ "7": 13.0 }));
        assert_eq!(report["inputWriteMarkers"], serde_json::json!({ "7": 15.0 }));
        assert_eq!(report["inputWrittenMarkers"], serde_json::json!({ "7": 16.0 }));
        assert_eq!(report["markers"], serde_json::json!({}));
    }
}
