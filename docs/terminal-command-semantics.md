# Command status and results

Session details now show the current or most recent command's state, exit code, and elapsed time. The terminal work area and sidebar gain no permanent status elements.

## Implemented scope

Windows PowerShell 5.1 and PowerShell 7 emit OSC 133 prompt, input, command-start, and command-end markers. Patty wraps the existing prompt and PSConsoleHostReadLine function. Existing input bindings remain in place. Re-sourcing the integration does not wrap either function twice.

For a resolved native application, the result uses its LASTEXITCODE, including repeated nonzero values. PowerShell cmdlets and functions report the shell's success or failure as 0 or 1. The integration never resets LASTEXITCODE. Script or dynamic invocation failures without a reliable numeric result report an unknown exit code. Stopped commands are shown as interrupted.

The prompt captures command status before cursor repair and prompt rendering can overwrite it. The original prompt still receives its success or failure status. Input text, command arguments, and command output are not recorded in this metadata.

CMD, WSL, Git Bash, SSH, and interactive nested shells have no new integration in this change. Without verified markers the command state is Not reported. The separate [OSC 7501 program status](terminal-program-status.md) capability accepts explicit program reports on local and SSH output.

## State ownership

Each local PTY owns a stream parser and command tracker. The parser accepts OSC 133 with BEL or ST termination across read boundaries. Its retained control-string content is capped at 96 bytes. Unrelated OSC, DCS, APC, and PM strings cannot introduce nested command markers.

Output bytes still follow the existing ordered transport and xterm consumption acknowledgments. Metadata parsing does not remove or rewrite terminal output.

The backend allocates a new run identity for every process. Reattaching to a live process preserves its state. A replaced process keeps its own retired tracker and cannot modify its successor. End of output interrupts an unfinished command; the last result remains available until the tab is removed or a new process replaces it.

Session details query the typed snapshot every 250 ms while visible. Requests do not overlap. Closing the details panel, deleting its session, or hiding the application stops refreshes. Replies from a previous panel or deleted session are ignored. There is no per-output metadata event traffic.

Command markers are display metadata. They do not authorize input, resume, or queued execution.

## Verification

- Parser tests cover split markers, exact nonzero results, absent results, interruption, invalid and oversized strings, nested control strings, and process replacement.
- Real ConPTY tests run both installed PowerShell versions. They verify native exit 7, the following successful cmdlet, preservation of LASTEXITCODE, repeated exit 7, running state and duration, reattachment, cmdlet failure, Ctrl+C, and repeated integration loading.
- Separate PowerShell processes verify the original prompt receives a failure status and the original input function returns the same text.
- Real xterm tests verify markers remain invisible and preserve prompt text and cursor position.
- Component tests verify live elapsed time, unknown exit codes, actual nonzero values, panel cleanup, hidden-window suspension, and late responses after session deletion.

Microsoft's [PowerShell shell integration](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1) provides a reference for preserving the prompt and wrapping PSConsoleHostReadLine. Patty uses OSC 133 and independently resolves native result handling.

Reverting this feature removes the script changes, per-PTY tracker, snapshot command, and details fields. No persisted state is migrated.

On 2026-11-04, 832 frontend tests and 275 backend tests passed. The existing five boot-background palette assertions were excluded as previously documented. Type checking, the comment policy, workbench browser regression, and the Windows release desktop build also passed. The separate real Windows notification-history test passed for the notification feature.
