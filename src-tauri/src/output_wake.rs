use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::null;
use std::time::Instant;
use windows_sys::Win32::Foundation::{HANDLE, WAIT_FAILED, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    CancelWaitableTimer, CreateEventW, CreateWaitableTimerExW, SetEvent, SetWaitableTimerEx,
    WaitForMultipleObjects, WaitForSingleObject, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, INFINITE,
    SYNCHRONIZATION_SYNCHRONIZE, TIMER_MODIFY_STATE,
};

pub(crate) struct DeadlineWake {
    changed: OwnedHandle,
    timer: OwnedHandle,
    #[cfg(any(feature = "e2e", test))]
    high_resolution: bool,
}

fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() {
        Err(io::Error::last_os_error())
    } else {
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }
}

impl DeadlineWake {
    pub(crate) fn new() -> io::Result<Self> {
        Self::with_timer_flags(CREATE_WAITABLE_TIMER_HIGH_RESOLUTION)
            .or_else(|_| Self::with_timer_flags(0))
    }

    fn with_timer_flags(flags: u32) -> io::Result<Self> {
        let changed = owned(unsafe { CreateEventW(null(), 0, 0, null()) })?;
        let timer = owned(unsafe {
            CreateWaitableTimerExW(
                null(),
                null(),
                flags,
                TIMER_MODIFY_STATE | SYNCHRONIZATION_SYNCHRONIZE,
            )
        })?;
        Ok(Self {
            changed,
            timer,
            #[cfg(any(feature = "e2e", test))]
            high_resolution: flags == CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
        })
    }

    #[cfg(any(feature = "e2e", test))]
    pub(crate) fn high_resolution(&self) -> bool {
        self.high_resolution
    }

    pub(crate) fn signal(&self) -> io::Result<()> {
        if unsafe { SetEvent(self.changed.as_raw_handle()) } == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    pub(crate) fn wait(&self, deadline: Option<Instant>) -> io::Result<()> {
        let result = if let Some(deadline) = deadline {
            let delay = deadline.saturating_duration_since(Instant::now());
            if delay.is_zero() {
                return Ok(());
            }
            let ticks = i64::try_from(delay.as_nanos().div_ceil(100)).unwrap_or(i64::MAX);
            let due = -ticks;
            if unsafe {
                SetWaitableTimerEx(self.timer.as_raw_handle(), &due, 0, None, null(), null(), 0)
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            let handles = [self.changed.as_raw_handle(), self.timer.as_raw_handle()];
            let result = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, INFINITE) };
            if result == WAIT_OBJECT_0 {
                unsafe {
                    CancelWaitableTimer(self.timer.as_raw_handle());
                }
            }
            result
        } else {
            unsafe { WaitForSingleObject(self.changed.as_raw_handle(), INFINITE) }
        };
        if result == WAIT_FAILED {
            Err(io::Error::last_os_error())
        } else if result == WAIT_OBJECT_0 || result == WAIT_OBJECT_0 + 1 {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "Unexpected terminal output wake result: {result}"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::{Duration, Instant};

    #[test]
    fn a_signal_before_waiting_is_not_lost() {
        let wake = Arc::new(DeadlineWake::new().unwrap());
        wake.signal().unwrap();
        let worker = wake.clone();
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            tx.send(worker.wait(None)).unwrap();
        });
        let result = rx.recv_timeout(Duration::from_secs(1));
        wake.signal().unwrap();
        thread.join().unwrap();
        result.unwrap().unwrap();
    }

    #[test]
    fn data_arrival_interrupts_a_later_batch_deadline() {
        let wake = Arc::new(DeadlineWake::new().unwrap());
        let worker = wake.clone();
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            tx.send(worker.wait(Some(Instant::now() + Duration::from_secs(10))))
                .unwrap();
        });
        wake.signal().unwrap();
        let result = rx.recv_timeout(Duration::from_secs(1));
        wake.signal().unwrap();
        thread.join().unwrap();
        result.unwrap().unwrap();
    }

    #[test]
    fn a_deadline_flushes_without_another_output_notification() {
        let wake = DeadlineWake::new().unwrap();
        let deadline = Instant::now() + Duration::from_millis(2);
        wake.wait(Some(deadline)).unwrap();
        assert!(Instant::now() >= deadline);
    }

    #[test]
    fn standard_timer_fallback_can_flush_a_deadline() {
        let wake = DeadlineWake::with_timer_flags(0).unwrap();
        let deadline = Instant::now() + Duration::from_millis(2);
        wake.wait(Some(deadline)).unwrap();
        assert!(!wake.high_resolution());
        assert!(Instant::now() >= deadline);
    }
}
