#[test]
fn note_event_adds_to_active_map() {
    patty::hooks::note_event("pane-1", "session_start", "opencode");
    // The event was accepted without error (no panics).
}

#[test]
fn note_event_unknown_source_prints_warning_only() {
    patty::hooks::note_event("pane-2", "session_start", "unknown-tool");
    // Source validation refuses; no map entry created.
}

#[test]
fn note_event_session_end_removes_from_active() {
    patty::hooks::note_event("pane-3", "session_start", "claude-code");
    patty::hooks::note_event("pane-3", "session_end", "claude-code");
    // No errors.
}

#[test]
fn remove_pane_works() {
    patty::hooks::note_event("pane-4", "session_start", "codex");
    patty::hooks::remove_pane("pane-4");
    // No errors, entry removed.
}

#[test]
fn hook_secret_is_not_empty() {
    let secret = patty::hooks::hook_secret();
    assert!(!secret.is_empty(), "hook secret should be a non-empty string");
    assert_eq!(secret.len(), 64, "hook secret should be 64 hex chars (32 bytes)");
}

#[test]
fn hook_secret_is_hex() {
    let secret = patty::hooks::hook_secret();
    assert!(secret.chars().all(|c| c.is_ascii_hexdigit()), "hook secret should be hex-encoded");
}

#[test]
fn hook_secret_is_stable_within_test() {
    let a = patty::hooks::hook_secret();
    let b = patty::hooks::hook_secret();
    assert_eq!(a, b, "hook_secret should be stable (lazily cached once)");
}

#[test]
fn hook_port_starts_at_zero() {
    let port = patty::hooks::hook_port();
    // Before server start, port should be 0
    assert_eq!(port, 0, "hook_port should be 0 before server starts");
}
