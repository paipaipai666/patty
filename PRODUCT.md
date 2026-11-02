# Product

## Register

product

## Users

Windows developers using local shells, SSH connections, and terminal-based AI coding tools. They switch between several sessions and arrange terminals into split workspaces.

## Product purpose

Patty keeps terminals in a searchable sidebar, organizes them in collections and workspaces, and shows when supported AI tools need input, complete a turn, or report an error. Improvements should reduce the work of finding, monitoring, and continuing these sessions.

## Existing product identity

The current Graphite workbench uses compact controls, system UI typography, Fluent icons, user-selectable themes, and a terminal-first layout. Preserve these established choices when adding sidebar controls. Product copy names the action or state directly.

## Anti-references

Do not introduce a second pane hierarchy, a competing navigation system, or permanent editor and chat panels as part of a sidebar improvement. Keep the existing terminal area available for shell and TUI applications.

## Design principles

- Keep session selection connected to its saved workspace and focused pane.
- Use existing theme tokens and semantic state colors.
- Make status understandable through text as well as color.
- Keep common actions available from the keyboard and return focus after transient UI closes.
- Describe layout restoration, AI conversation restoration, and process lifetime separately.

## Accessibility and inclusion

Preserve the existing tree semantics, roving keyboard focus, visible focus indicators, reduced-motion behavior, and input-method composition handling. New controls need accessible names and must remain usable at the existing 160-pixel minimum sidebar width in light and dark themes.

## Implementation backlog

See [Product and technical improvements](designs/product-technical-improvements.md) for priorities, dependencies, acceptance criteria, and delivery status.
