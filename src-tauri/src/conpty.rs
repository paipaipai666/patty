use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub(crate) const XTERM_REFLOW_COMPATIBILITY_BUILD: u32 = 21376;

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
    fn FreeLibrary(module: *mut c_void) -> i32;
}

fn runtime_directory(executable: &Path, resources: Option<&Path>) -> Result<PathBuf, String> {
    let mut directory = resources.or_else(|| executable.parent()).ok_or("Executable has no parent directory")?;
    if resources.is_none() && directory.file_name().is_some_and(|name| name == "deps") {
        directory = directory.parent().ok_or("Test executable has no profile directory")?;
    }
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "x86" => "x86",
        "aarch64" => "arm64",
        architecture => return Err(format!("Unsupported ConPTY architecture: {architecture}")),
    };
    Ok(directory.join("conpty").join(architecture))
}

fn load(directory: &Path) -> Result<(), String> {
    let library = directory.join("conpty.dll");
    if !library.is_file() || !directory.join("OpenConsole.exe").is_file() {
        return Err(format!("Independent ConPTY runtime is missing from {}. Run npm run prepare:conpty before building.", directory.display()));
    }
    let path: Vec<u16> = library.as_os_str().encode_wide().chain(Some(0)).collect();
    let module = unsafe { LoadLibraryExW(path.as_ptr(), std::ptr::null_mut(), 0x0000_0100 | 0x0000_0800) };
    if module.is_null() {
        return Err(format!("Cannot load {}: {}", library.display(), std::io::Error::last_os_error()));
    }
    for name in [
        b"CreatePseudoConsole\0".as_slice(),
        b"ResizePseudoConsole\0".as_slice(),
        b"ClosePseudoConsole\0".as_slice(),
        b"ConptyCreatePseudoConsole\0".as_slice(),
    ] {
        if unsafe { GetProcAddress(module, name.as_ptr()) }.is_null() {
            unsafe { FreeLibrary(module) };
            return Err(format!("{} does not provide the independent ConPTY API", library.display()));
        }
    }
    Ok(())
}

pub(crate) fn ensure() -> Result<(), String> {
    static LOADED: OnceLock<Result<(), String>> = OnceLock::new();
    LOADED.get_or_init(|| {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let resources = crate::pty::resource_dir();
        let resources = (!resources.as_os_str().is_empty()).then_some(resources.as_path());
        load(&runtime_directory(&executable, resources)?)
    }).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_runtime_is_loaded_before_spawning_a_terminal() {
        assert_eq!(ensure(), Ok(()));
    }

    #[test]
    fn test_executables_use_the_same_profile_runtime_as_the_app() {
        let app = runtime_directory(Path::new(r"C:\build\debug\patty.exe"), None).unwrap();
        let test = runtime_directory(Path::new(r"C:\build\debug\deps\patty-test.exe"), None).unwrap();
        assert_eq!(app, test);
    }

    #[test]
    fn installed_resource_directory_takes_precedence_over_cargo_layout() {
        let directory = runtime_directory(
            Path::new(r"C:\apps\deps\patty.exe"),
            Some(Path::new(r"C:\apps\deps")),
        ).unwrap();
        assert!(directory.starts_with(r"C:\apps\deps\conpty"));
    }

    #[test]
    fn missing_runtime_does_not_fall_back_to_the_system_backend() {
        let missing = std::env::temp_dir().join(format!("missing-conpty-{}", std::process::id()));
        assert!(load(&missing).unwrap_err().contains("Independent ConPTY runtime is missing"));
    }
}
