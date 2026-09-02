use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

const HOOK_MATCHER: &str = "permission_prompt|idle_prompt|elicitation_dialog";
const STOP_FAILURE_MATCHER: &str = "rate_limit|overloaded|authentication_failed|oauth_org_not_allowed|billing_error|invalid_request|model_not_found|server_error|max_output_tokens|unknown";

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
        // Never fall back to ".": a missing home dir means the user's config
        // location is unknowable, and writing into the process CWD would plant
        // hooks in a random repository (REVIEW.md P2).
        .filter(|p| !p.as_os_str().is_empty())
}

pub fn claude_settings_path() -> Option<PathBuf> {
    // Hooks must live in the user-level settings.json: Claude Code's
    // localSettings source only reads <project>/.claude/settings.local.json —
    // a user-level ~/.claude/settings.local.json is never loaded, so hooks
    // installed there silently never fire.
    home_dir().map(|h| h.join(".claude").join("settings.json"))
}

fn claude_legacy_local_settings_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("settings.local.json"))
}

pub fn codex_settings_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".codex").join("hooks.json"))
}

fn hook_script_source() -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("patty-hook.ps1");
    if dev.exists() {
        return dev;
    }
    crate::pty::resource_dir()
        .join("resources")
        .join("patty-hook.ps1")
}

pub fn opencode_plugin_source() -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("opencode-patty-plugin.ts");
    if dev.exists() {
        return dev;
    }
    crate::pty::resource_dir()
        .join("resources")
        .join("opencode-patty-plugin.ts")
}

pub fn omp_hook_source() -> PathBuf {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("omp-patty-hook.ts");
    if dev.exists() {
        return dev;
    }
    crate::pty::resource_dir()
        .join("resources")
        .join("omp-patty-hook.ts")
}

pub fn installed_hook_path() -> PathBuf {
    crate::store::data_dir().join("patty-hook.ps1")
}

pub fn ensure_hook_script_exists() -> PathBuf {
    let dest = installed_hook_path();
    if let Some(dir) = dest.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let source = hook_script_source();
    if source.exists() {
        let _ = fs::copy(&source, &dest);
    }
    dest
}

// ── Hook entry builders ─────────────────────────────────────────────────────

fn cmd_hook(matcher: &str, command: String) -> Value {
    json!({
        "matcher": matcher,
        "hooks": [{ "type": "command", "command": command }]
    })
}

// Test-only helper for the legacy exec/args hook form, kept so tests can
// verify that old args-form installs are still matched and replaced.
#[cfg(test)]
fn args_hook(matcher: &str, extra_args: &[&str], hook_script_path: &str) -> Value {
    let mut args = vec![
        json!("-ExecutionPolicy"),
        json!("Bypass"),
        json!("-File"),
        json!(hook_script_path),
    ];
    args.extend(extra_args.iter().map(|a| json!(a)));
    json!({
        "matcher": matcher,
        "hooks": [{
            "type": "command",
            "command": "powershell",
            "args": args
        }]
    })
}

// Replace an existing Patty-matching hook entry or append a new one.
fn upsert_hook(hooks: &mut Value, key: &str, entry: Value, is_patty: fn(&Value) -> bool) {
    let list = hooks
        .as_object_mut()
        .expect("hooks object")
        .entry(key.to_string())
        .or_insert_with(|| json!([]));
    let arr = list.as_array_mut().expect("hook list is an array");
    if let Some(idx) = arr.iter().position(is_patty) {
        arr[idx] = entry;
    } else {
        arr.push(entry);
    }
}

fn command_contains(h: &Value, needle: &str) -> bool {
    h.get("command")
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(needle))
}

// Unified Patty-entry predicate: matches both the shell form (full command
// string containing the script path) and the legacy 2.0.x args form (script
// path inside the args array), so old installs are replaced in place instead
// of duplicated on upgrade.
fn is_patty_hook(n: &Value) -> bool {
    n.get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| {
            hooks.iter().any(|h| {
                command_contains(h, "patty-hook.ps1")
                    || h
                        .get("args")
                        .and_then(Value::as_array)
                        .is_some_and(|args| {
                            args.iter().any(|a| {
                                a.as_str().is_some_and(|s| s.contains("patty-hook.ps1"))
                            })
                        })
            })
        })
}

fn is_patty_codex_hook(n: &Value) -> bool {
    n.get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| {
            hooks.iter().any(|h| {
                command_contains(h, "patty-hook.ps1") && command_contains(h, "-Source \"codex\"")
            })
        })
}

fn apply_claude_hooks(settings: &mut Value, hook_script_path: &str) {
    let obj = settings.as_object_mut().expect("settings object");
    let hooks = obj.entry("hooks".to_string()).or_insert_with(|| json!({}));
    // Shell form (same shape as the codex hooks) — verified end-to-end; the
    // exec/args form was never proven to spawn in the user's environment.
    let base = format!("powershell -ExecutionPolicy Bypass -File \"{hook_script_path}\"");
    let with_event = |event: &str| format!("{base} -EventType {event}");

    upsert_hook(hooks, "Notification", cmd_hook(HOOK_MATCHER, base.clone()), is_patty_hook);
    upsert_hook(hooks, "Stop", cmd_hook("", base.clone()), is_patty_hook);
    upsert_hook(hooks, "StopFailure", cmd_hook(STOP_FAILURE_MATCHER, base.clone()), is_patty_hook);
    upsert_hook(hooks, "SessionStart", cmd_hook("startup|resume", with_event("session_start")), is_patty_hook);
    upsert_hook(hooks, "SessionEnd", cmd_hook("", with_event("session_end")), is_patty_hook);
    upsert_hook(hooks, "PreToolUse", cmd_hook("", with_event("pre_tool_use")), is_patty_hook);
    upsert_hook(hooks, "PostToolUse", cmd_hook("", with_event("post_tool_use")), is_patty_hook);
    upsert_hook(hooks, "UserPromptSubmit", cmd_hook("", with_event("user_prompt_submit")), is_patty_hook);
}

fn apply_codex_hooks(settings: &mut Value, hook_script_path: &str) {
    let hook_command = format!("powershell -ExecutionPolicy Bypass -File \"{hook_script_path}\" -Source \"codex\"");
    let obj = settings.as_object_mut().expect("settings object");
    let hooks = obj.entry("hooks".to_string()).or_insert_with(|| json!({}));

    upsert_hook(hooks, "SessionStart", cmd_hook("startup|resume", hook_command.clone()), is_patty_codex_hook);
    upsert_hook(hooks, "PermissionRequest", cmd_hook("", hook_command.clone()), is_patty_codex_hook);
    upsert_hook(hooks, "Stop", cmd_hook("", hook_command.clone()), is_patty_codex_hook);
    upsert_hook(hooks, "PreToolUse", cmd_hook("", hook_command.clone()), is_patty_codex_hook);
    upsert_hook(hooks, "PostToolUse", cmd_hook("", hook_command.clone()), is_patty_codex_hook);
    upsert_hook(hooks, "UserPromptSubmit", cmd_hook("", hook_command), is_patty_codex_hook);
}

fn install_at(settings_path: &PathBuf, apply: fn(&mut Value, &str), hook_script_path: &str) {
    let mut settings = if settings_path.exists() {
        match fs::read_to_string(settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        {
            Some(s) => s,
            None => {
                // Leave the file untouched rather than wiping the user's
                // theme/model/permissions/other hooks on the next install.
                eprintln!("[installer] failed to parse, leaving untouched: {}", settings_path.display());
                return;
            }
        }
    } else {
        json!({})
    };

    apply(&mut settings, hook_script_path);

    // Atomic tmp+rename: these are the user's own config files (claude
    // settings.json, codex hooks.json) — a direct fs::write truncates first,
    // so a crash mid-write would destroy them.
    if let Err(e) = crate::store::save_atomic_to(settings_path, &settings) {
        eprintln!("[installer] failed to write {}: {e}", settings_path.display());
    }
}

// ── Public installers (gated by notification settings at the call site) ─────

pub fn ensure_claude_code_hook() {
    let Some(settings_path) = claude_settings_path() else {
        eprintln!("[installer] no home directory (USERPROFILE/HOME unset) — skipping claude hook install");
        return;
    };
    let hook_script = ensure_hook_script_exists();
    // Drop Patty entries from settings.local.json (the broken 2.0.x install
    // location that Claude never reads) so stale copies can't confuse anyone.
    if let Some(legacy) = claude_legacy_local_settings_path() {
        strip_patty_hooks(&legacy);
    }
    install_at(&settings_path, apply_claude_hooks, &hook_script.to_string_lossy());
}

/// Remove Patty-managed hook entries from a settings file, leaving all other
/// entries (user hooks, rtk hooks) untouched. Writes only when something
/// actually changed.
fn strip_patty_hooks(path: &PathBuf) {
    let Ok(raw) = fs::read_to_string(path) else { return };
    let Ok(mut settings) = serde_json::from_str::<Value>(&raw) else { return };
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else { return };
    let mut changed = false;
    for list in hooks.values_mut() {
        if let Some(arr) = list.as_array_mut() {
            let before = arr.len();
            arr.retain(|h| !is_patty_hook(h));
            changed |= arr.len() != before;
        }
    }
    if changed {
        if let Err(e) = crate::store::save_atomic_to(path, &settings) {
            eprintln!("[installer] failed to write {}: {e}", path.display());
        }
    }
}

pub fn ensure_codex_hook() {
    let Some(settings_path) = codex_settings_path() else {
        eprintln!("[installer] no home directory (USERPROFILE/HOME unset) — skipping codex hook install");
        return;
    };
    let hook_script = ensure_hook_script_exists();
    install_at(&settings_path, apply_codex_hooks, &hook_script.to_string_lossy());
}

/// Remove Patty's hook entries from the Claude settings files (both the live
/// settings.json and the legacy settings.local.json), leaving the user's own
/// hooks untouched. No-op when absent or unparseable.
pub fn remove_claude_code_hook() {
    if let Some(p) = claude_settings_path() {
        strip_patty_hooks(&p);
    }
    if let Some(p) = claude_legacy_local_settings_path() {
        strip_patty_hooks(&p);
    }
}

pub fn remove_codex_hook() {
    if let Some(p) = codex_settings_path() {
        strip_patty_hooks(&p);
    }
}

fn remove_file_if_present(path: PathBuf, what: &str) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("[installer] remove {what}: {e}"),
    }
}

pub fn remove_opencode_plugin() {
    if let Some(home) = home_dir() {
        remove_file_if_present(
            home.join(".config").join("opencode").join("plugins").join("patty-notifier.ts"),
            "opencode plugin",
        );
    }
}

pub fn remove_omp_hook() {
    if let Some(home) = home_dir() {
        remove_file_if_present(
            home.join(".omp").join("agent").join("extensions").join("patty-notifier.ts"),
            "omp hook",
        );
    }
}

/// Sync external AI-tool hook installations with the notifications settings:
/// enabled tools get the hook ensured, disabled tools get it REMOVED — a
/// toggle-off must not leave residue that keeps spawning the hook script on
/// every AI tool event (REVIEW.md P1-10).
pub fn sync_notification_tools(settings: &Value) {
    let on = |key: &str| settings["notifications"][key].as_bool().unwrap_or(true);
    if on("claudeCode") { ensure_claude_code_hook() } else { remove_claude_code_hook() }
    if on("openCode") { ensure_opencode_plugin() } else { remove_opencode_plugin() }
    if on("codex") { ensure_codex_hook() } else { remove_codex_hook() }
    if on("ohMyPi") { ensure_omp_hook() } else { remove_omp_hook() }
}

pub fn ensure_opencode_plugin() {
    let Some(home) = home_dir() else {
        eprintln!("[installer] no home directory (USERPROFILE/HOME unset) — skipping opencode plugin install");
        return;
    };
    let source = opencode_plugin_source();
    let dest_dir = home.join(".config").join("opencode").join("plugins");
    let dest = dest_dir.join("patty-notifier.ts");
    if let Err(e) = fs::create_dir_all(&dest_dir) {
        eprintln!("[installer] opencode plugin dir: {e}");
        return;
    }
    if source.exists() {
        if let Err(e) = fs::copy(&source, &dest) {
            eprintln!("[installer] opencode plugin copy: {e}");
        }
    } else {
        eprintln!("[installer] opencode plugin source not found: {}", source.display());
    }
}

pub fn ensure_omp_hook() {
    let source = omp_hook_source();
    // Install target is the extensions dir, NOT hooks/: hook-factory discovery
    // exposes only the legacy HookAPI, which lacks session_stop,
    // tool_approval_requested and ctx.setInterval.
    let Some(home) = home_dir() else {
        eprintln!("[installer] no home directory (USERPROFILE/HOME unset) — skipping omp hook install");
        return;
    };
    let dest_dir = home.join(".omp").join("agent").join("extensions");
    let dest = dest_dir.join("patty-notifier.ts");
    if let Err(e) = fs::create_dir_all(&dest_dir) {
        eprintln!("[installer] omp extensions dir: {e}");
        return;
    }
    if source.exists() {
        if let Err(e) = fs::copy(&source, &dest) {
            eprintln!("[installer] omp hook copy: {e}");
        }
    } else {
        eprintln!("[installer] omp hook source not found: {}", source.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_appends_then_replaces() {
        let mut hooks = json!({});
        let entry = cmd_hook("", "powershell -File \"X/patty-hook.ps1\"".into());
        upsert_hook(&mut hooks, "Stop", entry.clone(), is_patty_hook);
        assert_eq!(hooks["Stop"].as_array().unwrap().len(), 1);

        // An unrelated user hook is preserved; ours is replaced, not duplicated.
        hooks["Stop"].as_array_mut().unwrap().push(cmd_hook("", "echo hi".into()));
        let updated = cmd_hook("m", "powershell -File \"Y/patty-hook.ps1\"".into());
        upsert_hook(&mut hooks, "Stop", updated, is_patty_hook);
        let list = hooks["Stop"].as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["matcher"], "m");
        assert_eq!(list[1]["hooks"][0]["command"], "echo hi");
    }

    #[test]
    fn upsert_replaces_legacy_args_form_entry() {
        // 2.0.x installs used the exec/args form; the unified predicate must
        // still match it so upgrades replace in place instead of duplicating.
        let mut hooks = json!({});
        hooks["Stop"] = json!([args_hook("", &[], "X/patty-hook.ps1")]);
        upsert_hook(&mut hooks, "Stop", cmd_hook("", "powershell -File \"X/patty-hook.ps1\"".into()), is_patty_hook);
        let list = hooks["Stop"].as_array().unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0]["hooks"][0]["command"].as_str().unwrap().contains("patty-hook.ps1"));
    }

    #[test]
    fn claude_apply_builds_all_keys() {
        let mut settings = json!({ "model": "opus" });
        apply_claude_hooks(&mut settings, "C:/Patty/patty-hook.ps1");
        for key in ["Notification", "Stop", "StopFailure", "SessionStart", "SessionEnd", "PreToolUse", "PostToolUse", "UserPromptSubmit"] {
            assert!(settings["hooks"].get(key).is_some(), "missing {key}");
        }
        assert_eq!(settings["model"], "opus");
        assert_eq!(settings["hooks"]["Notification"][0]["matcher"], HOOK_MATCHER);
        // All claude hooks use the shell form (full command string).
        let cmd = settings["hooks"]["SessionStart"][0]["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.starts_with("powershell -ExecutionPolicy Bypass -File "));
        assert!(cmd.contains("patty-hook.ps1"));
        assert!(cmd.ends_with("-EventType session_start"));
        assert!(settings["hooks"]["SessionStart"][0]["hooks"][0].get("args").is_none());
        // Events parsed from stdin carry no -EventType argument.
        let stop = settings["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
        assert!(!stop.contains("-EventType"));
    }

    #[test]
    fn codex_apply_builds_all_keys_with_source() {
        let mut settings = json!({});
        apply_codex_hooks(&mut settings, "C:/Patty/patty-hook.ps1");
        for key in ["SessionStart", "PermissionRequest", "Stop", "PreToolUse", "PostToolUse", "UserPromptSubmit"] {
            assert!(settings["hooks"].get(key).is_some(), "missing {key}");
        }
        assert!(settings["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("-Source \"codex\""));
    }

    #[test]
    fn install_leaves_corrupt_claude_settings_untouched() {
        let dir = std::env::temp_dir().join(format!("patty-installer-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        fs::write(&file, "{corrupt").unwrap();
        install_at(&file, apply_claude_hooks, "X/patty-hook.ps1");
        assert_eq!(fs::read_to_string(&file).unwrap(), "{corrupt");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_removes_only_patty_hooks() {
        let dir = std::env::temp_dir().join(format!("patty-strip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        let patty_cmd = cmd_hook("", "powershell -File \"X/patty-hook.ps1\"".into());
        let patty_args = args_hook("", &["-EventType", "session_start"], "X/patty-hook.ps1");
        let other = cmd_hook("Bash", "rtk hook claude".into());
        fs::write(
            &file,
            serde_json::to_string(&json!({
                "hooks": { "Stop": [patty_cmd, other], "SessionStart": [patty_args] }
            }))
            .unwrap(),
        )
        .unwrap();
        strip_patty_hooks(&file);
        let written: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(written["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert_eq!(written["hooks"]["Stop"][0]["hooks"][0]["command"], "rtk hook claude");
        assert_eq!(written["hooks"]["SessionStart"].as_array().unwrap().len(), 0);
        // No Patty entries left: second call must not rewrite the file.
        strip_patty_hooks(&file);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_patty_codex_hook_matches() {
        let entry = cmd_hook("startup|resume", "powershell -File \"C:/patty-hook.ps1\" -Source \"codex\"".into());
        assert!(is_patty_codex_hook(&entry));
    }

    #[test]
    fn is_patty_codex_hook_rejects_non_codex_hook() {
        let entry = args_hook("", &["-Source", "claude-code"], "C:/patty-hook.ps1");
        assert!(!is_patty_codex_hook(&entry));
    }

    #[test]
    fn is_patty_hook_matches_cmd_form() {
        let entry = cmd_hook("", "powershell -File \"C:/patty-hook.ps1\" -Source codex".into());
        assert!(is_patty_hook(&entry));
    }

    #[test]
    fn is_patty_hook_matches_args_form() {
        let entry = args_hook("", &["-Source", "claude-code"], "C:/patty-hook.ps1");
        assert!(is_patty_hook(&entry));
    }

    #[test]
    fn is_patty_hook_rejects_non_patty() {
        let entry = cmd_hook("", "rtk hook claude".into());
        assert!(!is_patty_hook(&entry));
    }

    #[test]
    fn home_dir_is_none_without_env() {
        // Unset USERPROFILE and HOME: no fallback to "." — writing hooks into
        // the process CWD is worse than skipping the install.
        let old_u = std::env::var("USERPROFILE").ok();
        let old_h = std::env::var("HOME").ok();
        std::env::remove_var("USERPROFILE");
        std::env::remove_var("HOME");
        assert!(home_dir().is_none());
        assert!(claude_settings_path().is_none());
        if let Some(v) = old_u { std::env::set_var("USERPROFILE", v); }
        if let Some(v) = old_h { std::env::set_var("HOME", v); }
    }

    #[test]
    fn claude_settings_path_ends_in_user_settings() {
        let path = claude_settings_path().unwrap();
        assert_eq!(path.file_name().unwrap(), "settings.json");
        assert!(path.to_string_lossy().contains(".claude"));
    }

    #[test]
    fn codex_settings_path_ends_in_hooks_json() {
        let path = codex_settings_path().unwrap();
        assert_eq!(path.file_name().unwrap(), "hooks.json");
        assert!(path.to_string_lossy().contains(".codex"));
    }

    #[test]
    fn claude_hooks_install_to_user_settings() {
        // Regression guard: Claude Code's localSettings source only reads
        // <project>/.claude/settings.local.json — a user-level
        // settings.local.json is never loaded, so hooks there never fire.
        assert_eq!(
            claude_settings_path().unwrap().file_name().unwrap(),
            "settings.json"
        );
    }

    #[test]
    fn hook_clients_authenticate_with_secret() {
        // Regression guard: the hook server 401s any POST without the
        // per-process secret. Both hook clients must send it — the opencode
        // plugin shipped without it once and every event was silently dropped.
        let plugin = fs::read_to_string(opencode_plugin_source()).unwrap();
        assert!(plugin.contains("PATTY_HOOK_SECRET"), "opencode plugin must send the hook secret");
        let ps1 = fs::read_to_string(hook_script_source()).unwrap();
        assert!(ps1.contains("PATTY_HOOK_SECRET"), "patty-hook.ps1 must send the hook secret");
    }

    #[test]
    fn install_writes_end_to_end() {
        let dir = std::env::temp_dir().join(format!("patty-installer-e2e-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("hooks.json");
        install_at(&file, apply_codex_hooks, "X/patty-hook.ps1");
        let written: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert!(written["hooks"]["SessionStart"].is_array());
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn install_codex_preserves_corrupt_settings() {
        // REVIEW.md P0-3 regression guard: codex installs used to pass
        // reset_on_corrupt=true, silently resetting an unparseable
        // ~/.codex/hooks.json to {} and rewriting it with only Patty hooks —
        // destroying whatever the file contained. install_at no longer has a
        // reset path at all: corrupt files are always left untouched (same as
        // the claude case pinned by install_leaves_corrupt_claude_settings_untouched).
        let dir = std::env::temp_dir().join(format!("patty-installer-corrupt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hooks.json");
        let original = "{corrupt json — user content here";
        fs::write(&file, original).unwrap();
        install_at(&file, apply_codex_hooks, "X/patty-hook.ps1");
        assert_eq!(fs::read_to_string(&file).unwrap(), original);
        let _ = fs::remove_dir_all(&dir);
    }
}
