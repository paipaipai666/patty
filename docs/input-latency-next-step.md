# Input latency: bounded control plan

Date: 2026-11-05. Status: awaiting approval for the new benchmark controls. Installed release 2.0.18 acceptance is complete.

## Evidence and premise

The premise to check is that the remaining 30-session latency comes from application input or output scheduling. Input queue measurements, shared parsing budgets, and precise batch deadlines have not established that premise for the remaining delay.

Reanalysis of `output/terminal-benchmark/precise-deadline/round-1/30-sessions.json` through `round-3/30-sessions.json` counted the largest stage of each actual command:

| Phase, 20 commands per run | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Idle commands: largest stage is write-return to ConPTY read | 20 | 20 | 20 |
| Background output: same stage | 18 | 19 | 19 |
| Shell restored after echo control: same stage | 18 | 19 | 17 |

That stage includes interactive line editing, actual command execution, Shell integration, ConPTY, and reader scheduling. The existing Console.ReadLine echo control bypasses command execution. Its speed does not prove which of those components causes the normal-command delay.

Resource sampling also needs a control. Recorded intervals have medians of 2,548, 2,416, and 2,499 milliseconds, despite a 550-millisecond sleep in the collector. The short idle-input phases contain zero, one, and one resource samples. This makes resource attribution weak. It does not prove the sampler causes input latency.

## 4+1 plan

1. Goal: identify whether line editing or resource sampling accounts for the remaining delay before selecting another product change. Preserve the existing target: loaded input p95 at most 16 milliseconds above the same run's idle input, with at most 1 MiB pending output.
2. Non-goals: do not change installed Patty, user profiles, production input editing, process priority, queue sizes, Shell result semantics, or SSH. A simpler input function is a diagnostic control, not a product fallback or performance pass.
3. Affected modules: add a rerunnable analyzer for existing raw reports; replace the already-excluded image-repair experiment in `src/renderer/benchmark/run.ts` with a command-executing line-editor control; add an optional process-only resource mode in `scripts/benchmark-terminals.mjs` and `scripts/benchmark-processes.ps1`; update the input-latency evidence. Tests cover the actual control and resource-mode selection without creating a production API.
4. Rollback: revert the benchmark and analyzer commits. Controls exist only in the dedicated benchmark build. Preserve the ordinary release executable while building the named benchmark executable. Temporary Shell state is restored in finally paths and belongs to disposable benchmark processes. No persisted data changes.
5. Commits: first record the actor census as a rerunnable report analyzer; then add and verify the two controls; finally record the bounded comparison and choose a product correction only if its cause is supported. A new cross-module production correction receives its own concrete plan.

## Line-editor control

The benchmark preserves the existing Patty PSConsoleHostReadLine wrapper, command execution, prompt, and command markers. In its foreground process only, save `__PattyShellState.OriginalReadLine`, temporarily replace that saved input function with `[Console]::ReadLine()`, and restore the exact saved ScriptBlock.

Both normal and control phases execute the same real PowerShell probe commands. An independent counter verifies that commands ran; an echo loop cannot satisfy this check. Idle and loaded phases are measured before the control and after restoration. The production wrapper is not removed. Normal editing remains the acceptance path.

## Sampler control and run budget

Keep the current full resource collector as the default. The process-only variant skips the GPU WMI queries while retaining process-tree CPU and memory sampling. Record the selected variant, actual sample intervals, and phase coverage. Missing GPU data remains unknown rather than zero.

Use one single-session sanity run and at most three paired 30-session comparisons. Alternate variant order across pairs. Keep the executable, workload, byte limits, and command count identical. Save raw reports separately. Stop for a broken measurement contract instead of silently dropping unmatched probes or adjusting thresholds.

Each comparison retains output byte and event balance, probe pairing, background command completion, throughput, switching, and final queue drain checks. A fast synthetic input control cannot mark normal Shell performance complete.

If neither control explains the delay, report that result and the remaining stage boundaries. Do not start another parameter sweep without a supported hypothesis.
