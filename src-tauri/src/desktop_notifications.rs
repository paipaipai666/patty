use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
mod callback;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    App,
    Session {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    Approval,
    Input,
    Error,
}

impl NoticeKind {
    fn status(self) -> crate::hooks::AgentStatus {
        use crate::hooks::AgentStatus;
        match self {
            Self::Approval => AgentStatus::WaitingApproval,
            Self::Input => AgentStatus::WaitingInput,
            Self::Error => AgentStatus::Error,
        }
    }

    fn body(self) -> &'static str {
        match self {
            Self::Approval => "Needs your approval",
            Self::Input => "Needs your input",
            Self::Error => "Reported an error",
        }
    }
}

#[derive(Default)]
struct DeliveryPolicy {
    panes: HashMap<String, (u64, u64)>,
    recent: VecDeque<u64>,
    shown: HashSet<String>,
}

impl DeliveryPolicy {
    fn accept(&mut self, pane: &str, revision: u64, _kind: NoticeKind, now: u64) -> bool {
        if self
            .panes
            .get(pane)
            .is_some_and(|(last, sent)| revision <= *last || now.saturating_sub(*sent) < 30_000)
        {
            return false;
        }
        while self
            .recent
            .front()
            .is_some_and(|sent| now.saturating_sub(*sent) >= 60_000)
        {
            self.recent.pop_front();
        }
        if self.recent.len() >= 5 {
            return false;
        }
        self.panes.insert(pane.into(), (revision, now));
        self.recent.push_back(now);
        true
    }
}

static POLICY: LazyLock<Mutex<DeliveryPolicy>> =
    LazyLock::new(|| Mutex::new(DeliveryPolicy::default()));
static PENDING: Mutex<Option<Target>> = Mutex::new(None);
#[cfg(feature = "e2e")]
static ACTIVATIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(feature = "e2e")]
pub(crate) fn verification_activation_count() -> u64 {
    ACTIVATIONS.load(std::sync::atomic::Ordering::Relaxed)
}

fn scheme(app: &AppHandle) -> &'static str {
    match app.config().identifier.as_str() {
        "com.patty.integration-test" => "patty-e2e",
        _ if cfg!(debug_assertions) => "patty-dev",
        _ => "patty",
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn activation(uri: &str, scheme: &str) -> Option<Target> {
    let value = uri.strip_prefix(scheme)?.strip_prefix("://")?;
    if value == "open" {
        return Some(Target::App);
    }
    let id = value.strip_prefix("session/")?;
    valid_id(id).then(|| Target::Session {
        session_id: id.into(),
    })
}

pub fn receive_activation(app: &AppHandle, args: impl IntoIterator<Item = String>) {
    #[cfg(feature = "e2e")]
    ACTIVATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if let Some(target) = args
        .into_iter()
        .find_map(|arg| activation(&arg, scheme(app)))
    {
        publish_target(app, target);
    }
}

fn publish_target(app: &AppHandle, target: Target) {
    *PENDING.lock().unwrap() = Some(target.clone());
    let _ = app.emit("desktop:activation", target);
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        if app.config().identifier == "com.patty.benchmark" {
            return Ok(());
        }
        if app.try_state::<callback::Host>().is_some() {
            return Ok(());
        }
        let handle = app.clone();
        let host = callback::Host::start(
            platform::identity(app),
            scheme(app).into(),
            std::sync::Arc::new(move |target| {
                let queued = handle.clone();
                handle
                    .run_on_main_thread(move || {
                        #[cfg(feature = "e2e")]
                        ACTIVATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        publish_target(&queued, target);
                        if let Some(window) = queued.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    })
                    .map_err(|error| {
                        windows::core::Error::new(
                            windows::Win32::Foundation::E_FAIL,
                            error.to_string(),
                        )
                    })
            }),
        )?;
        app.manage(host);
    }
    Ok(())
}

pub fn stop(app: &AppHandle) {
    #[cfg(windows)]
    if let Some(host) = app.try_state::<callback::Host>() {
        host.stop();
    }
}

#[tauri::command]
pub fn take_desktop_activation() -> Option<Target> {
    PENDING.lock().unwrap().take()
}

#[cfg(all(feature = "e2e", windows))]
pub(crate) fn verification_xml(app: &AppHandle) -> Result<Option<String>, String> {
    platform::verification_xml(app)
}

#[cfg(all(feature = "e2e", windows))]
pub(crate) fn verification_cleanup(app: &AppHandle) -> Result<(), String> {
    platform::verification_cleanup(app)
}

#[cfg(all(feature = "e2e", windows))]
pub(crate) fn verification_association(app: &AppHandle) -> Result<String, String> {
    platform::verification_association(app)
}

#[cfg(all(feature = "e2e", windows))]
pub(crate) fn verification_callback(app: &AppHandle) -> Option<(String, String)> {
    let identity = platform::identity(app);
    Some((format!("{{{:?}}}", callback::class_id(&identity)), identity))
}

#[cfg(all(feature = "e2e", not(windows)))]
pub(crate) fn verification_callback(_: &AppHandle) -> Option<(String, String)> {
    None
}

#[cfg(all(feature = "e2e", not(windows)))]
pub(crate) fn verification_association(_: &AppHandle) -> Result<String, String> {
    Err("Windows required".into())
}

#[cfg(all(feature = "e2e", not(windows)))]
pub(crate) fn verification_xml(_: &AppHandle) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(all(feature = "e2e", not(windows)))]
pub(crate) fn verification_cleanup(_: &AppHandle) -> Result<(), String> {
    Ok(())
}

fn eligible(
    enabled: bool,
    focused: bool,
    kind: NoticeKind,
    revision: u64,
    current: Option<crate::hook_state::AgentUpdate>,
) -> bool {
    enabled
        && !focused
        && current.is_some_and(|update| {
            update.revision == revision
                && update
                    .agent
                    .is_some_and(|agent| agent.status == kind.status())
        })
}

#[tauri::command]
pub async fn notify_attention(
    app: AppHandle,
    pane_id: String,
    title: String,
    kind: NoticeKind,
    revision: u64,
) -> Result<bool, String> {
    if !valid_id(&pane_id) {
        return Err("Invalid session".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut policy = POLICY.lock().unwrap();
        let enabled = crate::store::load_settings()["desktopNotifications"]
            .as_bool()
            .unwrap_or(true);
        let focused = app
            .get_webview_window("main")
            .is_none_or(|window| window.is_focused().unwrap_or(true));
        if !crate::pty::session_exists(&pane_id)
            || !eligible(
                enabled,
                focused,
                kind,
                revision,
                crate::hooks::agent_update(&pane_id),
            )
        {
            return Ok(false);
        }
        static START: LazyLock<Instant> = LazyLock::new(Instant::now);
        if !policy.accept(&pane_id, revision, kind, START.elapsed().as_millis() as u64) {
            return Ok(false);
        }
        let sent = platform::show(
            &app,
            Some(&pane_id),
            &title.chars().take(120).collect::<String>(),
            kind.body(),
        )?;
        if sent {
            policy.shown.insert(pane_id);
        }
        Ok(sent)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn dismiss_desktop_notification(app: AppHandle, pane_id: String) -> Result<(), String> {
    if !valid_id(&pane_id) {
        return Err("Invalid session".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut policy = POLICY.lock().unwrap();
        if !crate::pty::session_exists(&pane_id) {
            policy.panes.remove(&pane_id);
        }
        if !policy.shown.remove(&pane_id) {
            return Ok(());
        }
        platform::dismiss(&app, &pane_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn test_desktop_notification(
    app: AppHandle,
    pane_id: Option<String>,
) -> Result<bool, String> {
    if pane_id
        .as_deref()
        .is_some_and(|id| !valid_id(id) || !crate::pty::session_exists(id))
    {
        return Err("Session no longer available".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut policy = POLICY.lock().unwrap();
        if !crate::store::load_settings()["desktopNotifications"]
            .as_bool()
            .unwrap_or(true)
        {
            return Ok(false);
        }
        let sent = platform::show(
            &app,
            pane_id.as_deref(),
            "Patty notifications are ready",
            "Click to return to your terminal",
        )?;
        if sent {
            if let Some(id) = pane_id {
                policy.shown.insert(id);
            }
        }
        Ok(sent)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn toast_xml(uri: &str, title: &str, body: &str) -> String {
    fn escape(value: &str) -> String {
        value
            .chars()
            .filter(|c| *c >= ' ' || matches!(c, '\n' | '\r' | '\t'))
            .flat_map(|c| match c {
                '&' => "&amp;".chars().collect::<Vec<_>>(),
                '<' => "&lt;".chars().collect(),
                '>' => "&gt;".chars().collect(),
                '"' => "&quot;".chars().collect(),
                '\'' => "&apos;".chars().collect(),
                _ => vec![c],
            })
            .collect()
    }
    format!("<toast activationType=\"foreground\" launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>", escape(uri), escape(title), escape(body))
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_WRITE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    struct Apartment;
    impl Apartment {
        fn new() -> Result<Self, String> {
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|error| error.to_string())?;
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    fn write_registry(path: &str, values: &[(&str, &str)]) -> Result<(), String> {
        let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let mut key = std::ptr::null_mut();
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                wide(path).as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                std::ptr::null(),
                &mut key,
                std::ptr::null_mut(),
            )
        };
        if status != 0 {
            return Err(format!("Notification registration failed: {status}"));
        }
        let result = values.iter().try_for_each(|(name, value)| {
            let text = wide(value);
            let status = unsafe {
                RegSetValueExW(
                    key,
                    wide(name).as_ptr(),
                    0,
                    REG_SZ,
                    text.as_ptr().cast(),
                    (text.len() * 2) as u32,
                )
            };
            if status == 0 {
                Ok(())
            } else {
                Err(format!("Notification registration failed: {status}"))
            }
        });
        unsafe {
            RegCloseKey(key);
        }
        result
    }

    pub(super) fn identity(app: &AppHandle) -> String {
        let id = &app.config().identifier;
        if cfg!(debug_assertions) {
            format!("{id}.dev")
        } else {
            id.clone()
        }
    }

    fn register(app_id: &str, label: &str, protocol_scheme: &str) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        let arguments = String::new();
        #[cfg(feature = "e2e")]
        let arguments = if matches!(
            app_id,
            "com.patty.integration-test" | "com.patty.integration-test.dev"
        ) {
            crate::native_verification::protocol_arguments()?
        } else {
            arguments
        };
        let protocol = format!("Software\\Classes\\{protocol_scheme}");
        write_registry(
            &protocol,
            &[("", "URL:Patty session"), ("URL Protocol", "")],
        )?;
        write_registry(
            &format!("{protocol}\\shell\\open\\command"),
            &[("", &format!("\"{}\" {arguments} \"%1\"", exe.display()))],
        )?;
        write_registry(
            &format!("Software\\Classes\\AppUserModelId\\{app_id}"),
            &[
                ("DisplayName", label),
                (
                    "CustomActivator",
                    &format!("{{{:?}}}", callback::class_id(app_id)),
                ),
            ],
        )?;
        write_registry(
            &format!(
                "Software\\Classes\\CLSID\\{{{:?}}}\\LocalServer32",
                callback::class_id(app_id)
            ),
            &[(
                "",
                &format!(
                    "\"{}\" --notification-activation {arguments}",
                    exe.display()
                ),
            )],
        )?;
        register_shortcut(app_id, label, &exe)
            .map_err(|error| format!("Register notification shortcut: {error}"))?;
        association_changed();
        Ok(())
    }

    fn association_changed() {
        use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_FLUSH};
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, None, None);
        }
    }

    #[cfg(feature = "e2e")]
    pub(super) fn verification_association(app: &AppHandle) -> Result<String, String> {
        use windows::{
            core::{PCWSTR, PWSTR},
            Win32::UI::Shell::{
                AssocQueryStringW, ASSOCF_IS_PROTOCOL, ASSOCF_VERIFY, ASSOCSTR_EXECUTABLE,
            },
        };
        let name: Vec<_> = scheme(app).encode_utf16().chain(Some(0)).collect();
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        unsafe {
            AssocQueryStringW(
                ASSOCF_IS_PROTOCOL | ASSOCF_VERIFY,
                ASSOCSTR_EXECUTABLE,
                PCWSTR(name.as_ptr()),
                PCWSTR::null(),
                Some(PWSTR(buffer.as_mut_ptr())),
                &mut length,
            )
        }
        .ok()
        .map_err(|error| error.to_string())?;
        let end = buffer
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(buffer.len());
        String::from_utf16(&buffer[..end]).map_err(|error| error.to_string())
    }

    fn shortcut_path(label: &str) -> Result<std::path::PathBuf, String> {
        use windows::Win32::{
            System::Com::CoTaskMemFree,
            UI::Shell::{FOLDERID_Programs, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
        };
        let raw = unsafe { SHGetKnownFolderPath(&FOLDERID_Programs, KF_FLAG_DEFAULT, None) }
            .map_err(|error| error.to_string())?;
        let path =
            std::path::PathBuf::from(std::ffi::OsString::from_wide(unsafe { raw.as_wide() }));
        unsafe {
            CoTaskMemFree(Some(raw.0.cast()));
        }
        Ok(path.join(format!("{label}.lnk")))
    }

    #[test]
    fn notification_shortcut_uses_the_windows_start_menu_when_app_data_is_isolated() {
        let _guard = crate::store::TEST_ENV_LOCK.lock().unwrap();
        struct Restore(Option<std::ffi::OsString>);
        impl Drop for Restore {
            fn drop(&mut self) {
                match &self.0 {
                    Some(value) => std::env::set_var("APPDATA", value),
                    None => std::env::remove_var("APPDATA"),
                }
            }
        }
        let _restore = Restore(std::env::var_os("APPDATA"));
        let isolated = std::env::temp_dir().join("patty-e2e-shortcut-path");
        std::env::set_var("APPDATA", &isolated);
        let path = shortcut_path("Patty integration test").unwrap();
        assert!(
            !path.starts_with(&isolated),
            "The notification identity must be registered in the actual Windows Start menu"
        );
    }

    #[cfg(feature = "e2e")]
    pub(super) fn verification_xml(app: &AppHandle) -> Result<Option<String>, String> {
        let _apartment = Apartment::new()?;
        let history = ToastNotificationManager::History().map_err(|error| error.to_string())?;
        let notices = match history.GetHistoryWithId(&HSTRING::from(identity(app))) {
            Ok(notices) => notices,
            Err(error) if error.code().0 == 0x80070490u32 as i32 => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        if notices.Size().map_err(|error| error.to_string())? == 0 {
            return Ok(None);
        }
        notices
            .GetAt(0)
            .and_then(|notice| notice.Content())
            .and_then(|content| content.GetXml())
            .map(|xml| Some(xml.to_string()))
            .map_err(|error| error.to_string())
    }

    #[cfg(feature = "e2e")]
    pub(super) fn verification_cleanup(app: &AppHandle) -> Result<(), String> {
        use windows_sys::Win32::System::Registry::RegDeleteTreeW;
        let _apartment = Apartment::new()?;
        let _ = ToastNotificationManager::History()
            .and_then(|history| history.ClearWithId(&HSTRING::from(identity(app))));
        for path in [
            format!("Software\\Classes\\AppUserModelId\\{}", identity(app)),
            format!("Software\\Classes\\{}", scheme(app)),
            format!(
                "Software\\Classes\\CLSID\\{{{:?}}}",
                callback::class_id(&identity(app))
            ),
        ] {
            let path: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
            let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, path.as_ptr()) };
            if status != 0 && status != 2 {
                return Err(format!("Test registration cleanup failed: {status}"));
            }
        }
        association_changed();
        match std::fs::remove_file(shortcut_path(
            app.config().product_name.as_deref().unwrap_or("Patty"),
        )?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }

    fn register_shortcut(app_id: &str, label: &str, exe: &std::path::Path) -> Result<(), String> {
        use windows::{
            core::{Interface, PCWSTR},
            Win32::{
                Storage::EnhancedStorage::{
                    PKEY_AppUserModel_ID, PKEY_AppUserModel_ToastActivatorCLSID,
                },
                System::Com::{
                    CoCreateInstance, IPersistFile,
                    StructuredStorage::{InitPropVariantFromCLSID, PROPVARIANT},
                    CLSCTX_INPROC_SERVER, STGM_READWRITE,
                },
                UI::Shell::{IShellLinkW, PropertiesSystem::IPropertyStore, ShellLink},
            },
        };
        let path = shortcut_path(label)?;
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|error| error.to_string())?;
        let path_wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let exe_wide: Vec<_> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            let result = (|| -> windows::core::Result<()> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                let file: IPersistFile = link.cast()?;
                if path.exists() {
                    file.Load(PCWSTR(path_wide.as_ptr()), STGM_READWRITE)?;
                }
                link.SetPath(PCWSTR(exe_wide.as_ptr()))?;
                let props: IPropertyStore = link.cast()?;
                props.SetValue(&PKEY_AppUserModel_ID, &PROPVARIANT::from(app_id))?;
                props.SetValue(
                    &PKEY_AppUserModel_ToastActivatorCLSID,
                    &InitPropVariantFromCLSID(&callback::class_id(app_id))?,
                )?;
                props.Commit()?;
                file.Save(PCWSTR(path_wide.as_ptr()), true)
            })();
            result.map_err(|error| error.to_string())
        }
    }

    fn tag(id: &str) -> HSTRING {
        let hash = id.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ byte as u64).wrapping_mul(0x100000001b3)
        });
        HSTRING::from(format!("{hash:016x}"))
    }

    pub(super) fn show(
        app: &AppHandle,
        pane: Option<&str>,
        title: &str,
        body: &str,
    ) -> Result<bool, String> {
        if app.config().identifier == "com.patty.benchmark" {
            return Ok(false);
        }
        if app.try_state::<callback::Host>().is_none() {
            return Err("Windows notification callback is unavailable".into());
        }
        show_registered(
            &identity(app),
            app.config().product_name.as_deref().unwrap_or("Patty"),
            scheme(app),
            pane,
            title,
            body,
        )
    }

    fn show_registered(
        app_id: &str,
        label: &str,
        protocol_scheme: &str,
        pane: Option<&str>,
        title: &str,
        body: &str,
    ) -> Result<bool, String> {
        let _apartment = Apartment::new()?;
        register(app_id, label, protocol_scheme)?;
        let result = (|| -> Result<bool, String> {
            let check = |error: windows::core::Error| format!("Windows notification: {error}");
            let notifier =
                ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
                    .map_err(|error| format!("Create notifier: {error}"))?;
            let uri = match pane {
                Some(id) => format!("{protocol_scheme}://session/{id}"),
                None => format!("{protocol_scheme}://open"),
            };
            let doc = XmlDocument::new().map_err(check)?;
            doc.LoadXml(&HSTRING::from(toast_xml(&uri, title, body)))
                .map_err(|error| format!("Load notification XML: {error}"))?;
            let toast = ToastNotification::CreateToastNotification(&doc).map_err(check)?;
            toast.SetTag(&tag(pane.unwrap_or("test"))).map_err(check)?;
            toast.SetGroup(&HSTRING::from("attention")).map_err(check)?;
            notifier
                .Show(&toast)
                .map_err(|error| format!("Show notification: {error}"))?;
            Ok(notifier
                .Setting()
                .map_err(|error| format!("Read notification setting: {error}"))?
                == NotificationSetting::Enabled)
        })();
        result
    }

    #[test]
    #[ignore = "sends an actual Windows notification"]
    fn native_toast_is_saved_in_windows_notification_history() {
        use windows_sys::Win32::System::Registry::RegDeleteTreeW;
        let unique = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        let id = format!("com.patty.test.{unique}");
        let protocol = format!("patty-test-{unique}");
        struct Cleanup {
            id: String,
            protocol: String,
            label: String,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _apartment = Apartment::new().unwrap();
                let _ = ToastNotificationManager::History()
                    .and_then(|history| history.ClearWithId(&HSTRING::from(&self.id)));
                for path in [
                    format!("Software\\Classes\\AppUserModelId\\{}", self.id),
                    format!("Software\\Classes\\{}", self.protocol),
                    format!(
                        "Software\\Classes\\CLSID\\{{{:?}}}",
                        callback::class_id(&self.id)
                    ),
                ] {
                    let path: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
                    unsafe {
                        RegDeleteTreeW(HKEY_CURRENT_USER, path.as_ptr());
                    }
                }
                let _ = std::fs::remove_file(shortcut_path(&self.label).unwrap());
            }
        }
        let label = format!("Patty notification test {unique}");
        let _cleanup = Cleanup {
            id: id.clone(),
            protocol: protocol.clone(),
            label: label.clone(),
        };
        assert!(show_registered(
            &id,
            &label,
            &protocol,
            Some("p1"),
            "Patty notification test",
            "Verifying Windows delivery"
        )
        .unwrap());
        let _apartment = Apartment::new().unwrap();
        let history = ToastNotificationManager::History().unwrap();
        let deadline = Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let notices = history.GetHistoryWithId(&HSTRING::from(&id)).unwrap();
            if notices.Size().unwrap() > 0 {
                let xml = notices
                    .GetAt(0)
                    .unwrap()
                    .Content()
                    .unwrap()
                    .GetXml()
                    .unwrap()
                    .to_string();
                assert!(xml.contains(&format!("{protocol}://session/p1")));
                break;
            }
            assert!(
                Instant::now() < deadline,
                "Windows did not retain the delivered notification"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        history
            .RemoveGroupedTagWithId(&tag("p1"), &HSTRING::from("attention"), &HSTRING::from(&id))
            .unwrap();
        assert_eq!(
            history
                .GetHistoryWithId(&HSTRING::from(&id))
                .unwrap()
                .Size()
                .unwrap(),
            0
        );
    }

    pub(super) fn dismiss(app: &AppHandle, pane: &str) -> Result<(), String> {
        if app.config().identifier == "com.patty.benchmark" {
            return Ok(());
        }
        let _apartment = Apartment::new()?;
        ToastNotificationManager::History()
            .and_then(|history| {
                history.RemoveGroupedTagWithId(
                    &tag(pane),
                    &HSTRING::from("attention"),
                    &HSTRING::from(identity(app)),
                )
            })
            .map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub(super) fn show(_: &AppHandle, _: Option<&str>, _: &str, _: &str) -> Result<bool, String> {
        Ok(false)
    }
    pub(super) fn dismiss(_: &AppHandle, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreground_disabled_and_stale_requests_do_not_deliver() {
        use crate::hook_state::AgentUpdate;
        use crate::hooks::{AgentState, AgentStatus};
        let update = || {
            Some(AgentUpdate {
                pane_id: "p1".into(),
                revision: 3,
                agent: Some(AgentState {
                    ai_type: "codex",
                    status: AgentStatus::WaitingInput,
                }),
            })
        };
        assert!(eligible(true, false, NoticeKind::Input, 3, update()));
        assert!(!eligible(false, false, NoticeKind::Input, 3, update()));
        assert!(!eligible(true, true, NoticeKind::Input, 3, update()));
        assert!(!eligible(true, false, NoticeKind::Input, 2, update()));
        assert!(!eligible(true, false, NoticeKind::Error, 3, update()));
        assert!(!eligible(true, false, NoticeKind::Input, 3, None));
    }

    #[test]
    fn activation_only_accepts_the_registered_app_and_a_single_session_identifier() {
        assert_eq!(
            activation("patty://session/pane-1", "patty"),
            Some(Target::Session {
                session_id: "pane-1".into()
            })
        );
        assert_eq!(activation("patty://open", "patty"), Some(Target::App));
        for value in [
            "other://session/pane-1",
            "patty://session/",
            "patty://session/p1/run",
            "patty://session/p1?command=exit",
            "patty://session/p1#x",
        ] {
            assert_eq!(activation(value, "patty"), None);
        }
    }

    #[test]
    fn attention_delivery_is_deduplicated_and_limited_per_session_and_globally() {
        let mut policy = DeliveryPolicy::default();
        assert!(policy.accept("a", 1, NoticeKind::Input, 0));
        assert!(!policy.accept("a", 1, NoticeKind::Input, 40_000));
        assert!(!policy.accept("a", 2, NoticeKind::Input, 1_000));
        assert!(policy.accept("a", 3, NoticeKind::Input, 30_000));
        for (index, pane) in ["b", "c", "d"].into_iter().enumerate() {
            assert!(policy.accept(pane, index as u64 + 4, NoticeKind::Approval, 31_000));
        }
        assert!(!policy.accept("e", 7, NoticeKind::Error, 32_000));
        assert!(policy.accept("e", 8, NoticeKind::Error, 61_000));
    }

    #[test]
    fn notification_xml_keeps_titles_as_text_and_uses_native_activation() {
        let text = toast_xml("patty://session/a", "A < B & C", "Needs \"approval\"");
        assert!(text.contains("activationType=\"foreground\""));
        assert!(!text.contains("activationType=\"protocol\""));
        assert!(text.contains("launch=\"patty://session/a\""));
        assert!(text.contains("A &lt; B &amp; C"));
        assert!(!text.contains("< B"));
    }
}
