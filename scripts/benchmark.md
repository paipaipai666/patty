# Performance Benchmark Guide

## Quick Start

```bash
# 1. Install dependencies (if not done)
npm install

# 2. Run with perf instrumentation enabled
PATTY_PERF=1 npm run dev
```

All `[perf]` logs will appear in the **main process console** (the terminal where you ran `npm run dev`).

Renderer perf logs appear in **DevTools Console** (Ctrl+Shift+I → Console).

## Metrics Collected

| Metric | Log Prefix | What It Measures |
|--------|-----------|-----------------|
| App startup | `app:*` | `whenReady` → `ready-to-show` breakdown |
| Font enumeration | `fonts:enumerate` | `execSync` registry scan time |
| Shell detection | `shell:findPwsh` | `where.exe pwsh` spawn time |
| PTY creation | `pty:create` | `pty.spawn()` + setup time |
| IPC throughput | `pty:data:ipc` | PTY→renderer message count + rate/sec |
| State serialization | `state:serialize` | `JSON.stringify` time for persistence |
| State save IPC | `state:save-ipc` | IPC round-trip for state persistence |
| Memory (main) | `memory[*]` | RSS, heap, external every 30s |
| Memory (renderer) | `memory[*]` | JS heap (in DevTools console) |
| React renders | `TerminalPane[*]` | Re-render count per terminal pane |

## Benchmark Scenarios

### Scenario 1: Cold Start Baseline

1. `PATTY_PERF=1 npm run dev`
2. Wait for window to appear
3. Record from console:
   - `app:whenReady` — Electron init time
   - `app:hook-server` — Hook server startup
   - `app:create-window-to-show` — Window creation to visible
   - `app:total-startup` — Full startup time
   - `memory[startup]` — Baseline memory

### Scenario 2: Idle Memory (1 terminal)

1. After startup, wait 30s
2. Record `memory[periodic]` — idle memory with 1 terminal

### Scenario 3: Many Terminals (10 sessions)

1. Open 10 terminals (Ctrl+T × 10)
2. Wait 30s for memory to stabilize
3. Record:
   - `memory[periodic]` — memory with 10 terminals
   - `TerminalPane[*] render counts` — how many re-renders happened
   - Compare memory delta vs Scenario 2

### Scenario 4: High Throughput Output

1. In one terminal, run: `dir -Recurse C:\Windows\System32`
2. Watch for `pty:data:ipc rate:` logs
3. Record peak rate (messages/sec)
4. Note any UI lag or dropped frames

### Scenario 5: Shell Detection Cost

1. Open DevTools → Console
2. Run `window.terminalAPI.detectShells()` multiple times
3. Each call triggers `shell:findPwsh` in main console
4. Record time — should be near 0 if cached, ~50-200ms if not

### Scenario 6: Font Enumeration Cost

1. Open Settings (Ctrl+,)
2. Font dropdown triggers `system:getFonts` IPC
3. Record `fonts:enumerate` time — typically 500-2000ms

### Scenario 7: State Save Under Load

1. Open 10 terminals
2. Rapidly switch between them (Ctrl+1-9)
3. Watch `state:serialize` and `state:save-ipc` logs
4. Record serialization time and IPC time

## Recording Template

```
Date: YYYY-MM-DD
Machine: [CPU/RAM]
Build: dev / prod

Startup:
  app:whenReady:        ___ms
  app:hook-server:      ___ms
  app:create-window:    ___ms
  app:total-startup:    ___ms

Memory:
  startup (1 terminal): ___MB RSS
  idle (1 terminal):    ___MB RSS
  10 terminals:         ___MB RSS
  delta per terminal:   ___MB

Shell Detection:
  findPwsh (cold):      ___ms
  findPwsh (cached):    ___ms

Font Enumeration:
  getInstalledFonts:    ___ms

PTY:
  create (1st):         ___ms
  create (subsequent):  ___ms
  data rate (peak):     ___msg/s

State:
  serialize (10 sess):  ___ms
  save IPC:             ___ms

React:
  TerminalPane renders (idle 30s): ___
```

## Profiling (Optional)

For deeper analysis, use Chrome DevTools Protocol:

```bash
# Start with remote debugging
PATTY_PERF=1 npm run dev -- --remote-debugging-port=9222

# Then in Chrome: chrome://inspect → configure → localhost:9222
# Use Performance tab to record CPU profiles
# Use Memory tab for heap snapshots
```

## Production Comparison

```bash
# Build and test with perf enabled
PATTY_PERF=1 npm run build
PATTY_PERF=1 npx electron .
```

Compare dev vs prod numbers to account for Vite HMR overhead.
