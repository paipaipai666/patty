use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
    Engine,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use unicode_general_category::{get_general_category, GeneralCategory};

const MAX_SEQUENCE: usize = 4096;
const MAX_RECORDS: usize = 256;

pub const CAPABILITY_REPLY: &[u8] =
    b"\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Permission,
    Question,
    Auth,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum State {
    Idle,
    Working {
        #[serde(skip_serializing_if = "Option::is_none")]
        progress: Option<u8>,
    },
    Done,
    Blocked {
        #[serde(skip_serializing_if = "Option::is_none")]
        kind: Option<Kind>,
        #[serde(skip_serializing_if = "Option::is_none")]
        progress: Option<u8>,
    },
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Record {
    pub id: String,
    #[serde(flatten)]
    pub state: State,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Selected {
    pub revision: u64,
    #[serde(flatten)]
    pub record: Record,
}

#[derive(Default)]
pub struct Effects {
    pub changed: bool,
    pub query: bool,
}

#[derive(Default)]
enum Scan {
    #[default]
    Ground,
    Escape,
    Osc {
        body: Vec<u8>,
        length: usize,
        escape: bool,
    },
    String {
        escape: bool,
    },
}

struct Entry {
    record: Record,
    updated: u64,
    revision: u64,
}

enum Report {
    Set(Record),
    Clear(String),
    Query,
}

#[derive(Default)]
pub struct Tracker {
    scan: Scan,
    records: BTreeMap<String, Entry>,
    revision: u64,
}

impl State {
    fn urgency(&self) -> u8 {
        match self {
            Self::Blocked { .. } => 5,
            Self::Error => 4,
            Self::Working { .. } => 3,
            Self::Done => 2,
            Self::Idle => 1,
        }
    }

    fn volatile(&self) -> bool {
        matches!(self, Self::Working { .. } | Self::Blocked { .. })
    }
}

impl Tracker {
    pub fn feed(&mut self, bytes: &[u8]) -> Effects {
        let mut effects = Effects::default();
        for &byte in bytes {
            self.scan = match std::mem::take(&mut self.scan) {
                Scan::Ground => {
                    if byte == 0x1b {
                        Scan::Escape
                    } else {
                        Scan::Ground
                    }
                }
                Scan::Escape => self.escaped(byte, &mut effects),
                Scan::String { escape } => {
                    if (escape && byte == b'\\') || matches!(byte, 0x18 | 0x1a) {
                        Scan::Ground
                    } else {
                        Scan::String {
                            escape: byte == 0x1b,
                        }
                    }
                }
                Scan::Osc {
                    mut body,
                    length,
                    escape,
                } => {
                    let length = length.saturating_add(1);
                    if byte == 7 || (escape && byte == b'\\') {
                        if length <= MAX_SEQUENCE {
                            self.marker(&body, &mut effects);
                        }
                        Scan::Ground
                    } else if matches!(byte, 0x18 | 0x1a) {
                        Scan::Ground
                    } else if escape {
                        self.escaped(byte, &mut effects)
                    } else {
                        if length <= MAX_SEQUENCE && byte != 0x1b {
                            body.push(byte);
                        }
                        Scan::Osc {
                            body,
                            length,
                            escape: byte == 0x1b,
                        }
                    }
                }
            };
        }
        effects
    }

    fn escaped(&mut self, byte: u8, effects: &mut Effects) -> Scan {
        match byte {
            b']' => Scan::Osc {
                body: Vec::new(),
                length: 2,
                escape: false,
            },
            b'P' | b'X' | b'^' | b'_' => Scan::String { escape: false },
            b'c' => {
                effects.changed |= self.clear("");
                Scan::Ground
            }
            0x1b => Scan::Escape,
            _ => Scan::Ground,
        }
    }

    fn marker(&mut self, body: &[u8], effects: &mut Effects) {
        if body == b"133;A" || body.starts_with(b"133;A;") {
            effects.changed |= self.eof();
            return;
        }
        let Some(body) = body.strip_prefix(b"7501;") else {
            return;
        };
        match parse(body) {
            Some(Report::Query) => effects.query = true,
            Some(Report::Clear(id)) => effects.changed |= self.clear(&id),
            Some(Report::Set(record)) => {
                self.revision += 1;
                let revision = self
                    .records
                    .get(&record.id)
                    .filter(|entry| entry.record == record)
                    .map_or(self.revision, |entry| entry.revision);
                if self.records.len() == MAX_RECORDS && !self.records.contains_key(&record.id) {
                    let oldest = self
                        .records
                        .iter()
                        .min_by_key(|(_, entry)| entry.updated)
                        .map(|(id, _)| id.clone())
                        .unwrap();
                    self.records.remove(&oldest);
                }
                self.records.insert(
                    record.id.clone(),
                    Entry {
                        record,
                        updated: self.revision,
                        revision,
                    },
                );
                effects.changed = true;
            }
            None => {}
        }
    }

    fn clear(&mut self, id: &str) -> bool {
        let before = self.records.len();
        self.records.retain(|key, _| {
            !(id.is_empty()
                || key == id
                || key
                    .strip_prefix(id)
                    .is_some_and(|suffix| suffix.starts_with('/')))
        });
        let changed = before != self.records.len();
        if changed {
            self.revision += 1;
        }
        changed
    }

    pub fn eof(&mut self) -> bool {
        let before = self.records.len();
        self.records
            .retain(|_, entry| !entry.record.state.volatile());
        let changed = before != self.records.len();
        if changed {
            self.revision += 1;
        }
        changed
    }

    pub fn record_count(&self) -> usize {
        self.records.len()
    }

    pub fn selected(&self) -> Option<Selected> {
        let entry = self
            .records
            .values()
            .max_by_key(|entry| (entry.record.state.urgency(), entry.updated))?;
        let mut record = entry.record.clone();
        let mut ancestor = record.id.as_str();
        while record.app.is_none() && !ancestor.is_empty() {
            ancestor = ancestor.rsplit_once('/').map_or("", |(parent, _)| parent);
            record.app = self
                .records
                .get(ancestor)
                .and_then(|parent| parent.record.app.clone());
        }
        Some(Selected {
            revision: entry.revision,
            record,
        })
    }
}

fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'+' | b'-'))
}

fn decode_text(value: &str, limit: usize) -> Option<String> {
    let engine = if value.ends_with('=') {
        &STANDARD
    } else {
        &STANDARD_NO_PAD
    };
    let decoded = engine.decode(value).ok()?;
    if decoded.len() > limit {
        return None;
    }
    let text = String::from_utf8(decoded).ok()?;
    if text
        .chars()
        .any(|c| matches!(c, '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}'))
    {
        return None;
    }
    Some(
        text.chars()
            .filter(|&c| get_general_category(c) != GeneralCategory::Format && c != '\u{34f}')
            .collect(),
    )
}

fn parse(body: &[u8]) -> Option<Report> {
    let body = std::str::from_utf8(body).ok()?.trim();
    if body == "?" {
        return Some(Report::Query);
    }
    let mut fields = HashMap::new();
    let mut title = None;
    let mut message = None;
    for pair in body.split(':') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.len() > 16 {
            return None;
        }
        if key.is_empty() || !key.bytes().all(|byte| byte.is_ascii_lowercase()) {
            continue;
        }
        let limit = match key {
            "msg" => 2732,
            "title" => 256,
            "app" => 32,
            "id" => 128,
            _ => MAX_SEQUENCE,
        };
        if value.len() > limit {
            return None;
        }
        if !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'_' | b'.' | b',' | b'+' | b'/' | b'=' | b'-')
        }) {
            continue;
        }
        match key {
            "title" => title = Some(decode_text(value, 192)?),
            "msg" => message = Some(decode_text(value, 2048)?),
            _ => {
                fields.insert(key, value);
            }
        }
    }
    let id = match fields.get("id") {
        Some(id) if id.split('/').count() <= 8 && id.split('/').all(valid_segment) => {
            id.to_string()
        }
        Some(_) => return None,
        None => String::new(),
    };
    let state = *fields.get("state")?;
    let progress = fields
        .get("progress")
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|&value| value <= 100);
    let kind = match fields.get("kind").copied() {
        Some("permission") => Some(Kind::Permission),
        Some("question") => Some(Kind::Question),
        Some("auth") => Some(Kind::Auth),
        _ => None,
    };
    let state = match state {
        "idle" => State::Idle,
        "working" => State::Working { progress },
        "done" => State::Done,
        "blocked" => State::Blocked { kind, progress },
        "error" => State::Error,
        "clear" => return Some(Report::Clear(id)),
        _ => return None,
    };
    let app = fields
        .get("app")
        .filter(|value| valid_segment(value))
        .map(|value| value.to_string());
    Some(Report::Set(Record {
        id,
        state,
        app,
        title,
        message,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_program_can_report_approval_without_changing_its_terminal_output() {
        let mut tracker = Tracker::default();
        let report = b"\x1b]7501;state=blocked:kind=permission:app=deploy:msg=QXBwcm92ZQ==\x1b\\";
        assert!(tracker.feed(report).changed);
        assert_eq!(
            serde_json::to_value(tracker.selected()).unwrap(),
            json!({
                "revision": 1, "id": "", "state": "blocked", "kind": "permission", "app": "deploy", "message": "Approve",
            })
        );
    }

    fn report(tracker: &mut Tracker, body: &str) -> Effects {
        tracker.feed(format!("\x1b]7501;{body}\x1b\\").as_bytes())
    }

    #[test]
    fn protocol_fixtures_are_invariant_at_every_read_boundary() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../src/shared/__fixtures__/program-status.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let bytes = case["output"].as_str().unwrap().as_bytes();
            for split in 0..=bytes.len() {
                let mut tracker = Tracker::default();
                tracker.feed(&bytes[..split]);
                tracker.feed(&bytes[split..]);
                assert_eq!(
                    serde_json::to_value(tracker.selected()).unwrap(),
                    case["selected"],
                    "{} at {split}",
                    case["name"]
                );
                assert_eq!(
                    tracker.record_count(),
                    case["count"].as_u64().unwrap() as usize
                );
            }
        }
    }

    #[test]
    fn malformed_pairs_are_skipped_and_the_last_valid_pair_wins() {
        let mut tracker = Tracker::default();
        report(&mut tracker, "STATE=error:state=idle:broken:state = working :progress=-1:progress=007:kind=auth:app=invalid/app:unknown=value");
        assert_eq!(
            serde_json::to_value(tracker.selected()).unwrap(),
            json!({"revision":1,"id":"","state":"working","progress":7})
        );
        for progress in ["101", "-1", "+1", "", "1.0", "99999999999999999"] {
            report(&mut tracker, &format!("state=working:progress={progress}"));
            assert_eq!(
                tracker.selected().unwrap().record.state,
                State::Working { progress: None }
            );
        }
        report(&mut tracker, "state=blocked:kind=future");
        assert_eq!(
            tracker.selected().unwrap().record.state,
            State::Blocked {
                kind: None,
                progress: None
            }
        );
    }

    #[test]
    fn invalid_reports_never_overwrite_or_clear_an_existing_record() {
        let mut tracker = Tracker::default();
        report(&mut tracker, "state=done:app=cargo");
        let expected = tracker.selected();
        let mut invalid = vec![
            "state=unknown".into(),
            "msg=QQ==".into(),
            "state=error:id=".into(),
            "state=clear:id=/".into(),
            "state=error:abcdefghijklmnopq=value".into(),
        ];
        for text in ["A", "wA==", "AA==", "Cg==", "CQ==", "woU=", "QQ="] {
            invalid.push(format!("state=clear:msg={text}"));
            invalid.push(format!("state=error:msg={text}:msg=QQ=="));
        }
        for id in [
            "/root".into(),
            "root/".into(),
            "root//child".into(),
            "a/".repeat(8) + "a",
            "a".repeat(33),
            ["a".repeat(32); 1].concat()
                + "/"
                + &"b".repeat(32)
                + "/"
                + &"c".repeat(32)
                + "/"
                + &"d".repeat(30),
        ] {
            invalid.push(format!("state=error:id={id}"));
        }
        invalid.push(format!("state=error:app={}", "a".repeat(33)));
        invalid.push(format!(
            "state=error:title={}",
            STANDARD.encode(vec![b'a'; 193])
        ));
        invalid.push(format!(
            "state=error:msg={}",
            STANDARD.encode(vec![b'a'; 2049])
        ));
        invalid.push(format!("state=error:msg={}", "A".repeat(2733)));
        for body in invalid {
            assert!(!report(&mut tracker, &body).changed, "{body}");
            assert_eq!(tracker.selected(), expected, "{body}");
        }
    }

    #[test]
    fn limits_are_in_bytes_and_invisible_formatting_is_removed_from_display_text() {
        let mut tracker = Tracker::default();
        report(
            &mut tracker,
            &format!(
                "state=working:title={}:msg={}",
                STANDARD.encode(vec![b'a'; 192]),
                STANDARD.encode(vec![b'b'; 2048])
            ),
        );
        let record = tracker.selected().unwrap().record;
        assert_eq!(record.title.as_deref(), Some("a".repeat(192).as_str()));
        assert_eq!(record.message.as_deref(), Some("b".repeat(2048).as_str()));
        report(
            &mut tracker,
            &format!(
                "state=done:msg={}",
                STANDARD.encode("Approve\u{202e}\u{2066}\u{200b}\u{34f}\u{e0061}构建")
            ),
        );
        assert_eq!(
            tracker.selected().unwrap().record.message.as_deref(),
            Some("Approve构建")
        );
        let header = "\x1b]7501;state=error:extra=";
        let boundary = format!("{header}{}\x07", "a".repeat(4096 - header.len() - 1));
        assert!(tracker.feed(boundary.as_bytes()).changed);
        let expected = tracker.selected();
        let over = format!("{header}{}\x07", "a".repeat(4097 - header.len() - 1));
        assert!(!tracker.feed(over.as_bytes()).changed);
        assert_eq!(tracker.selected(), expected);
    }

    #[test]
    fn queries_have_a_fixed_reply_and_never_echo_or_reply_to_a_reply() {
        let mut tracker = Tracker::default();
        assert!(report(&mut tracker, "?").query);
        assert_eq!(CAPABILITY_REPLY, b"\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\");
        assert!(!tracker.feed(CAPABILITY_REPLY).query);
        assert!(tracker.selected().is_none());
    }

    #[test]
    fn prompt_and_exit_remove_only_volatile_records_and_ris_clears_everything() {
        let mut tracker = Tracker::default();
        for (id, state) in [
            ("a", "done"),
            ("b", "error"),
            ("c", "working"),
            ("d", "blocked"),
            ("e", "idle"),
        ] {
            report(&mut tracker, &format!("id={id}:state={state}"));
        }
        assert!(tracker.eof());
        assert_eq!(tracker.record_count(), 3);
        assert_eq!(tracker.selected().unwrap().record.id, "b");
        report(&mut tracker, "id=worker:state=working");
        assert!(tracker.feed(b"\x1b]133;A;k=i\x07").changed);
        assert_eq!(tracker.record_count(), 3);
        tracker.feed(b"\x1b[!p\x1b[?1049h\x1b[?1049l");
        assert_eq!(tracker.record_count(), 3);
        assert!(tracker.feed(b"\x1bc").changed);
        assert!(tracker.selected().is_none());
    }

    #[test]
    fn record_capacity_evicts_the_least_recently_updated_record() {
        let mut tracker = Tracker::default();
        for id in 0..256 {
            report(&mut tracker, &format!("state=idle:id=r{id}"));
        }
        report(&mut tracker, "state=idle:id=r0");
        report(&mut tracker, "state=idle:id=r256");
        assert_eq!(tracker.record_count(), 256);
        assert_eq!(tracker.selected().unwrap().record.id, "r256");
        for id in std::iter::once(0).chain(2..=256) {
            report(&mut tracker, &format!("state=clear:id=r{id}"));
        }
        assert_eq!(tracker.record_count(), 0);
    }

    #[test]
    fn reports_in_cancelled_strings_are_ignored_and_a_new_escape_resynchronizes() {
        let mut tracker = Tracker::default();
        tracker.feed(b"\x1b]7501;state=error\x18\x1b]7501;state=working\x1b]7501;state=done\x07");
        assert_eq!(tracker.selected().unwrap().record.state, State::Done);
        let revision = tracker.selected().unwrap().revision;
        report(&mut tracker, "state=done");
        assert_eq!(tracker.selected().unwrap().revision, revision);
    }
}
