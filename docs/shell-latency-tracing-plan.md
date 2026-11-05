# Shell latency boundary tracing

Date: 2026-11-05. Status: approved and completed within the run budget. See the [measured results and decision](shell-latency-tracing-results.md). No production performance change is supported by this unit's evidence.

## Evidence

The [completed controls](input-latency-controls.md) leave most command latency between the native input write returning and the output marker being read from ConPTY. That interval includes application-owned Shell integration, input editing, command execution, output formatting, ConPTY, and reader scheduling. The existing reports cannot assign the entire interval to one component.

A local, non-interactive Windows PowerShell 5.1 check called the existing `__PattyResultKind` function after three warm-up calls. Each case had 30 samples:

| Command | Classification | Median ms | p95 ms | Maximum ms |
| --- | --- | ---: | ---: | ---: |
| `Write-Output 'probe'` | shell | 0.283 | 0.434 | 1.123 |
| `cmd.exe /c exit 7` | native | 1.645 | 2.043 | 4.064 |
| `pwd` | shell | 0.242 | 0.397 | 0.524 |
| `Get-Location; Write-Output 'probe'` | shell | 0.301 | 0.497 | 0.511 |

This check does not reproduce an interactive 30-session workload. It does not establish the classifier's loaded cost. It does show why changing its command-resolution semantics without a loaded measurement would be premature.

The current probe submits an entire command and waits for its output. It measures command turnaround, not the time for an individual key to appear. These measurements must keep those two user experiences distinct.

## 4+1 plan

1. Goal: locate the remaining delay within the real PowerShell path, then identify whether a product correction is supported. Keep the original editor, actual command execution, and existing output limits. Keep normal command turnaround as a separately reported metric.
2. Non-goals: do not replace PSReadLine, change installed Patty or user profiles, cache command resolution, change priorities or queue sizes, alter exit-code semantics, or modify SSH. Do not introduce a production tracing API. Do not relabel a diagnostic probe as a normal-editor performance pass.
3. Affected modules: add a benchmark-only PowerShell tracing helper beside `src/renderer/benchmark/readLineControl.ps1`; exercise that same helper in the real ConPTY tests in `src-tauri/src/pty.rs`; integrate bounded trace collection and phases in `src/renderer/benchmark/run.ts`; attach the isolated trace batches in the existing `src-tauri/src/benchmark.rs` report exchange; extend `scripts/analyze-terminal-latency.mjs` and its tests; record results in this document and the existing latency report. The external benchmark runner selects diagnostic phase order for the paired comparison.
4. Rollback: revert the tracing commits. Save and restore the exact original input and classification ScriptBlocks in finally paths. Use only disposable benchmark processes and synthetic probe IDs. Preserve the ordinary release executable during the dedicated benchmark build. Do not change persisted application data or the installed release.
5. Commits: first add failing behavioral tests and implement the shared tracing helper; next connect strict trace collection and analysis; finally record the bounded native results and a concrete correction or an explicit decision that the evidence does not support one. A cross-module production correction requires its own reviewable plan.

## Recorded boundaries

Record the following points in the foreground Shell:

- The saved input editor returns the command text.
- Patty command classification starts and returns.
- The actual synthetic command begins executing.
- The synthetic command's `Write-Output` call starts and returns.

Retain the existing native input-write and ConPTY-read timestamps. Record internal durations with a monotonic clock. Calibrate its relation to the report clock and retain the calibration uncertainty. Reject or mark cross-clock intervals that cannot be resolved within that uncertainty. Do not clamp a materially reversed interval to zero.

The interval before the editor returns still combines input delivery and editing. The interval after `Write-Output` still combines any remaining formatting, ConPTY work, and reader scheduling. The trace must use those names. It cannot claim to measure pure editor CPU time or pure ConPTY time.

Use memory buffers while commands run. Export a bounded JSON batch after each measured phase into the isolated benchmark directory and attach it to the existing final benchmark report. This keeps diagnostic data out of the measured VT stream and requires no new production IPC. Do not emit an extra trace message or write a file for every measured command. Export only synthetic IDs, stage timestamps, clock calibration, and validation results. Exclude command text, terminal history, working directories, and user content.

Limit storage and batch parsing explicitly. Pair every expected foreground probe with exactly one complete trace. Reject duplicate, missing, malformed, oversized, or incorrectly ordered traces. Preserve the existing terminal output byte accounting.

## Behavior checks

The ConPTY test must execute real commands with the normal editor. Check successful commands, failing commands, repeated native exit codes, and restoration after a diagnostic failure. The helper must preserve the existing outer Patty wrapper and restore the exact saved functions. A verification command after restoration must run through the original editor.

Compare uninstrumented normal probes before and after tracing. Include a comparison with trace recording disabled while retaining the same diagnostic command text. Report instrumentation overhead and command-length differences instead of subtracting an assumed constant.

Test report analysis with literal expected stage durations and invalid clock or pairing examples. Do not infer correctness from the helper returning a result or from the build succeeding.

## Native run budget and decision

Use one single-session sanity run and at most two 30-session runs. Reverse the order of recording-enabled and recording-disabled diagnostic phases in the second 30-session run. Keep the executable, workload, command count, sampler mode, and resource limits fixed. Use the existing default full sampler and retain its limited phase coverage in the report.

Run normal probes before and after the diagnostic phases. Preserve the existing 20 commands per input phase, background completion, byte and event balance, per-pane 128 KiB and global 1 MiB pending-byte limits, and final queue drain checks. Stop for an invalid measurement contract instead of spending the budget on repeated runs of broken instrumentation.

At the end, report which measured boundaries account for the slow individual commands. Select a production correction only when the evidence identifies an application-owned cause and its semantics can be preserved. If the unresolved time remains in the combined host or console boundary, stop this round with that limitation. Do not begin another parameter sweep, change the acceptance threshold, or claim that a faster synthetic command completes the normal Shell target.
