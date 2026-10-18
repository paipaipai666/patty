use serde_json::{json, Value};
use std::fs;
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};


const SAMPLE_INTERVAL_MS: u64 = 1600;
const PERSIST_INTERVAL_MS: u64 = 10_000;
const MAX_SAMPLES: usize = 120;
const MAX_FIRST_TERMINALS: usize = 30;


const CPU_QUERY: &str = "$cpu = $null; try { $cpu = (Get-Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue } catch {}; if ($null -eq $cpu) { try { $cpu = (Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\" -ErrorAction Stop).PercentProcessorTime } catch {} }; if ($null -ne $cpu) { Write-Output ('CPU:' + $cpu) }";
const GPU_QUERY: &str = "$gpu = $null; try { $gpu = ((Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Sum).Sum } catch {}; if ($null -eq $gpu) { try { $gpu = ((Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -like '*engtype_3D*' }) | Measure-Object -Property UtilizationPercentage -Sum).Sum } catch {} }; if ($null -ne $gpu) { Write-Output ('GPU:' + $gpu) }";

fn counter_script(gpu: bool) -> String {
    if gpu {
        format!("{CPU_QUERY}; {GPU_QUERY}")
    } else {
        CPU_QUERY.to_string()
    }
}

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
static SAMPLING_GEN: AtomicU64 = AtomicU64::new(0);
static LOOP_LOCK: Mutex<()> = Mutex::new(());
static SYS: LazyLock<Mutex<sysinfo::System>> = LazyLock::new(|| Mutex::new(sysinfo::System::new()));

fn history_path() -> std::path::PathBuf {
    crate::store::data_dir().join("metrics-history.json")
}

#[doc(hidden)]
pub fn reset_for_test() {
    *DATA.lock().unwrap() = MetricsData {
        first_terminal: Vec::new(),
        samples: Vec::new(),
    };
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
    let _ = crate::store::save_atomic_to(&history_path(), &history);
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



fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}


const SAMPLE_TIMEOUT: Duration = Duration::from_secs(10);

fn run_powershell(script: &str) -> Option<std::process::Output> {
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])

        .creation_flags(0x08000000)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + SAMPLE_TIMEOUT;
    loop {
        match child.try_wait() {

            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) if std::time::Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                eprintln!("[metrics] powershell sample timed out; killing");
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => return None,
        }
    }
}

fn sample_counters(gpu_available: bool) -> (f64, Option<f64>) {
    let Some(out) = run_powershell(&counter_script(gpu_available)) else {
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

fn local_usage() -> (f64, f64, f64, f64) {
    let mut sys = SYS.lock().unwrap();
    sys.refresh_memory();
    let Ok(pid) = sysinfo::get_current_pid() else {
        return (0.0, 0.0, 0.0, 0.0);
    };
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    let (app_cpu, app_mem_mb) = match sys.process(pid) {
        Some(p) => (f64::from(p.cpu_usage()), (p.memory() as f64) / 1024.0 / 1024.0),
        None => (0.0, 0.0),
    };
    let total_mb = (sys.total_memory() as f64) / 1024.0 / 1024.0;
    let used_mb = (sys.used_memory() as f64) / 1024.0 / 1024.0;
    (app_cpu, app_mem_mb, used_mb, total_mb)
}

fn capture_sample(app: &AppHandle) {
    let (app_cpu, app_mem_mb, used_mb, total_mb) = local_usage();

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
    if let Err(e) = app.emit("metrics:tick", sample) {
        eprintln!("[metrics] emit metrics:tick failed: {e}");
    }
}

fn begin_sampling() -> Option<u64> {
    if SAMPLING.swap(true, Ordering::SeqCst) {
        return None;
    }
    Some(SAMPLING_GEN.fetch_add(1, Ordering::SeqCst) + 1)
}

fn stop_sampling() {
    SAMPLING.store(false, Ordering::SeqCst);
    SAMPLING_GEN.fetch_add(1, Ordering::SeqCst);
}

fn sampling_active(gen: u64) -> bool {
    SAMPLING.load(Ordering::SeqCst) && SAMPLING_GEN.load(Ordering::SeqCst) == gen
}

fn interruptible_sleep(gen: u64, total: Duration) -> bool {
    let deadline = std::time::Instant::now() + total;
    loop {
        if !sampling_active(gen) {
            return false;
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return true;
        }
        thread::sleep(remaining.min(Duration::from_millis(50)));
    }
}

fn run_sampling_loop<F: FnMut()>(gen: u64, mut capture: F) {
    let _owner = LOOP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut last_persist = std::time::Instant::now();
    while sampling_active(gen) {
        let started = std::time::Instant::now();
        capture();
        if last_persist.elapsed() >= Duration::from_millis(PERSIST_INTERVAL_MS) {
            persist();
            last_persist = std::time::Instant::now();
        }
        let elapsed = started.elapsed();
        if elapsed < Duration::from_millis(SAMPLE_INTERVAL_MS)
            && !interruptible_sleep(gen, Duration::from_millis(SAMPLE_INTERVAL_MS) - elapsed)
        {
            break;
        }
    }
    persist();
}

pub fn set_sampling(app: &AppHandle, enabled: bool) {
    if enabled {
        let Some(gen) = begin_sampling() else {
            return;
        };
        let app = app.clone();
        thread::spawn(move || run_sampling_loop(gen, || capture_sample(&app)));
    } else {
        stop_sampling();
    }
}

#[cfg(test)]
mod tests {
    use super::*;


    static SERIAL: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn reset_data() {
        *DATA.lock().unwrap() = MetricsData {
            first_terminal: Vec::new(),
            samples: Vec::new(),
        };
    }

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

    #[test]
    fn snapshot_returns_empty_initial() {
        let _g = serial();
        reset_data();
        let s = snapshot();
        assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 0);
        assert_eq!(s["samples"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn record_first_terminal_adds_to_data() {
        let _g = serial();
        reset_data();
        let dir = std::env::temp_dir()
            .join(format!("patty-metrics-add-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let old = crate::store::data_dir();
        crate::store::set_data_dir_for_test(dir.clone());

        record_first_terminal(json!({"iso": "a", "shell": "pwsh", "durationMs": 100}));
        let s = snapshot();
        assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 1);
        assert_eq!(s["firstTerminal"][0]["shell"], "pwsh");

        crate::store::set_data_dir_for_test(old);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_first_terminal_trims_at_max() {
        let _g = serial();
        reset_data();
        let dir = std::env::temp_dir()
            .join(format!("patty-metrics-trim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let old = crate::store::data_dir();
        crate::store::set_data_dir_for_test(dir.clone());

        for i in 0..(MAX_FIRST_TERMINALS + 3) {
            record_first_terminal(json!({"iso": i, "shell": "pwsh", "durationMs": i}));
        }
        let s = snapshot();
        assert_eq!(s["firstTerminal"].as_array().unwrap().len(), MAX_FIRST_TERMINALS);
        assert_eq!(s["firstTerminal"][0]["durationMs"], 3);

        crate::store::set_data_dir_for_test(old);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn persist_and_load_history_roundtrip() {
        let _g = serial();
        reset_data();
        let dir = std::env::temp_dir()
            .join(format!("patty-metrics-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let old = crate::store::data_dir();
        crate::store::set_data_dir_for_test(dir.clone());

        record_first_terminal(json!({"shell": "pwsh", "durationMs": 42}));


        reset_data();
        assert!(snapshot()["firstTerminal"].as_array().unwrap().is_empty());

        load_history();
        let s = snapshot();
        assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 1);
        assert_eq!(s["firstTerminal"][0]["durationMs"], 42);

        crate::store::set_data_dir_for_test(old);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn persist_writes_valid_json() {
        let _g = serial();
        reset_data();
        let dir = std::env::temp_dir()
            .join(format!("patty-metrics-persist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let old = crate::store::data_dir();
        crate::store::set_data_dir_for_test(dir.clone());

        record_first_terminal(json!({"shell": "cmd", "durationMs": 10}));
        let path = history_path();
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["version"], 1);
        assert_eq!(parsed["firstTerminal"][0]["shell"], "cmd");

        crate::store::set_data_dir_for_test(old);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn busy_workers(count: usize) -> (std::sync::Arc<AtomicBool>, Vec<thread::JoinHandle<()>>) {
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let workers = (0..count)
            .map(|_| {
                let stop = stop.clone();
                thread::spawn(move || {
                    while !stop.load(Ordering::Relaxed) {
                        std::hint::spin_loop();
                    }
                })
            })
            .collect();
        (stop, workers)
    }

    fn stop_workers(stop: &AtomicBool, workers: Vec<thread::JoinHandle<()>>) {
        stop.store(true, Ordering::Relaxed);
        for worker in workers {
            let _ = worker.join();
        }
    }

    #[test]
    fn sampling_generation_supersedes_previous_loop() {
        let _g = serial();
        stop_sampling();
        let first = begin_sampling().expect("first enable starts a loop");
        assert!(sampling_active(first));
        assert!(
            begin_sampling().is_none(),
            "a second enable while running must not start another loop"
        );
        stop_sampling();
        assert!(!sampling_active(first));
        let second = begin_sampling().expect("enable after stop starts a loop");
        assert!(sampling_active(second));
        assert!(
            !sampling_active(first),
            "the superseded loop must see itself as inactive"
        );
        stop_sampling();
    }

    #[test]
    fn interruptible_sleep_returns_as_soon_as_sampling_stops() {
        let _g = serial();
        stop_sampling();
        let gen = begin_sampling().unwrap();
        let started = std::time::Instant::now();
        stop_sampling();
        assert!(!interruptible_sleep(gen, Duration::from_secs(30)));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn superseded_sampling_loop_exits() {
        let _g = serial();
        let dir = std::env::temp_dir()
            .join(format!("patty-metrics-loop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let old = crate::store::data_dir();
        crate::store::set_data_dir_for_test(dir.clone());

        stop_sampling();
        let gen = begin_sampling().unwrap();
        let ticks = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = ticks.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            run_sampling_loop(gen, move || {
                seen.fetch_add(1, Ordering::SeqCst);
            });
            let _ = tx.send(());
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while ticks.load(Ordering::SeqCst) == 0 && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(ticks.load(Ordering::SeqCst) > 0, "an active loop must sample");
        stop_sampling();
        let restarted = begin_sampling().expect("a re-enable after a stop starts a loop");
        assert!(sampling_active(restarted));
        assert!(
            rx.recv_timeout(Duration::from_secs(10)).is_ok(),
            "a superseded sampling loop must exit"
        );
        let _ = worker.join();
        stop_sampling();

        crate::store::set_data_dir_for_test(old);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn re_enable_does_not_overlap_the_retiring_loop() {
        let _g = serial();
        stop_sampling();
        let gen = begin_sampling().unwrap();
        let ticks = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = ticks.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            run_sampling_loop(gen, move || {
                seen.fetch_add(1, Ordering::SeqCst);
            });
            let _ = tx.send(());
        });

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while ticks.load(Ordering::SeqCst) == 0 && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        let before = ticks.load(Ordering::SeqCst);
        assert!(before > 0, "the first loop must sample");

        stop_sampling();
        let restarted = begin_sampling().expect("a re-enable after a stop starts a loop");
        thread::sleep(Duration::from_millis(400));
        assert_eq!(
            ticks.load(Ordering::SeqCst),
            before,
            "the retiring loop must stop sampling once a newer loop owns the toggle",
        );
        assert!(sampling_active(restarted));

        let _ = rx.recv_timeout(Duration::from_secs(10));
        let _ = worker.join();

        let after = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = after.clone();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let fresh = thread::spawn(move || {
            run_sampling_loop(restarted, move || {
                seen.fetch_add(1, Ordering::SeqCst);
            });
            let _ = done_tx.send(());
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while after.load(Ordering::SeqCst) == 0 && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            after.load(Ordering::SeqCst) > 0,
            "the retired loop must release the sampling lock so a fresh loop can run",
        );
        stop_sampling();
        let _ = done_rx.recv_timeout(Duration::from_secs(10));
        let _ = fresh.join();
    }

    #[test]
    fn local_usage_reports_process_activity() {
        let _g = serial();
        let (stop, workers) = busy_workers(2);
        let _ = local_usage();
        thread::sleep(Duration::from_millis(400));
        let (app_cpu, app_mem_mb, used_mb, total_mb) = local_usage();
        stop_workers(&stop, workers);
        assert!(
            app_cpu > 0.0,
            "a busy process must report nonzero cpu usage, got {app_cpu}"
        );
        assert!(app_mem_mb > 0.0, "app memory must be reported, got {app_mem_mb}");
        assert!(
            used_mb > 0.0 && total_mb > 0.0,
            "system memory must be reported, got {used_mb}/{total_mb}"
        );
    }

    #[test]
    fn system_counters_report_load_on_this_machine() {
        let _g = serial();
        let (stop, workers) = busy_workers(3);
        thread::sleep(Duration::from_millis(800));
        let (system_cpu, _gpu) = sample_counters(true);
        stop_workers(&stop, workers);
        assert!(
            system_cpu > 0.0,
            "expected a nonzero system cpu reading from powershell counters, got {system_cpu}"
        );
    }

    #[test]
    fn load_history_ignores_wrong_version() {
        let _g = serial();
        reset_data();
        let dir = std::env::temp_dir()
            .join(format!("patty-metrics-version-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let old = crate::store::data_dir();
        crate::store::set_data_dir_for_test(dir.clone());

        let path = history_path();
        std::fs::write(&path, r#"{"version":999,"firstTerminal":[{"shell":"pwsh","durationMs":1}]}"#).unwrap();
        load_history();
        let s = snapshot();
        assert_eq!(s["firstTerminal"].as_array().unwrap().len(), 0);

        crate::store::set_data_dir_for_test(old);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
