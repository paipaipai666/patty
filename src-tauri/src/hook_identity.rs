use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookOrigin {
    pub process_id: u32,
    pub sequence: u64,
    pub emitted_at: u64,
    pub instance_id: Option<String>,
    pub conversation_id: Option<String>,
    pub parent_conversation_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProcessKey {
    pub pid: u32,
    pub created: u64,
}

pub(crate) struct ProcessInfo {
    pub key: ProcessKey,
    pub parent: Option<u32>,
    pub name: String,
}

fn executable_matches(name: &str, source: &str) -> bool {
    let executable = name.to_ascii_lowercase();
    let native = match source {
        "claude-code" => "claude.exe",
        "codex" => "codex.exe",
        "qwen-code" => "qwen.exe",
        "copilot-cli" => "copilot.exe",
        "opencode" => "opencode.exe",
        "omp" => "omp.exe",
        _ => return false,
    };
    executable == native || executable == "node.exe" || executable == "bun.exe"
}

fn resolve_with(
    root: u32,
    mut caller: u32,
    source: &str,
    mut lookup: impl FnMut(u32) -> Option<ProcessInfo>,
) -> Option<ProcessKey> {
    let mut visited = HashSet::new();
    let mut actor = None;
    for _ in 0..64 {
        if !visited.insert(caller) {
            return None;
        }
        let process = lookup(caller)?;
        if caller == root {
            return actor;
        }
        if actor.is_none() && executable_matches(&process.name, source) {
            actor = Some(process.key);
        }
        caller = process.parent?;
    }
    None
}

#[repr(C)]
#[derive(Default)]
struct FileTime {
    low: u32,
    high: u32,
}

#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
    fn GetProcessTimes(
        handle: *mut std::ffi::c_void,
        created: *mut FileTime,
        exited: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
    fn WaitForSingleObject(handle: *mut std::ffi::c_void, milliseconds: u32) -> u32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}

pub(crate) fn process_key(pid: u32) -> Option<ProcessKey> {
    let handle = unsafe { OpenProcess(0x0010_1000, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut created = FileTime::default();
    let mut exited = FileTime::default();
    let mut kernel = FileTime::default();
    let mut user = FileTime::default();
    let success =
        unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) };
    let running = unsafe { WaitForSingleObject(handle, 0) } == 0x102;
    unsafe {
        CloseHandle(handle);
    }
    (success != 0 && running).then_some(ProcessKey {
        pid,
        created: (u64::from(created.high) << 32) | u64::from(created.low),
    })
}

pub(crate) fn resolve(root: ProcessKey, caller: u32, source: &str) -> Option<ProcessKey> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let mut system = System::new();
    resolve_with(root.pid, caller, source, |pid| {
        let key = process_key(pid)?;
        if pid == root.pid && key != root {
            return None;
        }
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
            true,
            ProcessRefreshKind::nothing(),
        );
        let process = system.process(Pid::from_u32(pid))?;
        Some(ProcessInfo {
            key,
            parent: process.parent().map(|pid| pid.as_u32()),
            name: process.name().to_string_lossy().into_owned(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: u32, parent: Option<u32>, name: &str) -> ProcessInfo {
        ProcessInfo {
            key: ProcessKey {
                pid,
                created: u64::from(pid) * 100,
            },
            parent,
            name: name.into(),
        }
    }

    #[test]
    fn resolves_the_cli_ancestor_inside_the_owning_terminal() {
        let actor = resolve_with(10, 40, "codex", |pid| match pid {
            40 => Some(process(40, Some(30), "powershell.exe")),
            30 => Some(process(30, Some(20), "cmd.exe")),
            20 => Some(process(20, Some(10), "codex.exe")),
            10 => Some(process(10, None, "powershell.exe")),
            _ => None,
        });
        assert_eq!(
            actor,
            Some(ProcessKey {
                pid: 20,
                created: 2000
            })
        );
    }

    #[test]
    fn rejects_unrelated_processes_cycles_and_missing_ancestors() {
        assert_eq!(
            resolve_with(10, 20, "opencode", |pid| Some(process(
                pid, None, "node.exe"
            ))),
            None
        );
        assert_eq!(
            resolve_with(10, 20, "opencode", |pid| Some(process(
                pid,
                Some(pid),
                "node.exe"
            ))),
            None
        );
        assert_eq!(resolve_with(10, 20, "opencode", |_| None), None);
        assert_eq!(
            resolve_with(10, 20, "opencode", |pid| Some(process(
                pid,
                Some(10),
                "unrelated.exe"
            ))),
            None
        );
    }

    #[test]
    fn resolves_a_node_adapter_in_its_own_process() {
        assert_eq!(
            resolve_with(10, 20, "omp", |pid| Some(process(
                pid,
                Some(10),
                "node.exe"
            ))),
            Some(ProcessKey {
                pid: 20,
                created: 2000
            })
        );
        assert!(!executable_matches("node.exe", "unknown"));
    }

    #[test]
    fn reads_a_stable_kernel_creation_identity() {
        let key = process_key(std::process::id()).unwrap();
        assert_eq!(key.pid, std::process::id());
        assert_ne!(key.created, 0);
        assert_eq!(process_key(key.pid), Some(key));
        assert_eq!(process_key(0), None);
    }

    #[test]
    fn resolves_a_real_node_child_without_reading_command_lines() {
        struct ChildGuard(std::process::Child);
        impl Drop for ChildGuard {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let child = ChildGuard(
            std::process::Command::new("node")
                .args(["-e", "setTimeout(() => {}, 10000)"])
                .spawn()
                .unwrap(),
        );
        let root = process_key(std::process::id()).unwrap();
        let actor = resolve(root, child.0.id(), "opencode").unwrap();
        assert_eq!(actor.pid, child.0.id());
        assert_eq!(Some(actor), process_key(child.0.id()));
        assert_eq!(
            resolve(ProcessKey { created: 1, ..root }, child.0.id(), "opencode"),
            None
        );
    }
}
