<div align="center">

![Patty Logo](logo/patty-icon.svg)

# Patty

A modern, minimal terminal manager for Windows with a sidebar layout.

> **Platform: Windows-only by design.** The backend deliberately uses Windows APIs (ConPTY, registry, WMI via PowerShell); do not add cross-platform abstraction layers.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![Tauri](https://img.shields.io/badge/tauri-2-24C8D8.svg)

</div>

## Features

- **Multi-tab Terminal** - Create and manage multiple terminal sessions with independent PTY processes
- **Collection System** - Organize terminals into nested folders with full drag-and-drop support
- **5 Shell Support** - PowerShell 7, Windows PowerShell, CMD, Git Bash, and WSL
- **Fully Customizable UI** - Dark/Light themes plus fully custom themes with visual color picker and JSON editor; import/export themes
- **Customizable Terminal** - Font family (with system font picker), font size (8-32), cursor style (block/underline/bar), cursor blink, terminal opacity (40-100%)
- **Resizable Sidebar** - Left or right positioning with session search/filter
- **Context Menus** - Rename, recolor, close sessions; create, rename, delete subcollections
- **Status Bar** - Shows active session name, shell type, current working directory, and PID
- **Configurable Shortcuts** - All keyboard shortcuts remappable in settings
- **Session Persistence** - Sessions, workspaces, pane layouts, and collections survive restarts with auto-save; state files written atomically
- **Split Panes & Workspaces** - Split any pane horizontally/vertically (tmux-style, inheriting cwd); sessions live in workspaces, drag between panes
- **SSH Sessions** - Connect to remote hosts over SSH (in-process russh, no external ssh.exe): saved profiles, `~/.ssh/config` import, password/public-key auth via in-app prompts, TOFU host-key verification, remote CPU/memory/network/disk monitor
- **Metrics Dashboard** - Local CPU/memory/GPU/process metrics sampled on demand (PowerShell counters, only while the dashboard is open)
- **AI Attention Notifications** - Visual indicators when Claude Code, OpenCode, Codex CLI, or Oh My Pi needs your input

## Screenshot

### Dark

<div align="center">

![Patty-dark](main-dark.png)

</div>

### Light

<div align="center">

![Patty-light](main-light.png)

</div>

## Supported Shells

| Shell | ID |
|-------|-----|
| PowerShell 7 | `pwsh` |
| Windows PowerShell | `powershell` |
| Command Prompt | `cmd` |
| Git Bash | `gitbash` |
| WSL | `wsl` |

SSH sessions use the `ssh` shell type. Host keys are verified TOFU-style against your `~/.ssh/known_hosts` plus Patty's own known_hosts, with an in-app trust prompt on first contact.

## AI Attention Notifications

Patty integrates with AI coding assistants to show colored visual indicators on sidebar items when they need your attention:

| Event | Color | Description |
|-------|-------|-------------|
| Permission Request | 🔵 Blue | Tool needs permission to run |
| Question | 🔵 Blue | AI is asking for clarification |
| Task Complete | 🟢 Green | AI finished responding |
| Error | 🔴 Red | Execution error occurred |

Notification events trigger an animated contribution-grid style effect and a colored glow on the session item.

### Supported AI Tools

- **Claude Code** - Via Notification/Stop/SessionStart/SessionEnd hooks (PowerShell hook script)
- **OpenCode** - Via plugin system (TypeScript plugin)
- **Codex CLI** - Via lifecycle hooks (PowerShell hook script)
- **Oh My Pi (omp)** - Via agent extension (TypeScript)

All four adapters translate native events into the shared wire vocabulary pinned by `resources/hook-protocol.json` — consumed by both the Rust hook server's consistency test and the adapters' contract tests, so a vocabulary drift fails CI instead of silently dimming the indicators.

### Configuration

Go to **Settings → Notifications** to enable or disable for each AI tool independently. Toggling a tool **off removes** Patty's hooks from that tool's config (Claude Code `settings.json`, Codex `hooks.json`, the OpenCode/omp plugin files); toggling on reinstalls them.

## Settings

The settings modal covers 6 categories:

| Category | Options |
|----------|---------|
| **Appearance** | Dark/Light/Custom themes, font family (system font picker), font size |
| **Terminal** | Cursor style (block/underline/bar), cursor blink, terminal opacity (40-100%), default shell |
| **Shortcuts** | Remap all keyboard shortcuts via key capture |
| **Layout** | Sidebar position (left/right) |
| **Notifications** | Toggle AI notifications for Claude Code, OpenCode, Codex CLI, and Oh My Pi independently |
| **SSH** | Manage saved SSH profiles (host/port/user/identity file), import from `~/.ssh/config` |

Custom themes can be edited visually with color pickers or directly as JSON, with import/export support.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New terminal |
| `Ctrl+W` | Close current terminal |
| `Ctrl+]` / `Ctrl+[` | Next / Previous terminal |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+1-9` | Jump to terminal by index |
| `Ctrl+Shift+D` | Split focused pane horizontally |
| `Ctrl+Shift+E` | Split focused pane vertically |
| `Ctrl+Shift+W` | Close focused pane |
| `Ctrl+C` | Copy selection in terminal, or send interrupt if no selection |
| `Ctrl+V` | Paste in terminal |
| `Ctrl+Shift+C` | Copy in terminal |
| `Ctrl+Shift+V` | Paste in terminal |

All shortcuts are remappable in Settings.

## Installation

### From Source

Prerequisites: Node.js 20+ and a stable Rust toolchain (1.85+, per `rust-version` in Cargo.toml).

```bash
# Clone the repository
git clone https://github.com/paipaipai666/patty.git
cd patty

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build Installer

```bash
# Package as NSIS installer
npm run package
```

The installer will be created in `src-tauri/target/release/bundle/nsis`.

## Tech Stack

- **Framework**: Tauri 2 (Rust backend + system WebView2)
- **Language**: TypeScript 5.7 (strict mode) + Rust (edition 2021)
- **UI**: React 18.3 + CSS Modules
- **Terminal**: xterm.js 5.5 (WebGL renderer with canvas fallback, Fit, WebLinks, Unicode11 addons)
- **PTY**: portable-pty (Windows ConPTY)
- **State**: Zustand 5
- **Packaging**: tauri-bundler (NSIS installer)

## Project Structure

```
patty/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Thin entry — delegates to lib.rs::run()
│   │   ├── lib.rs               # Window bootstrap, IPC command registration, startup wiring
│   │   ├── pty.rs               # PTY sessions (spawn/write/resize/kill, preheat, ConPTY DSR)
│   │   ├── sshconn.rs           # SSH sessions over russh (auth/host-key prompts, metrics channels)
│   │   ├── ssh.rs               # ~/.ssh/config import parser
│   │   ├── hooks.rs             # Hook HTTP server (loopback + per-process secret), heartbeat watchdog
│   │   ├── installer.rs         # AI-tool hook install/remove (Claude Code, OpenCode, Codex, omp)
│   │   ├── store.rs             # Settings/state JSON persistence (atomic writes, merge, validation)
│   │   ├── metrics.rs           # Local resource metrics (PowerShell counters, on-demand sampling)
│   │   └── fonts.rs             # System font enumeration (registry)
│   ├── tauri.conf.json          # Window, bundle (NSIS), resource mapping
│   └── capabilities/            # IPC permission set
├── src/
│   ├── renderer/                # React application
│   │   ├── api.ts               # window.terminalAPI shim over Tauri invoke/listen
│   │   ├── components/
│   │   │   ├── TitleBar/        # Custom frameless title bar
│   │   │   ├── Sidebar/         # Sidebar, session tree, collection tree
│   │   │   ├── Terminal/        # xterm.js terminal panes
│   │   │   ├── Pane/            # Split tree, sash, drag-drop targets
│   │   │   ├── StatusBar/       # Session info bar
│   │   │   ├── Settings/        # Settings modal (6 categories)
│   │   │   ├── SshMonitor/      # SSH remote metrics panel
│   │   │   ├── MetricsDashboard/ # Local metrics dashboard
│   │   │   ├── ContributionGrid/ # Animated AI activity indicator
│   │   │   └── App/             # ContextMenu, PromptDialog, Toasts
│   │   ├── store/               # Zustand stores (session, workspace, settings, toast, metrics)
│   │   ├── hooks/               # Shared React hooks
│   │   └── styles/              # Global CSS, theme definitions
│   └── shared/                  # Shared TypeScript types + pure normalizers
├── resources/                   # App icon, hook adapters (ps1/ts), hook-protocol.json (wire vocabulary)
├── scripts/shell-integration/   # Shell startup scripts injected into PTYs
├── e2e/                         # Release-binary smoke test + startup benchmark (CDP)
├── logo/                        # Logo assets
├── vite.config.ts
├── package.json
├── tsconfig.json
└── ...
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [xterm.js](https://xtermjs.org/) - Terminal emulator for the web
- [Tauri](https://v2.tauri.app/) - Build tiny, fast desktop apps with a web frontend
- [Zustand](https://github.com/pmndrs/zustand) - State management
