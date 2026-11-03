# Command palette and keyboard flow

The user approved implementing the command palette and completing keyboard operation on 2026-11-03. Resume and other product tickets remain paused.

## Plan

1. Goal: search and execute existing operations, open from the terminal, navigate results, protect input-method composition, cancel back to the origin and focus the destination after execution.
2. Non-goals: no layout templates, Resume, arbitrary command execution or new terminal protocol.
3. Modules: application keyboard routing, command definitions, transient palette, shortcut settings, shared defaults and browser verification.
4. Rollback: revert each commit independently. Existing settings use their current default-backfill mechanism for the new palette shortcut.
5. Commits: unify existing shortcut actions and repair keyboard flow; add the command palette with full interaction verification.

## Keyboard foundation

Application shortcuts previously skipped xterm entirely. They now run in the capture phase for registered chords, leaving unregistered shell control keys and clipboard handling to xterm. Ordinary editable fields retain their editing keys; composition, held-key repeats, dialogs and menus cannot trigger application actions. Ctrl+1 through Ctrl+9 require exactly Ctrl.

Commands and shortcut settings share labels and key normalization. Split and pane-close bindings are now editable. Capture ignores composition and modifier-only keys, rejects conflicting bindings, plain-text input and reserved clipboard/session-position keys, and supports both Escape and the Cancel button.

Terminal-directed actions reveal the selected session's workspace and focused pane before placing the caret in its terminal. Other actions preserve focus or hand it to a dialog. Errors return focus and show a retry message.

The foundation passes all 749 frontend tests, TypeScript and comment checks. The browser fixture uses actual xterm focus to verify Ctrl+1, Ctrl+], no shortcut bytes written to the transport, Ctrl+, opening settings, suppression of Ctrl+T inside settings and Escape returning to the original terminal. This remains frontend verification with fixture transport, not desktop PTY verification.

The foundation commit is `56b95f5`.

## Palette behavior

The title-bar Commands button and remappable Ctrl+Shift+P open a transient panel using the existing Graphite colors, system font and Fluent icons. Search covers command labels, scope, shortcuts, session tools and directories, SSH targets and theme names. Built-in actions include Chinese search aliases. Searching does not select sessions or mark them read.

The first enabled result is selected. Up/Down wrap between available results, Page Up/Page Down move five results, Enter executes and Escape cancels. Tab cycles between search and close; Enter activates the close button. Composition and held confirmation keys cannot execute actions. Search uses combobox/listbox semantics, active-descendant links, disabled reasons and a result-count announcement.

Cancellation restores the originating control. Session-directed actions reveal and focus the selected workspace/pane, and the empty-layout action is the fallback after the last pane closes. Commands that open settings preserve the return target. SSH authentication or host-key prompts dismiss the palette without reopening it afterward. Execution does not refocus an obsolete terminal before deciding the target.

Available operations reuse existing lifecycle and settings functions: new terminal, folder selection, splits, terminal/pane close, next/previous session, next attention, sidebar visibility, settings, session selection, saved SSH connections and built-in/custom themes. Templates remain pending P2-02. No free-form shell command execution was added.

## Regression evidence

The backend test first failed because old settings did not backfill commandPalette. Adding the new default makes both backfill and preservation of a custom binding pass. Both ordinary and E2E Cargo configurations pass 254 tests.

A failing lifecycle test first reproduced orphan-session creation when no pane could be split. Creation now checks for a real focused session before allocating anything. Full frontend regression also caught stale disabled state when workspace creation and a keyboard event occurred before the next React render. Availability is now evaluated against live stores when executing, including the existing close-pane/keep-agent regression.

The browser run initially could not activate shortcut capture because its Enter event omitted the native character event. The harness now includes Enter text and verifies that capture is active before assigning a new key. A later assertion accidentally read the sidebar's status instead of the palette's result count; it now queries within the dialog. Failure state and a screenshot are saved when browser verification fails.

The browser flow covers opening from actual xterm input, Chinese search, cancel/reopen, selecting a remote session, creating a split, applying a theme, opening shortcut settings, rebinding the palette, rejecting the former key, reopening with the new key, closing via Tab/Enter, and a 360px window. Dark, light and narrow captures are in `output/workbench-visual/commands-*.png`. No desktop PTY or CLI configuration is exercised by this fixture.

Final frontend verification passes 80 files and 771 tests, TypeScript, comment checks and the complete browser flow. Screenshots were inspected in dark, light and 360px layouts. Existing desktop WebView2 CDP limitations remain; browser verification does not resolve them.

The ordinary desktop release build succeeds with the final source. Its startup isolation check rejects E2E-only configuration overrides before browser or CLI integration startup and removes its temporary data. No real CLI configuration or user profile was changed during verification.
