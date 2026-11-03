# Frontend polish

2026-11-03. The user approved frontend improvements inspired by Ghostty and Otty. Resume and the remaining product backlog are on hold.

## First pass

1. Goal: make the sidebar compact at 160–320px, clarify session context and status, and reduce permanent pane controls while preserving keyboard access.
2. Non-goals: no backend, Hook, IPC or persistence changes. Hover previews, theme thumbnails and the command palette remain separate work.
3. Modules: Sidebar, SessionItem, PaneView, their styles and behavior tests, and a browser visual fixture.
4. Rollback: revert the three independent frontend commits. No saved-data conversion is needed.
5. Commits: compact sidebar controls; session context and restrained activity; pane headers and focus feedback.

Two toolbar sketches were compared: a shared search/create row and an independent search row. The independent row preserves input width at the 160px minimum. Creation moves to the heading row, with view selection and next-attention navigation together below search.

## Verification

`npm run test:visual:workbench` renders the actual Sidebar, PaneTree, TerminalPane, TitleBar and StatusBar in Chromium. It uses real Zustand stores and xterm with a fixed replay transport. It does not start a desktop PTY, touch CLI configuration or replace desktop integration tests.

The runner uses its own temporary browser profile and a local Vite server. Screenshots and measured results go to `output/workbench-visual`. Set `PATTY_VISUAL_BROWSER` to select another Chromium executable. The fixture is included in TypeScript checks.

The first unit passes all 721 frontend tests, type and comment checks. Visual checks cover dark and light themes at 160, 264 and 320px, menu keyboard focus restoration and next-attention navigation. The toolbar measures 128px high in all six layouts, with controls inside the sidebar bounds.

The existing WebView2 CDP blocker remains a separate desktop limitation.
