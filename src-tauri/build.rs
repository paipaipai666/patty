fn main() {
    let architecture = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "x86_64" => "x64",
        "x86" => "x86",
        "aarch64" => "arm64",
        architecture => panic!("Unsupported ConPTY architecture: {architecture}"),
    };
    let root = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let source = root.join("../resources/conpty").join(architecture);
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let profile = output.ancestors().nth(3).expect("Cargo profile directory");
    let destination = profile.join("conpty").join(architecture);
    std::fs::create_dir_all(&destination).expect("Create ConPTY runtime directory");
    println!("cargo:rerun-if-changed=../resources/conpty.lock.json");
    for name in ["conpty.dll", "OpenConsole.exe"] {
        let file = source.join(name);
        println!("cargo:rerun-if-changed={}", file.display());
        let contents = std::fs::read(&file).unwrap_or_else(|error| {
            panic!("Cannot read {}: {error}. Run npm run prepare:conpty before building.", file.display())
        });
        let target = destination.join(name);
        if std::fs::read(&target).ok().as_deref() != Some(contents.as_slice()) {
            std::fs::write(target, contents).expect("Stage ConPTY runtime");
        }
    }
    tauri_build::build()
}
