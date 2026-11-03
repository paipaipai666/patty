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

## Session rows

The second unit uses fixed two-line rows: task title with a semantic status icon and a separate unread dot, then tool and folder or SSH target. Compact badge text is hidden below 220px; full status names remain available through accessible labels and tooltips. The close action appears on hover or keyboard focus without reserving its full width at rest.

The activity grid is limited to background sessions that are working, with a small, muted painted area. Waiting, completed and foreground sessions keep static status indicators. Reduced-motion mode hides the activity effect. Existing read/unread and filtering behavior is preserved.

All 726 frontend tests pass. Added cases cover project labels, SSH ports and IPv6, status after reading, and background-only activity. Browser checks verify the actual status label, context, read behavior and activity visibility in addition to the six layout captures.

## Pane headers and final review

Pane headers are 34px high, down from 42px. Local panes show the working folder's short name with the full path in a tooltip. SSH panes show the actual target, including user and non-default port. At narrow pane widths, the connection target takes precedence over the custom title.

Header actions remain visible in the focused pane and appear on hover or keyboard focus elsewhere. Touch input keeps actions visible. Moving keyboard focus into a pane now updates its workspace focus and selected session together. Three failing behavior tests first reproduced the missing focus update and header context, then passed after implementation.

Final screenshots showed long tool names crowding out directories at 160px. Session metadata now puts the directory first and hides the repeated tool text below 220px; icons, accessible descriptions and full tooltips retain tool identity.

All 729 frontend tests pass. Type, comment and script syntax checks pass. Browser checks verify focus transfer, the 34px header, narrow SSH target visibility and reduced motion, alongside the six theme/width captures. Generated output is excluded from the fixture server's file watcher, and verification results are marked running or failed before they can be mistaken for a previous successful run.

The desktop workflow script was migrated to the new background-only activity and compact status labels. Its WebView2 assertions remain unexecuted on this machine because of the existing CDP blocker. The browser fixture does not claim to resolve that blocker.

The first two commits are `36e6358` (compact toolbar and visual checks) and `67a27d7` (session context and restrained activity). The final pane-header commit includes the screenshot-driven narrow-sidebar adjustment.

The final ordinary desktop release build succeeds. Its startup isolation check still rejects test-only configuration overrides before creating WebView2 data or installing CLI hooks. No backend code or saved-state format changed in this pass.

## Follow-up: previews and theme thumbnails

The user approved continuing with these two frontend units.

1. Goal: reveal complete session context without selecting it, and let users compare themes visually.
2. Non-goals: no terminal-output capture, generated summary, Hook change, persistence migration or command palette in these units.
3. Modules: sidebar preview provider and rows, appearance controls, theme presentation, component tests and the browser fixture.
4. Rollback: revert each frontend commit independently. Existing session and custom-theme data stays compatible.
5. Commits: session hover/focus preview, then theme thumbnails with keyboard selection.

The preview sketches compared inline expansion with a floating card. The card preserves list positions at the 160px minimum and can flip beside a right-side sidebar. It uses one owner per list, renders outside clipped containers, waits 400ms for pointer or focus intent, and permits moving the pointer into the card to read or select text. Escape, selection, dragging, renaming, outside pointer actions, scrolling, hiding the sidebar and opening settings dismiss it. Unmount cancels pending timers.

The card shows reported title, tool, status, unread state, folder and SSH connection. Looking at it never selects the session or marks a notice read. Agent events update an open card; removing its session removes the card. Native text tooltips remain the fallback while the structured preview is closed.

Seven focused behavior tests pass. Real-browser captures cover dark/left and light/right sidebars at 160px, including viewport bounds and unchanged unread state. Existing desktop CDP limitations still apply.

The preview unit passes all 736 frontend tests, TypeScript and comment checks. Its browser fixture also checks the existing workbench layout, navigation, focus and reduced-motion behavior.

The preview commit is `8ac8c0c`.

## Theme thumbnails

The theme sketches compared small swatches in the existing dropdown with an inline gallery. The gallery shows the sidebar, selection, terminal background, foreground and ANSI success color together, using the actual theme palette. Built-in themes are grouped by dark and light appearance; custom themes have their own group and use the same card size. Theme IDs, saved settings and custom-theme formats are unchanged.

The picker uses one native radio group with a visible current marker and keyboard focus ring. Clicking or using the arrow keys selects a theme; hovering does not change the workbench. Tab leaves the group for the next control. Decorative miniatures are hidden from assistive technology. The old full-window ripple and its now-unused source and tests were removed.

Four theme behavior tests cover the six built-ins, grouping, selected state, exact custom colors and IDs, and selection without hover effects. An eighth preview test covers settings opening and blocking subsequent background focus. Preview portals share the application stacking context so settings remain above them.

All 737 frontend tests, TypeScript and comment checks pass. Real-browser verification covers mouse selection, native arrow-key selection, Tab navigation, unchanged theme on hover, custom palette rendering, equal card widths and a 540px window without horizontal overflow. It also checks that background focus cannot open a preview while settings are visible. Dark, light and narrow-window captures are in `output/workbench-visual`.

The ordinary desktop release build succeeds with the final source. Its isolation smoke test rejects test-only configuration overrides before browser or CLI integration startup, then removes its temporary data. Desktop WebView2 interaction remains unverified because of the recorded CDP blocker; the browser fixture covers the frontend behavior described above.

## Command palette follow-up

The user approved the command palette and keyboard flow next. Implementation, acceptance criteria and verification are recorded in [Command palette and keyboard flow](command-palette.md). Resume remains paused.

## Quiet workbench follow-up

2026-11-03. The user approved the quieter shell after reviewing the mockup: one application chrome region, headerless terminals, icon-only unified search and notifications. This supersedes the earlier pane-header and permanent sidebar-search presentation. See [delivery and verification](quiet-workbench.md) for the final behavior, screenshots and validation boundaries.
