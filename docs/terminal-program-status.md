# Program status

Patty accepts OSC 7501 revision 0.4 from local terminals and SSH output, including standard error. A cooperating build, deployment, or other program can report its state without changing terminal text or introducing a permanent header.

## Presentation and source priority

Programs report idle, working, done, blocked, or error. Working and blocked records can include percentage progress. A blocked record can identify a permission request, question, or authentication request.

The existing sidebar marker, notification button, attention filters, and Next session needing attention command use these reports. Session details and the delayed preview show the selected program's name, task, message, status, and progress. Text is rendered as plain text. Program metadata does not rename the session or identify an Agent.

An authenticated Hook record always takes priority for activity and notifications, including idle and unknown Hook states. Program records remain independently available in details. Removing a Hook can reveal an existing program report, but does not replay that report as a new Windows notification.

Reading a report acknowledges it without changing its runtime state. A waiting or failed program still qualifies for attention after reading. Finished results leave the default notification list after acknowledgment. Acknowledgments last for the current process run and are not persisted.

## Records and lifecycle

Each attached process run owns its records. Reattaching preserves them. Replacing the process starts an empty run, and an old reader cannot publish over the replacement. The frontend subscribes before loading its snapshot and merges newer events by pane revision, preserving other panes from the snapshot.

Reports completely replace the record with the same identifier. Clearing an identifier also clears its descendants at slash boundaries. A missing identifier addresses the root record. Application names inherit from the nearest ancestor. Selection prefers blocked, error, working, done, and idle in that order, with the most recently updated record breaking a tie.

OSC 133 prompt-start and output EOF discard working and blocked records. Done and error results remain available. A full terminal reset clears all records. A soft reset or alternate-screen transition preserves them. Explicit session deletion removes the run. Application restart does not restore program records.

Command boundaries, exit codes, and elapsed time are a separate [command status capability](terminal-command-semantics.md). OSC 7501 does not infer a program's state from screen text or authorize commands, input, or queued execution.

## Limits and transport

- A complete escape sequence is limited to 4,096 bytes. A run retains at most 256 records and evicts the least recently updated record when full.
- Identifiers are limited to 128 bytes, eight levels, and 32 bytes per segment. Keys are limited to 16 lowercase ASCII characters.
- Title limits are 256 encoded bytes and 192 decoded bytes. Message limits are 2,732 encoded bytes and 2,048 decoded bytes.
- Base64 accepts correct full padding or no padding. Invalid base64, invalid UTF-8, decoded controls, or a field exceeding its limit rejects the entire report. Unicode format characters are removed before display outside the terminal grid.
- BEL and ST termination work across read boundaries. Nested control strings cannot introduce reports. Ordinary output remains byte-for-byte unchanged.
- Capability responses contain only the fixed supported-state and blocked-kind list. A run can have one queued or writing response; repeated queries share that response until the writer consumes it.
- One shared publisher sleeps while idle and coalesces updates by pane into batches at most every 50 milliseconds. Ordinary output and identical reports produce no metadata event.

The [protocol fixture corpus](../src/shared/__fixtures__/program-status.json) is shared by the Rust parser and actual xterm tests.

## Windows notifications

Fresh blocked and error transitions use the existing [Windows notification delivery](windows-notifications.md). Initial snapshots, progress-only updates, completed results, and hidden reports do not create desktop notifications.

The backend independently checks the canonical run, revision, state, Hook priority, saved setting, and native window focus. Deleted sessions and replaced runs invalidate old requests. A retained error can be delivered after process exit. Hook and program requests have separate revision sequences and share the session cooldown and application-wide rate limit.

Resuming, clearing, deleting, or replacing the visible source dismisses the old notification. Frontend delivery is serialized per pane so a delayed dismissal cannot remove a replacement notification. All sources use the same validated native callback and workspace selection path.

## Verification

On 2026-11-05, the dedicated Windows application passed real ConPTY output, sidebar attention, command-palette keyboard navigation into the target split, program details, malformed-report rejection, prompt cleanup, reset, Windows error delivery, and notification dismissal. The saved local report is `output/program-status/report.json`.

The first run reached Windows delivery but reused a session already inside its 30-second cooldown. The corrected test uses a separate session for error delivery and preserves the product rate limit.

The existing wrapper selects this repeatable verification with `-ProgramStatus`:

```powershell
powershell.exe -NoProfile -File "D:\code\terminal\terminal-sidebar\e2e\check-native-notifications.ps1" -ProgramStatus
```

The wrapper uses the dedicated debug integration executable. Its finite operations accept named output samples and isolated fixture terminals, and reject arbitrary commands. Test data, CLI configuration, and WebView data are isolated. Cleanup removes only the test identity, shortcut, processes, and temporary data.

Rust tests also exercise a real localhost SSH connection, standard error, fixed capability replies, process exit, old-reader races, and burst coalescing. The shared fixture tests feed actual xterm one UTF-8 byte at a time and check visible text, cursor position, and generated input. Frontend tests cover snapshot races, Hook conflicts, acknowledgments, notification ordering, and keyboard navigation.

Final checks passed 872 frontend tests and 302 backend tests. The backend run excluded the five previously documented boot-background palette assertions and left one opt-in notification-history test ignored. Type checking, the production frontend build, and the normal non-E2E Rust build check passed. The production frontend contains none of the native verification controls.

The source-selection decision and rollback scope are recorded in the [approved plan](program-status-plan.md). Protocol references are the [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status) and [Otty's OSC 7501 reference](https://docs.otty.sh/vt/osc/osc-7501).
