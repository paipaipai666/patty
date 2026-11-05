use super::{activation, Target};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use windows::{
    core::{implement, IUnknown, Interface, Ref, BOOL, GUID, PCWSTR},
    Win32::{
        Foundation::{CLASS_E_NOAGGREGATION, E_INVALIDARG, E_POINTER},
        System::Com::{
            CoInitializeEx, CoRegisterClassObject, CoRevokeClassObject, CoUninitialize,
            IClassFactory, IClassFactory_Impl, CLSCTX_LOCAL_SERVER, COINIT_MULTITHREADED,
            REGCLS_MULTIPLEUSE,
        },
        UI::Notifications::{
            INotificationActivationCallback, INotificationActivationCallback_Impl,
            NOTIFICATION_USER_INPUT_DATA,
        },
    },
};

type Deliver = Arc<dyn Fn(Target) -> windows::core::Result<()> + Send + Sync>;

pub(super) fn class_id(app_id: &str) -> GUID {
    GUID::from_u128(
        uuid::Uuid::new_v5(
            &uuid::Uuid::from_u128(0x033b5702_036a_4c2d_9a1e_0505796a1122),
            app_id.as_bytes(),
        )
        .as_u128(),
    )
}

type Worker = (mpsc::Sender<()>, JoinHandle<()>);

pub(super) struct Host(Mutex<Option<Worker>>);

struct Apartment;

impl Apartment {
    fn new() -> windows::core::Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok()?;
        Ok(Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

impl Host {
    pub(super) fn start(app_id: String, scheme: String, deliver: Deliver) -> Result<Self, String> {
        let (stop, stopped) = mpsc::channel();
        let (ready, started) = mpsc::sync_channel(1);
        let thread = std::thread::Builder::new()
            .name("notification-callback".into())
            .spawn(move || {
                let registration = (|| -> windows::core::Result<_> {
                    let apartment = Apartment::new()?;
                    let factory: IClassFactory = Factory {
                        callback: Callback {
                            app_id: app_id.clone().into(),
                            scheme: scheme.into(),
                            deliver,
                        },
                    }
                    .into();
                    let cookie = unsafe {
                        CoRegisterClassObject(
                            &class_id(&app_id),
                            &factory,
                            CLSCTX_LOCAL_SERVER,
                            REGCLS_MULTIPLEUSE,
                        )
                    }?;
                    Ok((apartment, factory, cookie))
                })();
                match registration {
                    Ok((_apartment, _factory, cookie)) => {
                        let _ = ready.send(Ok(()));
                        let _ = stopped.recv();
                        let _ = unsafe { CoRevokeClassObject(cookie) };
                    }
                    Err(error) => {
                        let _ = ready.send(Err(error.to_string()));
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        match started.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(Self(Mutex::new(Some((stop, thread))))),
            Ok(Err(error)) => Err(error),
            Err(error) => Err(format!("Notification callback startup failed: {error}")),
        }
    }

    pub(super) fn stop(&self) {
        if let Some((stop, thread)) = self.0.lock().unwrap().take() {
            let _ = stop.send(());
            let _ = thread.join();
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.stop();
    }
}

#[implement(IClassFactory)]
struct Factory {
    callback: Callback,
}

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<'_, IUnknown>,
        iid: *const GUID,
        result: *mut *mut std::ffi::c_void,
    ) -> windows::core::Result<()> {
        if result.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe {
            *result = std::ptr::null_mut();
        }
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        if iid.is_null() {
            return Err(E_POINTER.into());
        }
        let callback: INotificationActivationCallback = self.callback.clone().into();
        unsafe { callback.query(iid, result) }.ok()
    }

    fn LockServer(&self, _: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
#[implement(INotificationActivationCallback)]
struct Callback {
    app_id: Arc<str>,
    scheme: Arc<str>,
    deliver: Deliver,
}

impl INotificationActivationCallback_Impl for Callback_Impl {
    fn Activate(
        &self,
        app_id: &PCWSTR,
        arguments: &PCWSTR,
        _: *const NOTIFICATION_USER_INPUT_DATA,
        count: u32,
    ) -> windows::core::Result<()> {
        if count != 0 || unsafe { bounded_text(*app_id, 256)? } != self.app_id.as_ref() {
            return Err(E_INVALIDARG.into());
        }
        let argument = unsafe { bounded_text(*arguments, 256)? };
        let target = activation(&argument, &self.scheme)
            .ok_or_else(|| windows::core::Error::from(E_INVALIDARG))?;
        (self.deliver)(target)
    }
}

unsafe fn bounded_text(value: PCWSTR, limit: usize) -> windows::core::Result<String> {
    if value.is_null() {
        return Err(E_INVALIDARG.into());
    }
    for length in 0..=limit {
        if unsafe { *value.0.add(length) } == 0 {
            return String::from_utf16(unsafe { std::slice::from_raw_parts(value.0, length) })
                .map_err(|_| E_INVALIDARG.into());
        }
    }
    Err(E_INVALIDARG.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    #[test]
    fn native_callback_delivers_a_validated_session_target() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let callback: INotificationActivationCallback = Callback {
            app_id: "com.patty.integration-test".into(),
            scheme: "patty-e2e".into(),
            deliver: Arc::new(move |target| {
                sink.lock().unwrap().push(target);
                Ok(())
            }),
        }
        .into();
        let identity = wide("com.patty.integration-test");
        let argument = wide("patty-e2e://session/target");
        unsafe { callback.Activate(PCWSTR(identity.as_ptr()), PCWSTR(argument.as_ptr()), &[]) }
            .unwrap();
        assert_eq!(
            *received.lock().unwrap(),
            vec![Target::Session {
                session_id: "target".into()
            }]
        );
    }

    #[test]
    fn native_callback_rejects_other_apps_commands_unbounded_text_and_input_payloads() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let callback: INotificationActivationCallback = Callback {
            app_id: "com.patty.integration-test".into(),
            scheme: "patty-e2e".into(),
            deliver: Arc::new(move |target| {
                sink.lock().unwrap().push(target);
                Ok(())
            }),
        }
        .into();
        for (identity, argument) in [
            ("com.patty.app".into(), "patty-e2e://session/target".into()),
            (
                "com.patty.integration-test".into(),
                "patty://session/target".into(),
            ),
            (
                "com.patty.integration-test".into(),
                "patty-e2e://session/target?run=exit".into(),
            ),
            (
                "com.patty.integration-test".into(),
                "patty-e2e://session/".into(),
            ),
            (
                "com.patty.integration-test".into(),
                format!("patty-e2e://session/{}", "x".repeat(300)),
            ),
            ("x".repeat(300), "patty-e2e://open".into()),
        ] {
            let identity = wide(&identity);
            let argument = wide(&argument);
            assert_eq!(
                unsafe {
                    callback.Activate(PCWSTR(identity.as_ptr()), PCWSTR(argument.as_ptr()), &[])
                }
                .unwrap_err()
                .code(),
                E_INVALIDARG
            );
        }
        let identity = wide("com.patty.integration-test");
        let argument = wide("patty-e2e://open");
        assert!(
            unsafe { callback.Activate(PCWSTR::null(), PCWSTR(argument.as_ptr()), &[]) }.is_err()
        );
        assert!(
            unsafe { callback.Activate(PCWSTR(identity.as_ptr()), PCWSTR::null(), &[]) }.is_err()
        );
        assert!(unsafe {
            callback.Activate(
                PCWSTR(identity.as_ptr()),
                PCWSTR(argument.as_ptr()),
                &[NOTIFICATION_USER_INPUT_DATA::default()],
            )
        }
        .is_err());
        let invalid_utf16 = [0xd800, 0];
        assert!(unsafe {
            callback.Activate(
                PCWSTR(identity.as_ptr()),
                PCWSTR(invalid_utf16.as_ptr()),
                &[],
            )
        }
        .is_err());
        assert!(received.lock().unwrap().is_empty());
        unsafe { callback.Activate(PCWSTR(identity.as_ptr()), PCWSTR(argument.as_ptr()), &[]) }
            .unwrap();
        assert_eq!(*received.lock().unwrap(), vec![Target::App]);
    }

    #[test]
    fn callback_identities_are_stable_and_separate_for_release_debug_and_integration() {
        let identities = [
            "com.patty.app",
            "com.patty.app.dev",
            "com.patty.integration-test",
            "com.patty.integration-test.dev",
        ];
        let ids: std::collections::HashSet<_> =
            identities.iter().map(|id| class_id(id).to_u128()).collect();
        assert_eq!(ids.len(), 4);
        assert_eq!(
            class_id("com.patty.app"),
            class_id(&String::from("com.patty.app"))
        );
    }

    #[test]
    fn callback_host_is_available_through_windows_com_and_revoked_on_drop() {
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
            COINIT_MULTITHREADED,
        };
        let id = format!("com.patty.callback-unit.{}", std::process::id());
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let host = Host::start(
            id.clone(),
            "patty-unit".into(),
            Arc::new(move |target| {
                sink.lock().unwrap().push(target);
                Ok(())
            }),
        )
        .unwrap();
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .unwrap();
        let callback: INotificationActivationCallback =
            unsafe { CoCreateInstance(&class_id(&id), None, CLSCTX_LOCAL_SERVER) }.unwrap();
        let identity = wide(&id);
        let argument = wide("patty-unit://session/native-target");
        unsafe { callback.Activate(PCWSTR(identity.as_ptr()), PCWSTR(argument.as_ptr()), &[]) }
            .unwrap();
        assert_eq!(
            *received.lock().unwrap(),
            vec![Target::Session {
                session_id: "native-target".into()
            }]
        );
        drop(callback);
        drop(host);
        let missing: windows::core::Result<INotificationActivationCallback> =
            unsafe { CoCreateInstance(&class_id(&id), None, CLSCTX_LOCAL_SERVER) };
        assert!(missing.is_err());
        unsafe { CoUninitialize() };
    }
}
