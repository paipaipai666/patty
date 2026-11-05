# Shell latency boundary results

Date: 2026-11-05. Source revision: `65a8ab0`. Benchmark executable SHA-256: `2795865c3d904457d9597b30c1a7c0ae6f87eef3dd1f076c61c3fb17dc508386`.

## Decision

The [approved tracing plan](shell-latency-tracing-plan.md) is complete. One single-session sanity run and two 30-session runs used the same executable and full resource sampler. The second 30-session run reversed the recorded and recording-disabled diagnostic groups. No extra native comparison runs were used.

The evidence does not support changing command classification or the output queue. In the two recorded background phases, the largest stage for all 40 probes is before the saved editor returns. A second substantial interval remains between classification returning and the first diagnostic command beginning. That interval includes Patty's remaining wrapper work and PowerShell dispatch. These boundaries do not identify one implementation as the cause of normal input latency.

No production performance change follows from this unit. P3-02 and P3-04 retain their unmet normal-Shell latency status. This round stops at its approved run limit.

## Normal command turnaround

Each group contains 20 commands. All values below are p95 milliseconds. These probes run the original editor without diagnostic functions before installation and after exact restoration.

| Run and group | Idle | Background output | Increase |
| --- | ---: | ---: | ---: |
| 1, before tracing | 23.8 | 44.9 | 21.1 |
| 1, after restoration | 39.7 | 53.3 | 13.6 |
| 2, before tracing | 22.8 | 35.8 | 13.0 |
| 2, after restoration | 22.1 | 33.9 | 11.8 |

One of these four groups exceeds the 16 ms increase target. The earlier controls also contain repeated failures. The newer passing groups do not establish consistent acceptance, and selecting only them would hide the remaining variation. Absolute idle turnaround also varies.

## Recorded Shell spans

These diagnostic commands retain the original editor and execute real `Write-Output` calls. They add three diagnostic function calls and a longer input line. They are different workloads from the normal probes above.

Each cell is an independent stage p95 in milliseconds. Percentiles cannot be added to reconstruct a command's total.

| Stage | Run 1 idle | Run 1 loaded | Run 2 idle | Run 2 loaded |
| --- | ---: | ---: | ---: | ---: |
| Input write return to editor return | 24.94 | 35.98 | 25.20 | 47.46 |
| Editor return to classification start | 0.46 | 0.32 | 0.30 | 0.32 |
| Patty command classification | 0.70 | 0.56 | 0.73 | 0.99 |
| Classification return to command start | 15.21 | 22.67 | 13.51 | 27.84 |
| Command start to output call | 0.21 | 0.22 | 0.18 | 0.26 |
| Output call start to ConPTY read | 0.44 | 0.65 | 0.46 | 0.64 |

The first stage combines input delivery and editing. It does not measure PSReadLine CPU time alone. The interval after classification combines the remaining application wrapper, command dispatch, and the diagnostic function entry. The final stage combines output formatting, console processing, and reader scheduling. These results do not justify attributing all delay to PSReadLine, PowerShell, or ConPTY.

The input-delivery-and-editing interval is unambiguously largest for 20/20 loaded commands in each run. Idle groups have 19/20 commands with that interval largest. The remaining idle command is dominated by classification-to-execution in run 1 and is ambiguous within the measured bounds in run 2.

Cross-clock uncertainty is about 0.047/0.00024 ms for run 1's idle/loaded phases and 0.049/0.00061 ms for run 2. Internal intervals use one monotonic clock. The analyzer retains cross-clock lower and upper bounds and does not clamp small negative estimates to zero.

For all 100 recorded commands across the sanity and comparison runs, the reader receives the output marker before the Shell's `Write-Output` call returns. That call's duration overlaps the read boundary. It is reported separately rather than added as another serial stage. Its loaded p95 is 0.87 ms in both 30-session runs.

## Diagnostic overhead and limits

Recording-enabled and recording-disabled groups use the same longer command text and diagnostic function calls. Disabled recording still retains the installed wrappers. It is not an unmodified normal-command baseline.

| Run and load | Recording enabled p95 | Recording disabled p95 | Observed difference |
| --- | ---: | ---: | ---: |
| 1 idle | 44.8 | 49.0 | -4.2 |
| 1 loaded | 57.3 | 57.0 | 0.3 |
| 2 idle | 49.1 | 33.0 | 16.1 |
| 2 loaded | 83.8 | 68.9 | 14.9 |

The difference varies with run and order. It does not establish one fixed instrumentation cost that can be subtracted from normal latency. The longer diagnostic input also changes editor work. Stage measurements locate time in the recorded workload, but they do not supply an exact decomposition of the shorter normal command.

The single-session sanity run produced 20 complete traces. Normal input p95 was 23.6 ms initially and 32.5 ms after restoration. Diagnostic recording-enabled and disabled groups were 47.5 and 50.3 ms. This was a measurement-contract check, not normal-input acceptance.

## Output and behavior checks

All three runs passed complete native probe pairing, trace pairing, byte and event balance, and final queue drain. Each of the four loaded input phases per 30-session run completed all 29 background commands. Their background-command p95 ranged from 4.08 to 4.25 seconds. Burst throughput was about 3.51 and 3.86 MiB/s.

The 30-session peak global queues were 1,048,536 and 1,048,499 bytes, within 1 MiB. Peak per-pane queues were 131,072 and 130,911 bytes, within 128 KiB. Total dispatched and received bytes matched at 21,603,971 and 21,601,262 bytes respectively. Event counts matched at 13,680 and 13,814.

Resource sampling remains sparse. The full sampler's interval medians were 2,318 and 2,256 ms. Most input phases contain one resource sample and loaded phases two. This report does not assign input latency to a sampled process or GPU activity.

The shared helper passed real ConPTY tests with Windows PowerShell 5.1 and PowerShell 7. Tests execute successful commands, retain repeated native exit code 7, retain cmdlet failure code 1, reject an invalid export count, restore the exact saved functions after failure, and execute another command through the original editor. The analyzer rejects missing, duplicate, oversized, incomplete, reversed, and out-of-calibration traces. It also tests overlapping output and clock uncertainty against literal durations.

The ordinary backend passed 302 tests and the E2E backend passed 311, each with one opt-in notification-history test ignored. All 872 frontend tests and eight Node analyzer and sampler tests passed. Type checking, the comments check, the production frontend build, and the dedicated benchmark build passed. Production frontend output excludes the tracing controls. Ordinary release and installed 2.0.18 executable hashes were preserved. No benchmark process remained after cleanup.

## Artifacts and reproduction

Raw reports are in `output/terminal-benchmark/shell-tracing/sanity/`, `round-1-record-first/`, and `round-2-control-first/`. `analysis.json` retains per-command Shell intervals, cross-clock bounds, dominant-stage counts, and resource coverage.

Build the dedicated executable with `npm run build:benchmark`, preserving the ordinary release executable as described in the plan. Use fresh `PATTY_BENCHMARK_OUTPUT` directories. Keep `PATTY_BENCHMARK_RESOURCE_MODE=full`. Select order with `PATTY_BENCHMARK_TRACE_ORDER=record-first` or `control-first`. Run `npm run benchmark:terminals -- 1` for the sanity case and `-- 30` for a comparison. These commands reproduce an experiment and are not authorization for another sweep.

Reanalyze existing reports without launching terminals:

```powershell
rtk node scripts/analyze-terminal-latency.mjs --out output/terminal-benchmark/shell-tracing/recheck.json output/terminal-benchmark/shell-tracing/sanity/1-sessions.json output/terminal-benchmark/shell-tracing/round-1-record-first/30-sessions.json output/terminal-benchmark/shell-tracing/round-2-control-first/30-sessions.json
rtk node --test scripts/analyze-terminal-latency.test.mjs scripts/benchmark-processes.test.mjs
```
