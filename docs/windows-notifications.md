# Windows notifications

Patty sends a Windows notification when a live local agent asks for approval, asks for input, or reports an error while the application is in the background. Initial snapshots and completed work do not trigger notifications.

The Notifications settings page has an independent desktop switch and a test button. Tool switches still control CLI integration separately. Notifications contain the session title and attention type, without command contents or output.

## Delivery and activation

The backend checks the current agent revision, state, live session, saved preference, and native window focus before delivery. Each session has a 30-second cooldown; the application allows at most five notifications per minute. A session's notification replaces its previous notification. Resuming work or deleting the session removes its notification.

WinRT delivers a protocol-activated toast. The registered protocol accepts only an application target or a single session identifier. The existing single-instance handler brings Patty forward. A pending activation survives frontend initialization and is consumed once. Session selection uses the existing workspace and pane focus logic.

The application registers a current-user Start menu shortcut with its AppUserModelID and a stub toast activator CLSID. All toasts use protocol activation. Debug builds use a separate identifier and protocol. Benchmark builds do not register or deliver notifications.

Windows settings are queried after the first Show operation because querying a previously unseen identity returned ERROR_NOT_FOUND on the development machine. The operating system still controls notification blocking and Do Not Disturb.

Microsoft's [desktop toast requirements](https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid) describe the shortcut identity requirement. Microsoft's [stub CLSID guidance](https://learn.microsoft.com/en-us/answers/questions/1016/push-notification-in-uwp-after-covert) explains persistence with protocol activation.

## Verification

- Backend tests cover activation validation, XML escaping, focus and setting suppression, current-state matching, deduplication, and rate limits.
- Frontend tests cover initial snapshots, attention transitions, resolution, removal, disabled delivery, delayed startup activation, and selecting the target workspace.
- The opt-in Windows integration test sends a real notification with a unique test identity, reads its session activation URI from Windows notification history, removes the notification, and cleans up its own registration and shortcut.

```powershell
rtk cargo test --manifest-path src-tauri/Cargo.toml --features e2e --lib native_toast_is_saved_in_windows_notification_history -- --ignored --nocapture
```

Three initial attempts failed while reading a new identity's settings. The user approved shortcut registration. Shortcut registration alone reproduced that error; moving the settings query after Show passed the real notification-history test. The development machine's existing Patty registration was not changed.

Notification-center mouse clicks and cold process launches have not been manually exercised. The activation parser and frontend navigation are verified separately. macOS and Linux desktop delivery are not implemented.
