# Input editing and resource-sampling controls

Date: 2026-11-05. Benchmark source revision: `a5b8e41`. Executable SHA-256: `ffac22256bc51cf192b9822e361fc47231562b2a3fd2906bbdb95d6afb9e22e6`.

## Changes and run boundary

The approved [bounded plan](input-latency-next-step.md) is complete. One single-session sanity run and three paired 30-session comparisons used the same executable. Pair order was full/process, process/full, then full/process. No additional performance runs were used to select a favorable result.

The dedicated benchmark now substitutes only the saved input function inside Patty's existing PSConsoleHostReadLine wrapper. Console.ReadLine returns text to PowerShell, which executes the real probe commands. Command status markers, result handling, prompt, process, and transport remain in place. A counter verifies 20 actual commands in the single-session control and 40 in each 30-session control. The exact saved ScriptBlock is restored in a finally path. The earlier image-repair control was removed after its hypothesis had already failed.

The counter increment is extra work and extra input text in the control group. The difference from normal input is not a precise measurement of PSReadLine's isolated execution cost. These control results do not qualify as normal-editor acceptance.

The optional resource mode `process` skips GPU WMI queries but retains the same process-tree CPU and memory sampling. Full sampling remains the default. Missing GPU values are explicitly null. Before this correction, PowerShell could serialize an unassigned value as an empty object.

## Normal Shell results

All values are per-run p95 in milliseconds. Each idle and loaded group has 20 commands. Restoration groups use the original input editor in the same process. Stage percentiles cannot be added together.

| Pair and sampler | Initial idle | Initial loaded | Increase | Restored idle | Restored loaded | Increase |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 full | 33.4 | 44.4 | 11.0 | 31.4 | 61.4 | 30.0 |
| 1 process | 20.9 | 37.7 | 16.8 | 20.7 | 42.8 | 22.1 |
| 2 process | 19.3 | 44.4 | 25.1 | 21.5 | 44.9 | 23.4 |
| 2 full | 23.6 | 37.6 | 14.0 | 23.4 | 48.0 | 24.6 |
| 3 full | 21.1 | 33.1 | 12.0 | 21.3 | 44.0 | 22.7 |
| 3 process | 21.6 | 41.0 | 19.4 | 20.5 | 44.2 | 23.7 |

The first full-sampling groups meet the 16 ms increase target, but none of the restored-editor groups do. Selecting only the first groups would hide the remaining variation. Removing GPU queries does not make normal command latency meet the target consistently.

## Actual-command control

| Pair and sampler | Console.ReadLine with real commands, idle | Loaded | Increase |
| --- | ---: | ---: | ---: |
| 1 full | 20.9 | 42.6 | 21.7 |
| 1 process | 10.7 | 17.7 | 7.0 |
| 2 process | 9.7 | 19.6 | 9.9 |
| 2 full | 10.0 | 28.4 | 18.4 |
| 3 full | 8.5 | 26.8 | 18.3 |
| 3 process | 9.1 | 32.8 | 23.7 |

The simpler editor reduces idle latency in every comparison. Loaded latency still varies, and the real-command control itself exceeds the 16 ms increase target in four of six runs. The earlier non-executing echo control remains faster. Neither result justifies replacing the user's editor or attributing the whole remaining delay to PSReadLine.

Resource-sample intervals have medians of 2,319/2,334/2,404 ms in full mode and 1,965/1,975/1,985 ms in process mode. GPU queries add collection work, but removing them does not restore a 550 ms sample interval. Short-phase resource attribution remains limited. The process-tree WMI query and collector scheduling were not isolated by this experiment.

## Remaining boundary and checks

In the six initial loaded groups, write-return to ConPTY-read is the longest stage for 20/20, 19/20, 19/20, 19/20, 20/20, and 19/20 commands in run order. Input write-queue p95 stays between 0.063 and 0.089 ms, with write and flush p95 between 0.024 and 0.030 ms. These measurements do not support another input-queue rewrite.

The remaining stage still includes Shell input editing, Patty's own command classification, command execution and formatting, ConPTY, and reader scheduling. The results do not identify one of these as the complete cause. A subsequent product correction needs evidence inside that boundary, especially around the application-owned Shell integration. This comparison does not authorize another parameter sweep or a reduced acceptance threshold.

All seven runs passed output byte and event balance, full probe pairing, per-pane 128 KiB and global 1 MiB pending-byte limits, and final queue drain. All 29 background commands completed in each loaded 30-session phase. Initial background-command p95 was 4,065–4,211 ms. Burst throughput was about 3.0–4.1 MiB/s. The controls did not obtain foreground response by stopping background processes.

The shared PowerShell control passed a real ConPTY regression that executes commands, checks preserved command markers, rejects a wrong execution count, restores the original editor, and executes another command afterward. Analyzer and resource-mode tests passed five cases. The ordinary backend passed 301 tests and the E2E backend passed 308 tests, each with one opt-in notification-history test ignored; the frontend passed 872 tests. Type checking and the production frontend build passed. The production frontend contains none of the benchmark control strings. Hashes confirmed that the ordinary release executable and installed 2.0.18 executable were preserved. No benchmark application process remained after cleanup.

## Reproduction and artifacts

Raw reports are under `output/terminal-benchmark/input-controls/sanity/` and `pair-1-full/`, `pair-1-process/`, `pair-2-process/`, `pair-2-full/`, `pair-3-full/`, and `pair-3-process/`. `summary.json` records run order and the unmet normal-editor target. `previous-census.json` and `current-census.json` retain per-command actor counts and slow-sample stage durations.

Build the dedicated benchmark with `npm run build:benchmark`, preserving an existing ordinary release executable because the named Tauri build renames its output. The external collector mode is selected through `PATTY_BENCHMARK_RESOURCE_MODE=full` or `process`; choose a fresh `PATTY_BENCHMARK_OUTPUT` directory for every run. Execute `npm run benchmark:terminals -- 30` for one comparison run.

The report analyzer can be rerun against existing data without launching terminals:

```powershell
rtk node scripts/analyze-terminal-latency.mjs --out output/terminal-benchmark/input-controls/recheck.json output/terminal-benchmark/input-controls/pair-1-full/30-sessions.json
rtk node --test scripts/analyze-terminal-latency.test.mjs scripts/benchmark-processes.test.mjs
```

No production input, Shell integration, priority policy, queue size, or SSH transport was changed in this unit.
