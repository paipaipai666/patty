# Windows notifications

Patty sends a Windows notification when an agent or a cooperating OSC 7501 program asks for approval, asks for input, or reports an error while the application is in the background. Initial snapshots and completed work do not trigger notifications. Authenticated Hook state takes priority over program reports.

The Notifications settings page has an independent desktop switch and a test button. Tool switches still control CLI integration separately. Notifications contain the session title and attention type, without command contents or output.

## Delivery and activation

The backend checks the current source revision, state, saved preference, and native window focus before delivery. Agent requests require their live local session. Program requests require their current run identity and no active Hook record; retained errors can be delivered after process exit. Each session has a 30-second cooldown; the application allows at most five notifications per minute. Hook and program sources have independent revision sequences and share these limits. A session's notification replaces its previous notification. Resuming work, clearing a report, a Hook takeover, or deleting the session removes its notification. Delivery and dismissal are serialized per pane.

WinRT delivers a foreground-activated toast. Windows calls Patty's INotificationActivationCallback through its registered local COM class factory. The callback validates the notification identity and bounded session arguments before queuing an application or session target. It does not execute a URI or commands. A pending activation survives frontend initialization and is consumed once. Session selection uses the existing workspace and pane focus logic, and waits for the target terminal's textarea before focusing it.

The application registers a current-user Start menu shortcut with its AppUserModelID and a real toast activator CLSID. The Programs known folder comes from the Windows Shell API, independently of APPDATA. LocalServer32 points to Patty's own executable so Windows can start it after it exits. The class factory runs in one blocked worker thread and is revoked on application exit. No resident service is required. Release, debug, and integration identities have distinct callback CLSIDs. Benchmark builds do not register or deliver notifications. The existing external URI parser remains available for direct application links.

Windows settings are queried after the first Show operation because querying a previously unseen identity returned ERROR_NOT_FOUND on the development machine. The operating system still controls notification blocking and Do Not Disturb.

Microsoft's [desktop toast requirements](https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid) describe the shortcut identity requirement. Its [native activation guidance](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/win32_tile_badge_notif/respond-to-toast-activations) describes the callback and current-user COM registration.

## Verification

- Backend tests cover activation validation, callback identity and input limits, class-factory registration and revocation, XML escaping, focus and setting suppression, current-state matching, deduplication, and rate limits.
- Frontend tests cover initial snapshots, attention transitions, resolution, removal, disabled delivery, delayed startup activation, and selecting the target workspace.
- The dedicated integration build sends a real notification, verifies a system COM callback across warm and cold starts, checks actual workspace, split and textarea focus, rejects invalid arguments and another build's identity, and handles deleted sessions. It cleans up its dedicated registration, shortcut, processes, and temporary files.

```powershell
rtk cargo test --manifest-path src-tauri/Cargo.toml --features e2e --lib native_toast_is_saved_in_windows_notification_history -- --ignored --nocapture
```

Three initial attempts failed while reading a new identity's settings. The user approved shortcut registration. Shortcut registration alone reproduced that error; moving the settings query after Show passed the real notification-history test. The development machine's existing Patty registration was not changed.

On 2026-11-05 the user-run dedicated build passed both automated COM activation and an actual Windows notification click. The manual report records status ok and manualClick true, with different process IDs for warm and cold activation. The verification wrapper runs from any working directory:

```powershell
powershell.exe -NoProfile -File "D:\code\terminal\terminal-sidebar\e2e\check-native-notifications.ps1" -ManualClick
```

The tool execution path returned different discovery results from the user's desktop. The independent .NET probe's cold-start failure is not evidence of a failure in Patty; the actual application was verified separately. The full evidence and corrected conclusions are in [native verification](native-notification-verification.md). macOS and Linux desktop delivery are not implemented.

The dedicated application also passed [OSC 7501 program delivery and dismissal](terminal-program-status.md), using actual program output and the existing native notification target. That check is available through the same wrapper with `-ProgramStatus`; warm and cold activation remain covered by the separate notification verification.
