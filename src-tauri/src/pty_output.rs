use std::collections::{HashMap, VecDeque};

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
        Self { total_limit, pane_limit, outstanding: 0, accounts: HashMap::new(), waiters: VecDeque::new() }
    }

    fn open(&mut self, id: u64) {
        assert!(self.accounts.insert(id, Account::default()).is_none());
    }

    fn reserve(&mut self, id: u64, bytes: usize) -> bool {
        let Some(account) = self.accounts.get_mut(&id) else { return false };
        if account.outstanding + bytes > self.pane_limit {
            self.waiters.retain(|waiter| *waiter != id);
            return false;
        }
        if self.waiters.front().is_some_and(|first| *first != id) || self.outstanding + bytes > self.total_limit {
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
        let Some(account) = self.accounts.get_mut(&id) else { return false };
        if through > account.sequence { return false; }
        let mut released = 0;
        while let Some(&(sequence, bytes)) = account.sent.front() {
            if sequence > through { break; }
            account.sent.pop_front();
            released += bytes;
        }
        account.outstanding -= released;
        self.outstanding -= released;
        released != 0
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
        for id in [1, 2, 3] { flow.open(id); }
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
