# Native notification callback plan

Status: approved on 2026-11-04; completed on 2026-11-05. The user-run actual Patty build passed real notification clicking, system callbacks, warm and cold process activation, workspace and split focus, and invalid and deleted targets.

## Goal

Activate the requested existing session from a Windows toast, both while Patty is running and after it exits, without depending on Windows URI-handler discovery. Reuse the current session validation, pending activation, workspace selection, and terminal focus code.

Microsoft documents [INotificationActivationCallback and current-user LocalServer32 registration](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/win32_tile_badge_notif/respond-to-toast-activations). Its [COM component example](https://learn.microsoft.com/en-us/windows/apps/develop/cpp-winrt/author-coclasses) covers activation from both a visible toast and notification history.

## Non-goals

No resident service or separate installer process. No agent identity changes, notification text expansion, operating-system default changes, or production registration changes during testing. OSC 7501 is a separate approved ticket.

## Affected modules and ownership

- Native notification registration and XML: replace the stub callback identity with a real class factory and callback. Release, debug, and integration builds use separate class identities. Register only current-user entries belonging to Patty.
- Application startup and shutdown: host the callback in Patty's executable, preserve isolated fixture arguments on cold start, coordinate with the existing single-instance path, and revoke the class factory on shutdown. Validate callback identity and bounded session arguments before accepting activation.
- Existing pending activation and frontend hook: consume a typed application/session target exactly once. Preserve the tested cross-workspace and delayed-focus behavior.
- Dedicated integration build and runner: invoke the registered COM callback through Windows before requiring a manual toast click. Distinguish direct callback verification from actual notification-click verification.

Keep the existing external URI parser available for direct links; new notifications use foreground callback activation. Existing protocol notifications remain subject to the unresolved protocol registration issue until replaced or dismissed.

## Acceptance

Backend tests first reproduce invalid identity, malformed target, duplicate delivery, and callback lifecycle cases. A native callback invocation must reach the real application through Windows, select the target split, close settings, and focus its textarea. Repeat after the test process exits and prove a new process activated with isolated data. Reject deleted sessions and arguments containing commands. Then require one real notification-center click without a missing-application prompt.

Do not mark actual notification activation complete from XML, compilation, ShellExecute, or a direct callback invocation alone. Retain failed reports and stop after three documented failed implementation attempts.

## Rollback

Revert the callback commits and restore protocol XML. Remove only callback registrations whose executable and class identity match the reverted Patty build. Do not alter other applications' registrations or protected Windows association settings.

## Commits

1. `feat: host native Windows notification activation callbacks`: backend failing tests, isolated callback identities, current-user registration, class-factory lifetime, startup integration, and validated activation delivery.
2. `test: verify native notification callbacks across process restarts`: real COM activation, warm and cold startup, split-pane focus, missing and invalid targets, and exact test-owned cleanup.
3. `fix: activate Windows notifications through native callbacks`: switch new toasts to callbacks, verify a real click, and update notification status and verification documentation. Commit only after the stated acceptance passes.
