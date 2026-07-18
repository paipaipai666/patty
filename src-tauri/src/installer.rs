use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

const HOOK_MATCHER: &str = "permission_prompt|idle_prompt|elicitation_dialog";
const STOP_FAILURE_MATCHER: &str = "rate_limit|overloaded|authentication_failed|oauth_org_not_allowed|billing_error|invalid_request|model_not_found|server_error|max_output_tokens|unknown";

fn home_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn claude_settings_path() -> PathBuf {
    home_dir().join(".claude").join("settings.json")
}

fn codex_settings_path() -> PathBuf {
    home_dir().join(".codex").join("hooks.json")
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

fn opencode_plugin_source() -> PathBuf {
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

fn installed_hook_path() -> PathBuf {
    crate::store::data_dir().join("patty-hook.ps1")
}

fn ensure_hook_script_exists() -> PathBuf {
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

fn args_hook(matcher: &str, event_type: &str, hook_script_path: &str) -> Value {
    json!({
        "matcher": matcher,
        "hooks": [{
            "type": "command",
            "command": "powershell",
            "args": ["-ExecutionPolicy", "Bypass", "-File", hook_script_path, "-EventType", event_type]
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

fn is_patty_cmd_hook(n: &Value) -> bool {
    n.get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| hooks.iter().any(|h| command_contains(h, "patty-hook.ps1")))
}

fn is_patty_args_hook(n: &Value) -> bool {
    n.get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| {
            hooks.iter().any(|h| {
                command_contains(h, "powershell")
                    && h.get("args")
                        .and_then(Value::as_array)
                        .is_some_and(|args| args.iter().any(|a| a.as_str() == Some("-EventType")))
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
    let hook_command = format!("powershell -ExecutionPolicy Bypass -File \"{hook_script_path}\"");
    let obj = settings.as_object_mut().expect("settings object");
    let hooks = obj.entry("hooks".to_string()).or_insert_with(|| json!({}));
    let path = hook_script_path;

    upsert_hook(hooks, "Notification", cmd_hook(HOOK_MATCHER, hook_command.clone()), is_patty_cmd_hook);
    upsert_hook(hooks, "Stop", cmd_hook("", hook_command.clone()), is_patty_cmd_hook);
    upsert_hook(hooks, "StopFailure", cmd_hook(STOP_FAILURE_MATCHER, hook_command), is_patty_cmd_hook);
    upsert_hook(hooks, "SessionStart", args_hook("startup|resume", "session_start", path), is_patty_args_hook);
    upsert_hook(hooks, "SessionEnd", args_hook("", "session_end", path), is_patty_args_hook);
    upsert_hook(hooks, "PreToolUse", args_hook("", "pre_tool_use", path), is_patty_args_hook);
    upsert_hook(hooks, "PostToolUse", args_hook("", "post_tool_use", path), is_patty_args_hook);
    upsert_hook(hooks, "UserPromptSubmit", args_hook("", "user_prompt_submit", path), is_patty_args_hook);
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

fn install_at(settings_path: &PathBuf, apply: fn(&mut Value, &str), hook_script_path: &str, reset_on_corrupt: bool) {
    let mut settings = if settings_path.exists() {
        match fs::read_to_string(settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        {
            Some(s) => s,
            None if reset_on_corrupt => json!({}),
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

    if let Some(dir) = settings_path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(payload) = serde_json::to_string_pretty(&settings) {
        let _ = fs::write(settings_path, payload);
    }
}

// ── Public installers (gated by notification settings at the call site) ─────

pub fn ensure_claude_code_hook() {
    let hook_script = ensure_hook_script_exists();
    install_at(&claude_settings_path(), apply_claude_hooks, &hook_script.to_string_lossy(), false);
}

pub fn ensure_codex_hook() {
    let hook_script = ensure_hook_script_exists();
    install_at(&codex_settings_path(), apply_codex_hooks, &hook_script.to_string_lossy(), true);
}

pub fn ensure_opencode_plugin() {
    let source = opencode_plugin_source();
    let dest_dir = home_dir().join(".config").join("opencode").join("plugins");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_appends_then_replaces() {
        let mut hooks = json!({});
        let entry = cmd_hook("", "powershell -File \"X/patty-hook.ps1\"".into());
        upsert_hook(&mut hooks, "Stop", entry.clone(), is_patty_cmd_hook);
        assert_eq!(hooks["Stop"].as_array().unwrap().len(), 1);

        // An unrelated user hook is preserved; ours is replaced, not duplicated.
        hooks["Stop"].as_array_mut().unwrap().push(cmd_hook("", "echo hi".into()));
        let updated = cmd_hook("m", "powershell -File \"Y/patty-hook.ps1\"".into());
        upsert_hook(&mut hooks, "Stop", updated, is_patty_cmd_hook);
        let list = hooks["Stop"].as_array().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["matcher"], "m");
        assert_eq!(list[1]["hooks"][0]["command"], "echo hi");
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
        assert_eq!(
            settings["hooks"]["SessionStart"][0]["hooks"][0]["args"].as_array().unwrap().last().unwrap(),
            "session_start"
        );
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
        install_at(&file, apply_claude_hooks, "X/patty-hook.ps1", false);
        assert_eq!(fs::read_to_string(&file).unwrap(), "{corrupt");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_writes_end_to_end() {
        let dir = std::env::temp_dir().join(format!("patty-installer-e2e-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("hooks.json");
        install_at(&file, apply_codex_hooks, "X/patty-hook.ps1", true);
        let written: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert!(written["hooks"]["SessionStart"].is_array());
        let _ = fs::remove_dir_all(&dir);
    }
}
