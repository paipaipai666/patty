# Native notification activation verification

Last updated: 2026-11-05

Completed: the actual dedicated Patty build passed a real Windows notification click, native COM callbacks, warm and cold activation, workspace and split focus, and invalid and deleted targets. The final report records status ok and manualClick true. Earlier sections preserve the failed attempts and hypotheses; they are not current blockers.

## Scope

The dedicated integration build uses com.patty.integration-test and patty-e2e. APPDATA, browser data, CLI integration files, and session fixtures are isolated. The installed Patty executable and normal notification registration are not changed.

The runner reads the real frontend's selected session, workspace, focused pane, actual textarea focus, and the native process/activation counters. A fixed operation enum replaces arbitrary script evaluation. Request and report files have 64 KiB limits.

## Attempts

1. The initial run did not produce its first frontend report. Inspection found the synchronous verification command reading WinRT notification history on the window thread. Moving that work to a blocking worker restored reports. A cleanup error had hidden the original timeout; cleanup now preserves the original error.
2. Native notification delivery, registered-protocol warm activation, cross-workspace selection, and closing settings passed. Cold activation did not converge on terminal focus. The production hook only attempted focus on the next frame. A regression with a delayed textarea reproduced the defect. The hook now observes terminal readiness and cancels on navigation or unmount.
3. A manual notification click was tested. The user confirmed clicking the notification. Windows removed the toast from history, but the application's activation counter stayed at 1, selection stayed on other, and settings remained open. The saved report is output/notification-activation/report.json. This was a real notification click, unlike the successful explicit protocol launch in attempt 2.

## Follow-up after approval

The user approved resolving the actual Programs known folder. The shortcut now uses SHGetKnownFolderPath(FOLDERID_Programs), and a backend regression verifies that overriding APPDATA cannot move it into the test fixture. Registry changes now broadcast SHCNE_ASSOCCHANGED.

Native Shell activation also exposed two application defects. Xterm's automatic protocol replies were treated as user input, which selected inactive panes and marked attention read. Modal cleanup could restore focus to a previously selected terminal after a notification selected another terminal. Cold startup also attempted textarea focus before the terminal existed. These have reproductions and frontend regressions; the corrected Shell activation suite passed warm and cold launches, split-pane focus, invalid arguments, and deleted targets.

The real notification click still failed. The user supplied a screenshot of Windows' missing-application dialog for patty-e2e, then confirmed that a subsequent click produced the same dialog.

## Protocol-resolution census

The previous premise was: a successful ShellExecute launch and AssocQueryStringW result prove that Windows notifications can activate the same protocol. The census disproves that premise.

| Actor or observation | Result |
| --- | --- |
| AssocQueryStringW with IS_PROTOCOL and VERIFY while the fixture is alive | Correct dedicated executable |
| ShellExecute through Start-Process | Warm and cold activation passed |
| Windows.System.Launcher.QueryUriSupportAsync while registration still exists | NotSupported |
| QueryUriSupportAsync for http and vscode | Available |
| Actual notification click | Windows missing-application dialog; no application activation |

The process running the probe is an unpackaged, non-elevated process under the same user as Explorer. Its merged HKEY_CLASSES_ROOT view contains the test command. The test keys inherit the same read permissions as vscode.

Temporary unique-protocol probes tested classic registration, application metadata, RegisteredApplications and URLAssociations capabilities, separate ProgIDs, executable registration, fresh querying processes, and a 60-second refresh interval. None changed WinRT support from NotSupported. All probe-specific registrations were removed. These probes identify the failing boundary; they do not establish why Windows rejects these new registrations.

Reproduce the read-only Windows launcher check while a dedicated fixture is running:

```powershell
rtk proxy powershell -NoProfile -File e2e/windows-uri.ps1
rtk proxy powershell -NoProfile -File e2e/windows-uri.ps1 -Uri vscode://session/target
```

At that stage the native runner required WinRT support before asking for a manual click. The subsequent COM implementation replaced that discovery gate with actual callback invocation. The previous Shell suite pass was not a notification-click pass. A transient Windows file-sharing failure also interrupted one manual wait; request-file replacement now retries only sharing-related errors for at most two seconds.

## Decision after the protocol attempts

The Start menu correction and association broadcast did not restore real click activation. The reason for Windows' protocol-resolution difference remains unresolved. Do not ask the user to repeat notification clicks under this registration.

The alternative was the documented COM activation callback hosted in Patty's own executable, with an actual system COM round trip before another manual notification click. The user approved the change in activation route. See [COM activation plan](notification-com-activation-plan.md). OSC 7501's independent-state, Hook-first plan remains approved and unimplemented.

## COM callback after approval

The user approved native COM callbacks. Backend TDD verifies the actual interface, bounded UTF-16 input, exact app identity, target validation, rejecting input payloads, class-factory registration, and revocation on drop. Callback class identities use UUID v5 derived from each build's notification identity.

Three native runs reached the cold-start gate:

1. Cross-process activation of the running application passed, including selecting the correct split and rejecting malformed arguments and another build's identity. Cold activation returned REGDB_E_CLASSNOTREG.
2. Registry diagnostics captured the correct LocalServer32 command before and after application exit. The 64-bit client sees it in Registry64; Registry32 has no entry. The same cold activation failed.
3. Replaced the .NET convenience activator with explicit CoCreateInstance(CLSCTX_LOCAL_SERVER). Warm activation and rejection checks still passed; cold activation still returned REGDB_E_CLASSNOTREG.

UAC is enabled and the diagnostic caller uses a medium-integrity token. The data does not show the registration disappearing on exit or a 32/64-bit client mismatch. The shared failing premise is now broader: a registration visible to the caller is necessarily available to the system activation broker. The callback remains incomplete, and toast XML still uses the previous protocol route. No further user click has been requested.

AGENTS.md's three-attempt rule requires escalation before another implementation or native rerun. Recommended: keep the passing callback implementation, inspect the actual user-class registry roots and activation context with read-only diagnostics, then isolate registration discovery in a minimal native executable before changing the application again. Do not modify system association defaults, elevate, or add machine-wide registrations as a workaround.

## Independent registration probe after approval

The user approved isolating Windows registration discovery. `e2e/notification-registration-probe.ps1` compiles a small .NET executable that hosts the Windows callback interface, registers only a unique temporary current-user CLSID, and removes its own process, registration, and temporary directory. It does not load Tauri, WebView, terminal code, or CLI integration settings.

- A warm callback succeeded; cold creation returned REGDB_E_CLASSNOTREG with the command still present.
- Repeating under COM activation tracing reproduced the same result. The permitted tracing provider did not identify the failing registry lookup. Kernel registry tracing returned Access Denied; no elevation was attempted and no trace session was started for that provider.
- A fresh CLSID with cold activation as its first operation, plus the documented ServerExecutable value, returned the same error. This excludes prior class-factory revocation and stale registration of the previous fixed CLSID as sufficient explanations.

Read-only `e2e/registry-context.ps1` confirms that HKCU Software\Classes and RegOpenUserClassesRoot resolve to the same actual user-classes hive. The caller is in the interactive session and is not in a job/silo.

The next control needs to run the standalone probe from a normal PowerShell window launched directly by the user. This distinguishes the tool execution ancestry from the Windows session itself. Further same-host retries are paused after the three independent probe runs. No system settings have been changed.

## User-run control reviewed on 2026-11-05

The user supplied a screenshot and the saved report from their directly launched PowerShell. Its cold activation returned CO_E_SERVER_EXEC_FAILURE (0x80080005), which differs from the tool-hosted REGDB_E_CLASSNOTREG result. The screenshot also contained an RTK non-UTF-8 console error. These are distinct observations; the screenshot does not prove that RTK caused COM activation to fail.

The callback client emitted localized Windows messages using the legacy console encoding. A regression that strictly decodes redirected stdout as UTF-8 failed with ERR_ENCODING_INVALID_ENCODED_DATA. Explicit UTF-8 output in the callback client makes the same regression pass. The independent probe now also emits UTF-8.

The probe's generated server now records entry arguments, its temporary directory, and any registration exception into its compiled-in test directory. This removes dependence on parsing the server's command line before diagnostic recording. A new user-run control has been requested without RTK so that these entry records can distinguish startup failure from callback registration failure. The tool-hosted control still reports class-not-registered without reaching the entry point; it cannot substitute for the user's different result.

The latest backend run passed 282 tests with one opt-in notification-history test ignored. Five existing color-baseline failures were excluded, as in earlier verification; no palette assertions were changed. Frontend type checking passed. Real notification clicks and cold activation remain incomplete.

## Actual Patty control passed on 2026-11-05

The user ran `e2e/check-native-notifications.ps1` from their normal PowerShell. The real dedicated Patty build passed system COM activation in both a running instance and a newly started instance, actual cross-workspace split-pane and textarea focus, modal closure, invalid arguments, another build's identity, and a deleted session. The output-encoding regression also passed. The saved report is `output/notification-activation/report.json`, with `status: ok` and `manualClick: false`.

This proves the actual callback implementation's cold start; the independent .NET probe's failure is not a valid blocker for Patty. The cause of that probe's binding failure and the tool-launched registration-discovery difference are not established. No operating-system settings were changed to obtain the pass.

The real user-run report also records QueryUriSupportAsync as Available for patty-e2e. The earlier NotSupported finding belongs to the tool execution path and must not be generalized to the user's normal Windows desktop. The approved native callback route is now independently verified through the real application.

The remaining acceptance is switching toast XML to foreground callback activation and verifying one actual notification-center click. Direct COM invocation alone does not complete that last acceptance.

## Final manual acceptance on 2026-11-05

The toast XML was changed to foreground callback activation after its regression first failed with the previous protocol XML. The dedicated application was rebuilt. The user then ran `e2e/check-native-notifications.ps1 -ManualClick`, clicked the newly delivered notification, and reported the full suite passing.

The actual saved report records `status: ok` and `manualClick: true`. Warm activation reached process 39140, target-workspace, target-pane and its textarea. Cold activation reached a new process, 26160, with the same correct workspace and split. The deleted-target check retained the other session. Invalid command arguments and another build's identity were rejected. The manual runner contains no automatic warm-activation fallback, so this result requires the real notification action.

The test processes exited and the dedicated registrations, notification history, shortcut, and temporary data were cleaned up. The production frontend build passed and contains no native-verification entry chunk. The tool execution and independent .NET probe differences remain diagnostic limitations; they no longer block the actual verified implementation.
