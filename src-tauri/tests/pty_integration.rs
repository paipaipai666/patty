use patty::pty::DsrState;

#[test]
fn shell_spawn_args_for_cmd_uses_integration_script() {
    let args = patty::pty::shell_spawn_args("cmd.exe");
    assert!(!args.is_empty(), "cmd.exe should have spawn args");
    assert_eq!(args[0], "/k", "cmd should use /k to run script");
    assert!(args[1].contains("cmd-prompt.cmd"), "should reference integration script: {}", args[1]);
}

#[test]
fn shell_spawn_args_for_powershell() {
    let args = patty::pty::shell_spawn_args("powershell");
    assert!(!args.is_empty());
    let joined = args.join(" ");
    assert!(joined.contains("-NoLogo"), "powershell args should include -NoLogo: {joined}");
    assert!(joined.contains("-Command"), "powershell args should include -Command: {joined}");
}

#[test]
fn shell_spawn_args_for_pwsh() {
    let args = patty::pty::shell_spawn_args("pwsh");
    assert!(!args.is_empty());
    let joined = args.join(" ");
    assert!(joined.contains("-NoLogo"), "pwsh args should include -NoLogo: {joined}");
}

#[test]
fn shell_spawn_args_for_bash() {
    let args = patty::pty::shell_spawn_args("bash");
    assert!(args.is_empty(), "bash should return no spawn args");
}

#[test]
fn decode_handles_ascii() {
    let mut carry = Vec::new();
    let s = patty::pty::decode(&mut carry, b"hello");
    assert_eq!(s, "hello");
    assert!(carry.is_empty());
}

#[test]
fn decode_handles_multi_byte_char() {
    let mut carry = Vec::new();
    let utf8_bytes = "日本語".as_bytes();
    let s = patty::pty::decode(&mut carry, utf8_bytes);
    assert_eq!(s, "日本語");
    assert!(carry.is_empty());
}

#[test]
fn decode_preserves_emoji() {
    let mut carry = Vec::new();
    let s = patty::pty::decode(&mut carry, "🚀🔬".as_bytes());
    assert_eq!(s, "🚀🔬");
    assert!(carry.is_empty());
}

#[test]
fn decode_buffers_incomplete_sequence() {
    let mut carry = Vec::new();
    let _s = patty::pty::decode(&mut carry, b"\xe3\x80");
    assert!(!carry.is_empty(), "carry should hold incomplete bytes");
    let s2 = patty::pty::decode(&mut carry, b"\x80");
    assert_eq!(s2, "\u{3000}", "should complete the ideographic space");
    assert!(carry.is_empty());
}

#[test]
fn decode_buffers_and_returns_trailing_text() {
    let mut carry = Vec::new();
    let s1 = patty::pty::decode(&mut carry, b"\xe3\x80");
    assert_eq!(s1, "");
    assert!(!carry.is_empty());
    let s2 = patty::pty::decode(&mut carry, b"\x80hello!");
    assert_eq!(s2, "\u{3000}hello!");
    assert!(carry.is_empty());
}

#[test]
fn decode_handles_mixed_ascii_and_utf8() {
    let mut carry = Vec::new();
    let bytes = "a \u{00e9} \u{2603} b".as_bytes();
    let s = patty::pty::decode(&mut carry, bytes);
    assert_eq!(s, "a é ☃ b");
    assert!(carry.is_empty());
}

#[test]
fn dsr_filter_initial_state_pending_returns_none() {
    let mut state = DsrState::Pending(String::new());
    let (parsed, matched) = patty::pty::dsr_filter(&mut state, "");
    assert_eq!(parsed, None);
    assert!(!matched);
}

#[test]
fn dsr_filter_captures_text_after_dsr_query() {
    let mut state = DsrState::Pending(String::new());
    let (parsed, matched) = patty::pty::dsr_filter(&mut state, "\x1b[6nresponse");
    assert!(matched, "should match DSR query");
    assert_eq!(parsed, Some("response".to_string()));
}

#[test]
fn dsr_filter_non_query_at_start_passes_through() {
    let mut state = DsrState::Pending(String::new());
    let (parsed, matched) = patty::pty::dsr_filter(&mut state, "before\x1b[6nafter");
    assert!(!matched, "DSR query is only detected at start of chunk");
    assert!(parsed.is_some());
}

#[test]
fn dsr_filter_done_state_passes_through() {
    let mut state = DsrState::Done;
    let (parsed, matched) = patty::pty::dsr_filter(&mut state, "anything");
    assert_eq!(parsed, Some("anything".to_string()));
    assert!(!matched);
}

#[test]
fn dsr_filter_pending_partial_dsr_query() {
    let mut state = DsrState::Pending(String::new());
    let (parsed, matched) = patty::pty::dsr_filter(&mut state, "\x1b[6");
    assert_eq!(parsed, None);
    assert!(!matched);
}

#[test]
fn dsr_filter_no_dsr_in_text() {
    let mut state = DsrState::Pending(String::new());
    let (parsed, matched) = patty::pty::dsr_filter(&mut state, "just plain text");
    assert!(!matched);
    assert_eq!(parsed, Some("just plain text".to_string()));
}

#[test]
fn leaf_session_ids_flat_tree() {
    let tree = serde_json::json!({
        "type": "leaf",
        "sessionId": "s1"
    });
    let ids = patty::pty::leaf_session_ids(&tree);
    assert_eq!(ids, vec!["s1"]);
}

#[test]
fn leaf_session_ids_nested_binary_tree() {
    let tree = serde_json::json!({
        "type": "horizontal",
        "first": {"type": "leaf", "sessionId": "s1"},
        "second": {"type": "leaf", "sessionId": "s2"},
    });
    let ids = patty::pty::leaf_session_ids(&tree);
    let mut sorted = ids.clone();
    sorted.sort();
    assert_eq!(sorted, vec!["s1", "s2"]);
}

#[test]
fn leaf_session_ids_deep_nested() {
    let tree = serde_json::json!({
        "type": "vertical",
        "first": {"type": "leaf", "sessionId": "s1"},
        "second": {
            "type": "horizontal",
            "first": {"type": "leaf", "sessionId": "s2"},
            "second": {"type": "leaf", "sessionId": "s3"},
        },
    });
    let ids = patty::pty::leaf_session_ids(&tree);
    let mut sorted = ids.clone();
    sorted.sort();
    assert_eq!(sorted, vec!["s1", "s2", "s3"]);
}

#[test]
fn leaf_session_ids_empty() {
    let ids = patty::pty::leaf_session_ids(&serde_json::json!({"type": "leaf"}));
    let ids_empty: Vec<String> = vec![];
    assert_eq!(ids, ids_empty);
}

#[test]
fn leaf_session_ids_no_children_for_non_leaf() {
    let tree = serde_json::json!({"type": "horizontal"});
    let ids = patty::pty::leaf_session_ids(&tree);
    assert!(ids.is_empty());
}

#[test]
fn leaf_session_ids_mixed_missing_session() {
    let tree = serde_json::json!({
        "type": "horizontal",
        "first": {"type": "leaf", "sessionId": "s1"},
        "second": {"type": "leaf"},
    });
    let ids = patty::pty::leaf_session_ids(&tree);
    assert_eq!(ids, vec!["s1"]);
}
