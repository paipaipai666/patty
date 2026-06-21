# Terminal Sidebar

A Windows desktop terminal manager with VSCode-like sidebar layout.

## Features

- **Sidebar**: List all terminal sessions with color-coded labels
- **Multi-session**: Create, switch, and manage multiple terminal instances
- **Shell support**: PowerShell 7, Windows PowerShell, CMD, Git Bash, WSL
- **Custom title bar**: Frameless window with Windows 11 style controls
- **Keyboard shortcuts**: Ctrl+T (new), Ctrl+W (close), Ctrl+[/] (navigate), Ctrl+B (toggle sidebar)
- **Session persistence**: Sessions are saved and restored on restart

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npx electron-vite dev

# Build for production
npx electron-vite build

# Package as NSIS installer
npm run package
```

## Tech Stack

- Electron + electron-vite
- TypeScript (main + preload + renderer)
- React 18 + CSS Modules
- xterm.js + node-pty (Windows ConPTY)
- Zustand (state management)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+T | New terminal |
| Ctrl+W | Close current terminal |
| Ctrl+[/] | Switch to previous/next terminal |
| Ctrl+B | Toggle sidebar |
| Ctrl+1-9 | Jump to terminal by index |
