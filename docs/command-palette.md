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
