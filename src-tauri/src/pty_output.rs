use serde::Serialize;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::ops::Bound::{Excluded, Unbounded};
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

const TOTAL_LIMIT: usize = 1024 * 1024;
const PANE_LIMIT: usize = 128 * 1024;
const REPLAY_LIMIT: usize = 256 * 1024;
const BATCH_BYTES: usize = 4 * 1024;
const BATCH_DELAY: Duration = Duration::from_millis(2);

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum Message {
    Data { sequence: u32, text: String },
    Exit { code: i64 },
}

pub(crate) type SendMessage = Arc<dyn Fn(&Message) -> bool + Send + Sync>;

struct Link {
    id: String,
    credit: u64,
    send: SendMessage,
}

#[derive(Default)]
struct Bytes {
    chunks: VecDeque<String>,
    len: usize,
}

impl Bytes {
    fn push(&mut self, text: String) {
        self.len += text.len();
        self.chunks.push_back(text);
    }

    fn truncate_history(&mut self) {
        while self.len > REPLAY_LIMIT {
            self.len -= self.chunks.pop_front().unwrap().len();
        }
    }

    fn batch_len(&self) -> usize {
        let mut used = 0;
        for chunk in &self.chunks {
            let remaining = BATCH_BYTES - used;
            if chunk.len() > remaining {
                let mut end = remaining;
                while !chunk.is_char_boundary(end) {
                    end -= 1;
                }
                return used + end;
            }
            used += chunk.len();
            if used == BATCH_BYTES {
                break;
            }
        }
        used
    }

    fn take(&mut self, bytes: usize) -> String {
        let mut result = String::with_capacity(bytes);
        while result.len() < bytes {
            let mut front = self.chunks.pop_front().unwrap();
            let remaining = bytes - result.len();
            if front.len() > remaining {
                let tail = front.split_off(remaining);
                self.chunks.push_front(tail);
            }
            result.push_str(&front);
        }
        self.len -= bytes;
        result
    }
}

#[derive(Default)]
struct Stream {
    history: Bytes,
    live: Bytes,
    deadline: Option<Instant>,
    link: Option<Link>,
    eof: bool,
    exit: Option<i64>,
}

struct HubState {
    next: u64,
    cursor: u64,
    streams: BTreeMap<u64, Stream>,
    connections: HashMap<String, u64>,
    credits: Credits,
}

struct Delivery {
    id: String,
    #[cfg(feature = "e2e")]
    link_key: u64,
    send: SendMessage,
    message: Message,
}

impl HubState {
    fn key(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    fn disconnect(&mut self, id: &str) {
        let Some(key) = self.connections.remove(id) else {
            return;
        };
        let stream = self.streams.get_mut(&key).unwrap();
        let link = stream.link.take().unwrap();
        self.credits.close(link.credit);
        while let Some(text) = stream.live.chunks.pop_front() {
            stream.history.push(text);
        }
        stream.live.len = 0;
        stream.history.truncate_history();
        stream.deadline = None;
        self.reap(key);
    }

    fn reap(&mut self, key: u64) {
        if self
            .streams
            .get(&key)
            .is_some_and(|stream| stream.eof && stream.exit.is_some() && stream.link.is_none())
        {
            self.streams.remove(&key);
        }
    }

    fn next_delivery(&mut self, now: Instant) -> (Option<Delivery>, Option<Instant>) {
        let mut wake = None;
        let ids: Vec<u64> = self
            .streams
            .range((Excluded(self.cursor), Unbounded))
            .chain(self.streams.range(..=self.cursor))
            .map(|(&key, _)| key)
            .collect();
        for key in ids {
            let stream = self.streams.get_mut(&key).unwrap();
            let Some(link) = stream.link.as_ref() else {
                continue;
            };
            let message = if stream.history.len != 0 {
                let len = stream.history.batch_len();
                if !self.credits.reserve(link.credit, len) {
                    continue;
                }
                Message::Data {
                    sequence: self.credits.send(link.credit, len),
                    text: stream.history.take(len),
                }
            } else if let Some(deadline) = stream.deadline {
                if stream.live.len < BATCH_BYTES && !stream.eof && deadline > now {
                    wake = Some(wake.map_or(deadline, |previous: Instant| previous.min(deadline)));
                    continue;
                }
                let len = stream.live.batch_len();
                let text = stream.live.take(len);
                if stream.live.len == 0 {
                    stream.deadline = None;
                }
                Message::Data {
                    sequence: self.credits.send(link.credit, len),
                    text,
                }
            } else if let Some(code) = stream
                .exit
                .filter(|_| stream.eof && self.credits.empty(link.credit))
            {
                Message::Exit { code }
            } else {
                continue;
            };
            let delivery = Delivery {
                id: link.id.clone(),
                #[cfg(feature = "e2e")]
                link_key: link.credit,
                send: link.send.clone(),
                message,
            };
            if matches!(delivery.message, Message::Exit { .. }) {
                self.disconnect(&delivery.id);
            }
            self.cursor = key;
            return (Some(delivery), wake);
        }
        (None, wake)
    }
}

struct Hub {
    state: Mutex<HubState>,
    changed: Condvar,
}

static HUB: LazyLock<Arc<Hub>> = LazyLock::new(|| {
    let hub = Arc::new(Hub {
        state: Mutex::new(HubState {
            next: 0,
            cursor: 0,
            streams: BTreeMap::new(),
            connections: HashMap::new(),
            credits: Credits::new(TOTAL_LIMIT, PANE_LIMIT),
        }),
        changed: Condvar::new(),
    });
    let worker = hub.clone();
    std::thread::spawn(move || worker.dispatch());
    hub
});

impl Hub {
    fn dispatch(&self) {
        loop {
            let mut state = self.state.lock().unwrap();
            let delivery = loop {
                let now = Instant::now();
                match state.next_delivery(now) {
                    (Some(delivery), _) => break delivery,
                    (None, Some(wake)) => {
                        state = self
                            .changed
                            .wait_timeout(state, wake.saturating_duration_since(now))
                            .unwrap()
                            .0
                    }
                    (None, None) => state = self.changed.wait(state).unwrap(),
                }
            };
            self.changed.notify_all();
            drop(state);
            #[cfg(feature = "e2e")]
            let probe = crate::benchmark::dispatch_probe();
            let delivered = (delivery.send)(&delivery.message);
            #[cfg(feature = "e2e")]
            if let (Some(probe), Message::Data { text, .. }) = (probe, &delivery.message) {
                crate::benchmark::record_dispatch(delivery.link_key, probe, text);
            }
            if !delivered {
                disconnect(&delivery.id);
            }
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Output(u64);

impl Output {
    #[cfg(feature = "e2e")]
    pub(crate) fn trace_input(self, stage: crate::benchmark::InputStage, bytes: &[u8]) {
        crate::benchmark::record_input(stage, self.0, bytes);
    }

    #[cfg(feature = "e2e")]
    pub(crate) fn trace_read(self, bytes: &[u8]) {
        crate::benchmark::record_read(self.0, bytes);
    }

    pub(crate) fn new() -> Self {
        let mut state = HUB.state.lock().unwrap();
        let key = state.key();
        state.streams.insert(key, Stream::default());
        Self(key)
    }

    pub(crate) fn attach(self, id: String, send: SendMessage) -> bool {
        let mut state = HUB.state.lock().unwrap();
        let Some(stream) = state.streams.get(&self.0) else {
            return false;
        };
        if state.connections.contains_key(&id) {
            return false;
        }
        if let Some(previous) = stream.link.as_ref().map(|link| link.id.clone()) {
            state.disconnect(&previous);
        }
        if !state.streams.contains_key(&self.0) {
            return false;
        }
        let credit = state.key();
        state.credits.open(credit);
        state.connections.insert(id.clone(), self.0);
        state.streams.get_mut(&self.0).unwrap().link = Some(Link { id, credit, send });
        HUB.changed.notify_all();
        true
    }

    pub(crate) fn push(self, text: String) {
        if text.is_empty() {
            return;
        }
        let mut state = HUB.state.lock().unwrap();
        loop {
            let Some(stream) = state.streams.get_mut(&self.0) else {
                return;
            };
            let Some(link) = stream.link.as_ref() else {
                stream.history.push(text);
                stream.history.truncate_history();
                return;
            };
            let credit = link.credit;
            if stream.history.len == 0 && state.credits.reserve(credit, text.len()) {
                let stream = state.streams.get_mut(&self.0).unwrap();
                stream
                    .deadline
                    .get_or_insert_with(|| Instant::now() + BATCH_DELAY);
                stream.live.push(text);
                HUB.changed.notify_all();
                return;
            }
            state = HUB.changed.wait(state).unwrap();
        }
    }

    pub(crate) fn eof(self) {
        self.finish(None);
    }

    pub(crate) fn exit(self, code: i64) {
        self.finish(Some(code));
    }

    fn finish(self, exit: Option<i64>) {
        let mut state = HUB.state.lock().unwrap();
        let Some(stream) = state.streams.get_mut(&self.0) else {
            return;
        };
        if let Some(code) = exit {
            stream.exit = Some(code);
        } else {
            stream.eof = true;
        }
        state.reap(self.0);
        HUB.changed.notify_all();
    }

    pub(crate) fn close(self) {
        let mut state = HUB.state.lock().unwrap();
        if let Some(link) = state.streams.remove(&self.0).and_then(|stream| stream.link) {
            state.connections.remove(&link.id);
            state.credits.close(link.credit);
        }
        HUB.changed.notify_all();
    }

    #[cfg(test)]
    pub(crate) fn history(self) -> String {
        HUB.state
            .lock()
            .unwrap()
            .streams
            .get(&self.0)
            .unwrap()
            .history
            .chunks
            .iter()
            .cloned()
            .collect()
    }
}

pub(crate) fn acknowledge(id: &str, through: u32) {
    let mut state = HUB.state.lock().unwrap();
    let Some(key) = state.connections.get(id) else {
        return;
    };
    let credit = state
        .streams
        .get(key)
        .unwrap()
        .link
        .as_ref()
        .unwrap()
        .credit;
    if state.credits.acknowledge(credit, through) {
        HUB.changed.notify_all();
    }
}

pub(crate) fn disconnect(id: &str) {
    HUB.state.lock().unwrap().disconnect(id);
    HUB.changed.notify_all();
}

#[derive(Default)]
struct Account {
    pending: usize,
    outstanding: usize,
    sequence: u32,
    sent: VecDeque<(u32, usize)>,
}

struct Credits {
    total_limit: usize,
    pane_limit: usize,
    outstanding: usize,
    accounts: HashMap<u64, Account>,
    waiters: VecDeque<u64>,
}

impl Credits {
    fn new(total_limit: usize, pane_limit: usize) -> Self {
        Self {
            total_limit,
            pane_limit,
            outstanding: 0,
            accounts: HashMap::new(),
            waiters: VecDeque::new(),
        }
    }

    fn open(&mut self, id: u64) {
        assert!(self.accounts.insert(id, Account::default()).is_none());
    }

    fn reserve(&mut self, id: u64, bytes: usize) -> bool {
        let Some(account) = self.accounts.get_mut(&id) else {
            return false;
        };
        if account.outstanding + bytes > self.pane_limit {
            self.waiters.retain(|waiter| *waiter != id);
            return false;
        }
        if self.waiters.front().is_some_and(|first| *first != id)
            || self.outstanding + bytes > self.total_limit
        {
            if !self.waiters.contains(&id) {
                self.waiters.push_back(id);
            }
            return false;
        }
        if self.waiters.front() == Some(&id) {
            self.waiters.pop_front();
        }
        account.pending += bytes;
        account.outstanding += bytes;
        self.outstanding += bytes;
        true
    }

    fn send(&mut self, id: u64, bytes: usize) -> u32 {
        let account = self.accounts.get_mut(&id).unwrap();
        account.pending -= bytes;
        account.sequence += 1;
        account.sent.push_back((account.sequence, bytes));
        account.sequence
    }

    fn acknowledge(&mut self, id: u64, through: u32) -> bool {
        let Some(account) = self.accounts.get_mut(&id) else {
            return false;
        };
        if through > account.sequence {
            return false;
        }
        let mut released = 0;
        while let Some(&(sequence, bytes)) = account.sent.front() {
            if sequence > through {
                break;
            }
            account.sent.pop_front();
            released += bytes;
        }
        account.outstanding -= released;
        self.outstanding -= released;
        released != 0
    }

    fn empty(&self, id: u64) -> bool {
        self.accounts[&id].outstanding == 0
    }

    fn close(&mut self, id: u64) {
        if let Some(account) = self.accounts.remove(&id) {
            self.outstanding -= account.outstanding;
        }
        self.waiters.retain(|waiter| *waiter != id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_and_live_output_are_consumed_before_the_exit_message() {
        let output = Output::new();
        output.push(format!("{}中", "x".repeat(BATCH_BYTES - 1)));
        let (tx, rx) = std::sync::mpsc::channel();
        let connection = "ordered-output-test".to_string();
        assert!(output.attach(
            connection.clone(),
            Arc::new(move |message| tx.send(message.clone()).is_ok())
        ));
        output.push(" tail".into());
        output.exit(7);
        output.eof();

        let mut text = String::new();
        let mut through = 0;
        while text.len() < BATCH_BYTES + 7 {
            let Message::Data {
                sequence,
                text: batch,
            } = rx.recv_timeout(Duration::from_secs(2)).unwrap()
            else {
                panic!("exit overtook output");
            };
            assert_eq!(sequence, through + 1);
            through = sequence;
            text.push_str(&batch);
        }
        assert_eq!(text, format!("{}中 tail", "x".repeat(BATCH_BYTES - 1)));
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err());
        acknowledge(&connection, through);
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(2)),
            Ok(Message::Exit { code: 7 })
        ));
    }

    #[test]
    fn detached_replay_retains_the_newest_output_within_its_budget() {
        let output = Output::new();
        output.push("obsolete".into());
        for _ in 0..(REPLAY_LIMIT / BATCH_BYTES) {
            output.push("x".repeat(BATCH_BYTES));
        }
        assert_eq!(output.history(), "x".repeat(REPLAY_LIMIT));
        output.close();
    }

    #[test]
    fn closing_a_stalled_connection_releases_its_reader() {
        let output = Output::new();
        let (tx, rx) = std::sync::mpsc::channel();
        let connection = "stalled-output-test".to_string();
        assert!(output.attach(
            connection,
            Arc::new(move |message| tx.send(message.clone()).is_ok())
        ));
        for _ in 0..(PANE_LIMIT / BATCH_BYTES) {
            output.push("x".repeat(BATCH_BYTES));
        }
        for sequence in 1..=(PANE_LIMIT / BATCH_BYTES) as u32 {
            assert!(
                matches!(rx.recv_timeout(Duration::from_secs(2)), Ok(Message::Data { sequence: actual, .. }) if sequence == actual)
            );
        }
        let (done, completed) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            output.push("waiting for capacity".into());
            done.send(()).unwrap();
        });
        let blocked = completed.recv_timeout(Duration::from_millis(30)).is_err();
        output.close();
        assert!(blocked, "producer bypassed unacknowledged output");
        completed.recv_timeout(Duration::from_secs(2)).unwrap();
        reader.join().unwrap();
    }

    #[test]
    fn credits_cover_pending_and_sent_data_until_the_consumer_acknowledges_it() {
        let mut flow = Credits::new(8, 6);
        flow.open(1);
        flow.open(2);
        assert!(flow.reserve(1, 6));
        assert!(!flow.reserve(1, 1));
        assert!(flow.reserve(2, 2));
        let first = flow.send(1, 3);
        let second = flow.send(1, 3);
        assert!(!flow.reserve(2, 1));
        assert!(!flow.acknowledge(1, second + 1));
        assert!(!flow.reserve(2, 1));
        assert!(flow.acknowledge(1, first));
        assert!(flow.reserve(2, 3));
        assert!(!flow.acknowledge(1, first));
        assert!(!flow.reserve(2, 1));
        assert!(flow.acknowledge(1, second));
        assert!(flow.reserve(2, 1));
    }

    #[test]
    fn a_busy_pane_cannot_jump_the_global_wait_queue() {
        let mut flow = Credits::new(8, 8);
        for id in [1, 2, 3] {
            flow.open(id);
        }
        assert!(flow.reserve(1, 8));
        let sent = flow.send(1, 8);
        assert!(!flow.reserve(2, 4));
        assert!(!flow.reserve(3, 4));
        assert!(flow.acknowledge(1, sent));
        assert!(!flow.reserve(1, 4));
        assert!(!flow.reserve(3, 4));
        assert!(flow.reserve(2, 4));
        assert!(flow.reserve(3, 4));
        flow.close(2);
        assert!(flow.reserve(1, 4));
    }

    #[test]
    fn closing_an_attachment_releases_waiting_bytes_and_stale_acknowledgements() {
        let mut flow = Credits::new(8, 8);
        flow.open(1);
        flow.open(2);
        assert!(flow.reserve(1, 8));
        let old = flow.send(1, 4);
        assert!(!flow.reserve(2, 8));
        flow.close(1);
        assert!(flow.reserve(2, 8));
        assert!(!flow.acknowledge(1, old));
        assert!(!flow.reserve(1, 1));
    }
}
