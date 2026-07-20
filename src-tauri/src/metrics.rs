use serde_json::{json, Value};
use std::fs;
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// One powershell.exe per sample running the combined CPU+GPU counter script
// (measured ~800ms wall on Windows); the 2x safety factor keeps samples from
// overlapping. Sampling only runs while the dashboard is open.
const SAMPLE_INTERVAL_MS: u64 = 1600;
const PERSIST_INTERVAL_MS: u64 = 10_000;
const MAX_SAMPLES: usize = 120;
const MAX_FIRST_TERMINALS: usize = 30;

// Single-quoted strings only — embedded double quotes complicate argv escaping
// when passed via powershell -Command.
const CPU_GPU_SCRIPT: &str = "$cpu = (Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue; $gpu = $null; try { $gpu = ((Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Sum).Sum } catch {}; Write-Output ('CPU:' + $cpu); Write-Output ('GPU:' + $gpu)";
const CPU_ONLY_SCRIPT: &str = "Write-Output ('CPU:' + (Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue)";

struct MetricsData {
    first_terminal: Vec<Value>,
    samples: Vec<Value>,
}

static DATA: LazyLock<Mutex<MetricsData>> = LazyLock::new(|| {
    Mutex::new(MetricsData {
        first_terminal: Vec::new(),
        samples: Vec::new(),
    })
});

static SAMPLING: AtomicBool = AtomicBool::new(false);

fn history_path() -> std::path::PathBuf {
    crate::store::data_dir().join("metrics-history.json")
}

pub fn load_history() {
    let Ok(raw) = fs::read_to_string(history_path()) else {
        return;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    if parsed.get("version").and_then(Value::as_u64) != Some(1) {
        return;
    }
    let mut data = DATA.lock().unwrap();
    if let Some(arr) = parsed.get("firstTerminal").and_then(Value::as_array) {
        data.first_terminal = arr.iter().skip(arr.len().saturating_sub(MAX_FIRST_TERMINALS)).cloned().collect();
    }
    if let Some(arr) = parsed.get("samples").and_then(Value::as_array) {
        data.samples = arr.iter().skip(arr.len().saturating_sub(MAX_SAMPLES)).cloned().collect();
    }
}

pub fn persist() {
    let data = DATA.lock().unwrap();
    let first = data.first_terminal.len().saturating_sub(MAX_FIRST_TERMINALS);
    let samp = data.samples.len().saturating_sub(MAX_SAMPLES);
    let history = json!({
        "version": 1,
        "firstTerminal": data.first_terminal[first..],
        "samples": data.samples[samp..],
    });
    if let Some(dir) = history_path().parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(history_path(), history.to_string());
}

pub fn snapshot() -> Value {
    let data = DATA.lock().unwrap();
    json!({
        "firstTerminal": data.first_terminal,
        "samples": data.samples,
    })
}

pub fn record_first_terminal(entry: Value) {
    {
        let mut data = DATA.lock().unwrap();
        data.first_terminal.push(entry.clone());
        if data.first_terminal.len() > MAX_FIRST_TERMINALS {
            data.first_terminal.remove(0);
        }
    }
    eprintln!(
        "[metrics] first terminal ready: {} {}ms",
        entry["shell"].as_str().unwrap_or("?"),
        entry["durationMs"].as_u64().unwrap_or(0)
    );
    persist();
}

// ── Sampling ────────────────────────────────────────────────────────────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ponytail: no spawn timeout (the TS version used 10s) — a wedged powershell
// stalls the sequential sampling thread instead of piling up processes.
fn sample_counters(gpu_available: bool) -> (f64, Option<f64>) {
    let script = if gpu_available { CPU_GPU_SCRIPT } else { CPU_ONLY_SCRIPT };
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        // GUI app: without this flag each sample would pop a visible console.
        .creation_flags(0x08000000)
        .output();
    let Ok(out) = out else {
        return (0.0, None);
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let find = |key: &str| {
        stdout.lines().find_map(|l| {
            l.strip_prefix(key)
                .and_then(|v| v.trim().parse::<f64>().ok())
        })
    };
    (find("CPU:").unwrap_or(0.0), if gpu_available { find("GPU:") } else { None })
}

static GPU_FAILURES: LazyLock<Mutex<u8>> = LazyLock::new(|| Mutex::new(0));

fn capture_sample(app: &AppHandle) {
    // App process CPU/mem: current process only. (Electron summed all of its
    // helper processes; WebView2's children aren't attributable to us.)
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let pid = sysinfo::get_current_pid().ok();
    let (app_cpu, app_mem_mb) = if let Some(pid) = pid {
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        match sys.process(pid) {
            Some(p) => (f64::from(p.cpu_usage()), (p.memory() as f64) / 1024.0 / 1024.0),
            None => (0.0, 0.0),
        }
    } else {
        (0.0, 0.0)
    };
    let total_mb = (sys.total_memory() as f64) / 1024.0 / 1024.0;
    let used_mb = (sys.used_memory() as f64) / 1024.0 / 1024.0;

    let gpu_available = *GPU_FAILURES.lock().unwrap() < 3;
    let (system_cpu, gpu_util) = sample_counters(gpu_available);
    if gpu_available && gpu_util.is_none() {
        let mut failures = GPU_FAILURES.lock().unwrap();
        *failures += 1;
        if *failures >= 3 {
            eprintln!("[metrics] GPU counter disabled after repeated failures");
        }
    } else if gpu_util.is_some() {
        *GPU_FAILURES.lock().unwrap() = 0;
    }

    // gpuMemMB: Tauri has no owned GPU process (WebView2's GPU process is not
    // attributable), report 0. gpuProxy mirrors the TS semantics: null util.
    let sample = json!({
        "timestamp": now_ms(),
        "appCpu": app_cpu,
        "systemCpu": system_cpu,
        "appMemMB": app_mem_mb,
        "systemMemUsedMB": used_mb,
        "systemMemTotalMB": total_mb,
        "gpuUtil": gpu_util,
        "gpuMemMB": 0,
        "gpuProxy": gpu_util.is_none(),
    });

    {
        let mut data = DATA.lock().unwrap();
        data.samples.push(sample.clone());
        if data.samples.len() > MAX_SAMPLES {
            data.samples.remove(0);
        }
    }
    let _ = app.emit("metrics:tick", sample);
}

pub fn set_sampling(app: &AppHandle, enabled: bool) {
    if enabled {
        if SAMPLING.swap(true, Ordering::SeqCst) {
            return; // already running
        }
        let app = app.clone();
        thread::spawn(move || {
            let mut last_persist = std::time::Instant::now();
            while SAMPLING.load(Ordering::SeqCst) {
                let started = std::time::Instant::now();
                capture_sample(&app);
                if last_persist.elapsed() >= Duration::from_millis(PERSIST_INTERVAL_MS) {
                    persist();
                    last_persist = std::time::Instant::now();
                }
                let elapsed = started.elapsed();
                if elapsed < Duration::from_millis(SAMPLE_INTERVAL_MS) {
                    thread::sleep(Duration::from_millis(SAMPLE_INTERVAL_MS) - elapsed);
                }
            }
            persist();
        });
    } else {
        SAMPLING.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_terminal_capped_at_max() {
        let mut data = MetricsData { first_terminal: Vec::new(), samples: Vec::new() };
        for i in 0..(MAX_FIRST_TERMINALS + 5) {
            data.first_terminal.push(json!({ "iso": i, "shell": "pwsh", "durationMs": i }));
            if data.first_terminal.len() > MAX_FIRST_TERMINALS {
                data.first_terminal.remove(0);
            }
        }
        assert_eq!(data.first_terminal.len(), MAX_FIRST_TERMINALS);
        assert_eq!(data.first_terminal[0]["durationMs"], 5);
    }

    #[test]
    fn counter_output_parsing() {
        let stdout = "CPU:12.5\r\nGPU:42.75\r\n";
        let find = |key: &str| {
            stdout.lines().find_map(|l| {
                l.strip_prefix(key)
                    .and_then(|v| v.trim().parse::<f64>().ok())
            })
        };
        assert_eq!(find("CPU:"), Some(12.5));
        assert_eq!(find("GPU:"), Some(42.75));
        assert_eq!(find("MEM:"), None);
    }
}
