// SSH profile support: spawn the system OpenSSH client (ssh.exe) inside the
// existing ConPTY pipeline. No credentials are stored — password prompts are
// handled interactively by ssh.exe itself (or ssh-agent).

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::sync::LazyLock;

/// Connection parameters. The renderer sends this verbatim through `create_pty`;
/// it is also persisted on sessions (camelCase keys) and read back by
/// `warm_startup` to reconnect SSH sessions after an app restart.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
}

/// A parsed `~/.ssh/config` Host block, before the renderer assigns an id.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProfileDraft {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
}

/// Build the argv for ssh.exe. Port 22 is the default and is omitted; empty
/// user/identity strings are treated as absent.
pub fn ssh_args(t: &SshTarget) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(p) = t.port {
        if p != 22 {
            args.push("-p".into());
            args.push(p.to_string());
        }
    }
    if let Some(idf) = t.identity_file.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("-i".into());
        args.push(idf.to_string());
    }
    let dest = match t.user.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(u) => format!("{u}@{}", t.host),
        None => t.host.clone(),
    };
    args.push(dest);
    args
}

/// Locate ssh.exe. Probes `where.exe` once per process (hidden console
/// window, same flags as pty.rs find_pwsh), falls back to the well-known
/// OpenSSH path.
pub fn find_ssh() -> Option<PathBuf> {
    static SSH: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
        let out = Command::new("where.exe").arg("ssh").creation_flags(0x08000000).output().ok();
        if let Some(out) = out {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Some(first) = stdout.lines().next().map(str::trim) {
                    let path = PathBuf::from(first);
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
        let well_known = PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh.exe");
        well_known.exists().then_some(well_known)
    });
    SSH.clone()
}

/// Parse OpenSSH client config into profile drafts. Only Host / HostName /
/// User / Port / IdentityFile are honored; Include, Match, ProxyJump and other
/// directives are ignored. Wildcard-only blocks (`Host *`) are skipped.
pub fn parse_ssh_config(content: &str) -> Vec<SshProfileDraft> {
    struct Block {
        name: String,
        host_name: Option<String>,
        user: Option<String>,
        port: Option<u16>,
        identity_file: Option<String>,
    }

    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let mut blocks: Vec<Block> = Vec::new();
    let mut current: Option<Block> = None;

    for raw_line in content.lines() {
        // Strip comments: a '#' starts a comment unless inside quotes (good
        // enough for config files — quoted values containing '#' are rare).
        let line = match raw_line.find('#') {
            Some(i) => &raw_line[..i],
            None => raw_line,
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Support both `Key value` and `Key=value`.
        let (key, value) = match line.split_once('=') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => match line.split_once(char::is_whitespace) {
                Some((k, v)) => (k.trim(), v.trim()),
                None => (line, ""),
            },
        };
        let key_lower = key.to_lowercase();
        let value = value.trim_matches(|c| c == '"' || c == '\'');

        if key_lower == "host" {
            // Finish the previous block.
            if let Some(b) = current.take() {
                blocks.push(b);
            }
            // First non-wildcard pattern becomes the profile name; a block of
            // only wildcards gets no block at all (skipped).
            let name = value
                .split_whitespace()
                .find(|p| !p.contains('*') && !p.contains('?'));
            current = name.map(|n| Block {
                name: n.to_string(),
                host_name: None,
                user: None,
                port: None,
                identity_file: None,
            });
            continue;
        }

        let Some(b) = current.as_mut() else { continue };
        match key_lower.as_str() {
            "hostname" => b.host_name = Some(value.to_string()),
            "user" => b.user = Some(value.to_string()),
            "port" => b.port = value.parse().ok(),
            "identityfile" => {
                let expanded = if let Some(rest) = value.strip_prefix('~') {
                    format!("{home}{rest}")
                } else {
                    value.to_string()
                };
                // Keep only the first IdentityFile — drafts are single-key.
                if b.identity_file.is_none() {
                    b.identity_file = Some(expanded);
                }
            }
            _ => {}
        }
    }
    if let Some(b) = current.take() {
        blocks.push(b);
    }

    blocks
        .into_iter()
        .map(|b| SshProfileDraft {
            host: b.host_name.unwrap_or_else(|| b.name.clone()),
            name: b.name,
            port: b.port,
            user: b.user,
            identity_file: b.identity_file,
        })
        .collect()
}

/// Command payload for `ssh_config_import`: a missing/unreadable config file
/// is not an error — the user simply has nothing to import.
pub fn import_ssh_config() -> Value {
    let content = std::env::var("USERPROFILE")
        .ok()
        .map(|u| PathBuf::from(u).join(".ssh").join("config"))
        .and_then(|p| std::fs::read_to_string(p).ok());
    match content {
        Some(c) => json!({ "success": true, "profiles": parse_ssh_config(&c) }),
        None => json!({ "success": true, "profiles": [] }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(host: &str, port: Option<u16>, user: Option<&str>, idf: Option<&str>) -> SshTarget {
        SshTarget {
            host: host.to_string(),
            port,
            user: user.map(str::to_string),
            identity_file: idf.map(str::to_string),
        }
    }

    #[test]
    fn ssh_args_full() {
        let t = target("example.com", Some(2222), Some("root"), Some("C:\\keys\\id_ed25519"));
        assert_eq!(
            ssh_args(&t),
            vec!["-p", "2222", "-i", "C:\\keys\\id_ed25519", "root@example.com"]
        );
    }

    #[test]
    fn ssh_args_omits_default_port() {
        let t = target("example.com", Some(22), Some("root"), None);
        assert_eq!(ssh_args(&t), vec!["root@example.com"]);
    }

    #[test]
    fn ssh_args_without_user() {
        let t = target("example.com", None, None, None);
        assert_eq!(ssh_args(&t), vec!["example.com"]);
    }

    #[test]
    fn ssh_args_blank_user_and_identity_ignored() {
        let t = target("example.com", None, Some("  "), Some(""));
        assert_eq!(ssh_args(&t), vec!["example.com"]);
    }

    #[test]
    fn parse_basic_block() {
        let cfg = "Host prod\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/prod_key\n";
        let drafts = parse_ssh_config(cfg);
        assert_eq!(drafts.len(), 1);
        let d = &drafts[0];
        assert_eq!(d.name, "prod");
        assert_eq!(d.host, "10.0.0.5");
        assert_eq!(d.user.as_deref(), Some("deploy"));
        assert_eq!(d.port, Some(2222));
        let home = std::env::var("USERPROFILE").unwrap();
        assert_eq!(d.identity_file.as_deref(), Some(format!("{home}/.ssh/prod_key").as_str()));
    }

    #[test]
    fn parse_skips_wildcard_blocks() {
        let cfg = "Host *\n  User ignored\nHost web\n  HostName web.internal\n";
        let drafts = parse_ssh_config(cfg);
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].name, "web");
        assert_eq!(drafts[0].user, None);
    }

    #[test]
    fn parse_host_without_hostname_uses_alias() {
        let cfg = "Host db.example.com\n  User postgres\n";
        let drafts = parse_ssh_config(cfg);
        assert_eq!(drafts[0].host, "db.example.com");
    }

    #[test]
    fn parse_supports_equals_syntax_and_comments() {
        let cfg = "# a comment\nHost=prod # trailing\nHostName=10.0.0.9\nPort=2200\n";
        let drafts = parse_ssh_config(cfg);
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].name, "prod");
        assert_eq!(drafts[0].host, "10.0.0.9");
        assert_eq!(drafts[0].port, Some(2200));
    }

    #[test]
    fn parse_strips_quotes_and_ignores_bad_port() {
        let cfg = "Host q\n  IdentityFile \"C:\\keys\\my key.pem\"\n  Port notaport\n";
        let drafts = parse_ssh_config(cfg);
        assert_eq!(drafts[0].identity_file.as_deref(), Some("C:\\keys\\my key.pem"));
        assert_eq!(drafts[0].port, None);
    }

    #[test]
    fn parse_multi_alias_uses_first_non_wildcard() {
        let cfg = "Host app *.internal\n  User u\n";
        let drafts = parse_ssh_config(cfg);
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].name, "app");
    }
}
