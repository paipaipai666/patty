use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialRequest {
    pub enabled: bool,
    pub appearance: Appearance,
    pub background: [u8; 3],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MaterialMode {
    Solid,
    Mica,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SystemPreferences {
    transparency: bool,
    high_contrast: bool,
    battery_saver: bool,
}

fn material_mode(
    request: MaterialRequest,
    preferences: Option<SystemPreferences>,
    apply: impl FnOnce() -> bool,
) -> MaterialMode {
    if request.enabled
        && preferences
            .is_some_and(|value| value.transparency && !value.high_contrast && !value.battery_saver)
        && apply()
    {
        MaterialMode::Mica
    } else {
        MaterialMode::Solid
    }
}

#[derive(Default)]
pub struct MaterialCache(
    std::sync::Mutex<
        Option<(
            String,
            MaterialRequest,
            Option<SystemPreferences>,
            MaterialMode,
        )>,
    >,
);

pub fn set(
    window: &tauri::WebviewWindow,
    cache: &MaterialCache,
    request: MaterialRequest,
) -> Result<MaterialMode, String> {
    let preferences = if request.enabled {
        platform::preferences()
    } else {
        None
    };
    let mut state = cache.0.lock().map_err(|error| error.to_string())?;
    if let Some((label, previous, system, mode)) = state.as_ref() {
        if label == window.label() && previous == &request && system == &preferences {
            return Ok(*mode);
        }
    }
    *state = None;
    window
        .set_theme(Some(match request.appearance {
            Appearance::Light => tauri::Theme::Light,
            Appearance::Dark => tauri::Theme::Dark,
        }))
        .map_err(|error| error.to_string())?;
    let [r, g, b] = request.background;
    window
        .set_background_color(Some(tauri::window::Color(r, g, b, 255)))
        .map_err(|error| error.to_string())?;
    let mode = material_mode(request, preferences, || {
        platform::apply(window, request.appearance)
    });
    if mode == MaterialMode::Mica {
        if let Err(error) = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0))) {
            platform::clear(window);
            return Err(error.to_string());
        }
    } else {
        platform::clear(window);
    }
    *state = Some((window.label().to_owned(), request, preferences, mode));
    Ok(mode)
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{Appearance, SystemPreferences};
    use std::{ffi::c_void, mem::size_of, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::{ERROR_SUCCESS, HWND},
        Graphics::Dwm::{
            DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMSBT_MAINWINDOW, DWMSBT_NONE,
            DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE,
        },
        System::{
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
            Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
        },
        UI::{
            Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW},
            Controls::MARGINS,
            WindowsAndMessaging::{SystemParametersInfoW, SPI_GETHIGHCONTRAST},
        },
    };

    pub fn preferences() -> Option<SystemPreferences> {
        let key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0"
            .encode_utf16()
            .collect();
        let name: Vec<u16> = "EnableTransparency\0".encode_utf16().collect();
        let mut transparency = 0u32;
        let mut bytes = size_of::<u32>() as u32;
        let mut contrast = HIGHCONTRASTW {
            cbSize: size_of::<HIGHCONTRASTW>() as u32,
            dwFlags: 0,
            lpszDefaultScheme: null_mut(),
        };
        let mut power = SYSTEM_POWER_STATUS {
            ACLineStatus: 255,
            BatteryFlag: 255,
            BatteryLifePercent: 255,
            SystemStatusFlag: 0,
            BatteryLifeTime: u32::MAX,
            BatteryFullLifeTime: u32::MAX,
        };
        unsafe {
            if RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_DWORD,
                null_mut(),
                &mut transparency as *mut _ as *mut c_void,
                &mut bytes,
            ) != ERROR_SUCCESS
                || SystemParametersInfoW(
                    SPI_GETHIGHCONTRAST,
                    contrast.cbSize,
                    &mut contrast as *mut _ as *mut c_void,
                    0,
                ) == 0
                || GetSystemPowerStatus(&mut power) == 0
            {
                return None;
            }
        }
        Some(SystemPreferences {
            transparency: transparency == 1,
            high_contrast: contrast.dwFlags & HCF_HIGHCONTRASTON != 0,
            battery_saver: power.SystemStatusFlag == 1,
        })
    }

    pub fn apply(window: &tauri::WebviewWindow, appearance: Appearance) -> bool {
        let Ok(handle) = window.hwnd() else {
            return false;
        };
        apply_handle(handle.0, appearance)
    }

    fn apply_handle(handle: HWND, appearance: Appearance) -> bool {
        let margins = MARGINS {
            cxLeftWidth: -1,
            cxRightWidth: -1,
            cyTopHeight: -1,
            cyBottomHeight: -1,
        };
        let dark = i32::from(appearance == Appearance::Dark);
        unsafe {
            DwmSetWindowAttribute(
                handle,
                DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
                &dark as *const _ as *const c_void,
                size_of::<i32>() as u32,
            ) >= 0
                && DwmExtendFrameIntoClientArea(handle, &margins) >= 0
                && DwmSetWindowAttribute(
                    handle,
                    DWMWA_SYSTEMBACKDROP_TYPE as u32,
                    &DWMSBT_MAINWINDOW as *const _ as *const c_void,
                    size_of::<i32>() as u32,
                ) >= 0
        }
    }

    pub fn clear(window: &tauri::WebviewWindow) {
        if let Ok(handle) = window.hwnd() {
            let margins = MARGINS {
                cxLeftWidth: 0,
                cxRightWidth: 0,
                cyTopHeight: 0,
                cyBottomHeight: 0,
            };
            unsafe {
                DwmSetWindowAttribute(
                    handle.0,
                    DWMWA_SYSTEMBACKDROP_TYPE as u32,
                    &DWMSBT_NONE as *const _ as *const c_void,
                    size_of::<i32>() as u32,
                );
                DwmExtendFrameIntoClientArea(handle.0, &margins);
            }
        }
    }

    #[cfg(test)]
    mod native_tests {
        use super::*;
        use windows_sys::Win32::{
            System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
            UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_OVERLAPPEDWINDOW},
        };

        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }

        #[test]
        fn applies_native_mica_when_the_host_supports_the_documented_backdrop_api() {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let title: Vec<u16> = "Patty material verification\0".encode_utf16().collect();
            let handle = unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    title.as_ptr(),
                    WS_OVERLAPPEDWINDOW,
                    0,
                    0,
                    240,
                    160,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                )
            };
            assert!(
                !handle.is_null(),
                "Create the private native verification window"
            );
            let window = TestWindow(handle);
            let key: Vec<u16> = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0"
                .encode_utf16()
                .collect();
            let name: Vec<u16> = "CurrentBuildNumber\0".encode_utf16().collect();
            let mut value = [0u16; 32];
            let mut bytes = size_of_val(&value) as u32;
            let result = unsafe {
                RegGetValueW(
                    HKEY_LOCAL_MACHINE,
                    key.as_ptr(),
                    name.as_ptr(),
                    RRF_RT_REG_SZ,
                    null_mut(),
                    value.as_mut_ptr() as *mut c_void,
                    &mut bytes,
                )
            };
            assert_eq!(result, ERROR_SUCCESS);
            let build: u32 =
                String::from_utf16(&value[..value.iter().position(|value| *value == 0).unwrap()])
                    .unwrap()
                    .parse()
                    .unwrap();
            let dark = apply_handle(window.0, Appearance::Dark);
            let light = apply_handle(window.0, Appearance::Light);
            assert_eq!(dark, build >= 22621);
            assert_eq!(light, build >= 22621);
            eprintln!(
                "Native material verification: Windows build {build}, dark={dark}, light={light}"
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::{Appearance, SystemPreferences};
    pub fn preferences() -> Option<SystemPreferences> {
        None
    }
    pub fn apply(_: &tauri::WebviewWindow, _: Appearance) -> bool {
        false
    }
    pub fn clear(_: &tauri::WebviewWindow) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> MaterialRequest {
        MaterialRequest {
            enabled: true,
            appearance: Appearance::Dark,
            background: [27, 29, 32],
        }
    }

    #[test]
    fn default_material_policy_is_auto() {
        assert_eq!(
            crate::store::default_settings()["windowMaterial"],
            serde_json::json!("auto")
        );
    }

    fn preferences() -> SystemPreferences {
        SystemPreferences {
            transparency: true,
            high_contrast: false,
            battery_saver: false,
        }
    }

    #[test]
    fn uses_mica_only_after_a_successful_native_application() {
        assert_eq!(
            material_mode(request(), Some(preferences()), || true),
            MaterialMode::Mica
        );
        assert_eq!(
            material_mode(request(), Some(preferences()), || false),
            MaterialMode::Solid
        );
    }

    #[test]
    fn respects_system_accessibility_transparency_and_power_preferences() {
        for settings in [
            None,
            Some(SystemPreferences {
                transparency: false,
                ..preferences()
            }),
            Some(SystemPreferences {
                high_contrast: true,
                ..preferences()
            }),
            Some(SystemPreferences {
                battery_saver: true,
                ..preferences()
            }),
        ] {
            assert_eq!(
                material_mode(request(), settings, || panic!(
                    "Native material must not be applied"
                )),
                MaterialMode::Solid
            );
        }
    }

    #[test]
    fn uses_solid_when_the_page_requests_no_effect() {
        assert_eq!(
            material_mode(
                MaterialRequest {
                    enabled: false,
                    ..request()
                },
                Some(preferences()),
                || panic!("Native material must not be applied")
            ),
            MaterialMode::Solid
        );
    }

    #[test]
    fn rejects_invalid_material_requests_at_the_command_boundary() {
        for value in [
            serde_json::json!({"enabled":true,"appearance":"unknown","background":[0,0,0]}),
            serde_json::json!({"enabled":true,"appearance":"dark","background":[0,256,0]}),
            serde_json::json!({"enabled":true,"appearance":"dark","background":[0,0]}),
            serde_json::json!({"enabled":true,"appearance":"dark","background":[0,0,0],"opacity":0.5}),
        ] {
            assert!(serde_json::from_value::<MaterialRequest>(value).is_err());
        }
    }
}
