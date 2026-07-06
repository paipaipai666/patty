<div align="center">

![Patty Logo](logo/patty-icon.svg)

# Patty

A modern, minimal terminal manager for Windows with a sidebar layout.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)
![Electron](https://img.shields.io/badge/electron-33-47848F.svg)

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
- **Session Persistence** - Sessions and collections survive restarts with auto-save
- **AI Attention Notifications** - Visual indicators when Claude Code, OpenCode, or Codex CLI needs your input

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

- **Claude Code** - Via Notification and Stop hooks (PowerShell hook script)
- **OpenCode** - Via plugin system (TypeScript plugin)
- **Codex CLI** - Via lifecycle hooks (PowerShell hook script)

### Configuration

Go to **Settings → Notifications** to enable or disable for each AI tool independently.

> When disabled, external config files (Claude Code `settings.json`, OpenCode plugin directory, Codex CLI `hooks.json`) will not be modified.

## Settings

The settings modal covers 5 categories:

| Category | Options |
|----------|---------|
| **Appearance** | Dark/Light/Custom themes, font family (system font picker), font size |
| **Terminal** | Cursor style (block/underline/bar), cursor blink, terminal opacity (40-100%), default shell |
| **Shortcuts** | Remap all keyboard shortcuts via key capture |
| **Layout** | Sidebar position (left/right) |
| **Notifications** | Toggle AI notifications for Claude Code, OpenCode, and Codex CLI independently |

Custom themes can be edited visually with color pickers or directly as JSON, with import/export support.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New terminal |
| `Ctrl+W` | Close current terminal |
| `Ctrl+]` / `Ctrl+[` | Next / Previous terminal |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+1-9` | Jump to terminal by index |
| `Ctrl+C` | Copy selection in terminal, or send interrupt if no selection |
| `Ctrl+V` | Paste in terminal |
| `Ctrl+Shift+C` | Copy in terminal |
| `Ctrl+Shift+V` | Paste in terminal |

All shortcuts are remappable in Settings.

## Installation

### From Source

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

The installer will be created in the `dist` directory.

## Tech Stack

- **Framework**: Electron 33 + electron-vite 2.3
- **Language**: TypeScript 5.7 (strict mode)
- **UI**: React 18.3 + CSS Modules
- **Terminal**: xterm.js 5.5 (WebGL renderer, Fit, WebLinks, Unicode11 addons)
- **Backend**: node-pty 1.0 (Windows ConPTY)
- **State**: Zustand 5
- **Packaging**: electron-builder 25 (NSIS installer)

## Project Structure

```
patty/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry point, window creation
│   │   ├── ipcHandlers.ts       # All IPC handlers
│   │   ├── ptyManager.ts        # PTY session management + hook server
│   │   ├── settingsHandler.ts   # Settings persistence with migration
│   │   ├── stateHandler.ts      # Session state persistence
│   │   └── hookInstaller.ts     # Claude Code / OpenCode hook installer
│   ├── preload/
│   │   └── index.ts             # contextBridge (typed terminalAPI)
│   ├── renderer/                # React application
│   │   ├── components/
│   │   │   ├── TitleBar/        # Custom frameless title bar
│   │   │   ├── Sidebar/         # Sidebar, session tree, collection tree
│   │   │   ├── Terminal/        # xterm.js terminal panes
│   │   │   ├── StatusBar/       # Session info bar
│   │   │   ├── Settings/        # Settings modal (5 categories)
│   │   │   ├── ContributionGrid/ # Animated AI activity indicator
│   │   │   └── common/          # ContextMenu, PromptDialog
│   │   ├── store/               # Zustand stores (session, settings)
│   │   ├── hooks/               # Shared React hooks
│   │   └── styles/              # Global CSS, theme definitions
│   └── shared/                  # Shared TypeScript types
├── resources/                   # App icon, Claude Code hook, OpenCode plugin
├── logo/                        # Logo assets
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
└── ...
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [xterm.js](https://xtermjs.org/) - Terminal emulator for the web
- [Electron](https://www.electronjs.org/) - Build cross-platform desktop apps
- [Zustand](https://github.com/pmndrs/zustand) - State management
