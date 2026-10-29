# Contributing to Patty

Patty is a Windows application built with Tauri 2, a Rust backend, and a React frontend. Follow the [source build instructions](README.md#build-from-source) before making changes.

## Report a bug or request a feature

Search [existing issues](https://github.com/paipaipai666/patty/issues) before opening a new report.

For a bug, use the [bug report template](https://github.com/paipaipai666/patty/issues/new?template=bug_report.yml). Include the Patty version, Windows version, shell, reproduction steps, and expected behavior. Include screenshots or logs when they help explain the problem, with credentials and other private data removed.

For a feature, use the [feature request template](https://github.com/paipaipai666/patty/issues/new?template=feature_request.yml). Describe the problem you want to solve and how you would use the feature.

## Submit a change

1. Fork the repository and create a branch for your change.
2. Install dependencies with `npm ci` and start Patty with `npm run dev`.
3. Make one focused change and add regression coverage for behavior changes.
4. Run the [CI checks](README.md#run-checks). For terminal, pane, or interaction changes, also run the relevant [desktop UI tests](README.md#test-the-desktop-app).
5. Commit with a conventional prefix such as `fix:`, `feat:`, `refactor:`, `test:`, `docs:`, or `chore:`.
6. Open a pull request describing the problem, the resulting behavior, and the checks you ran. Include updated screenshots for visible UI changes.

## Work in the correct module

| Area | Location |
| --- | --- |
| UI components and CSS Modules | `src/renderer/components/` |
| Client state and persistence scheduling | `src/renderer/store/` |
| Built-in themes | `src/renderer/themes/` |
| Shared TypeScript types and normalizers | `src/shared/` |
| Native terminal, SSH, hooks, metrics, and persistence | `src-tauri/src/` |
| Rust integration tests | `src-tauri/tests/` |
| AI hook adapters and ConPTY manifest | `resources/` |
| Native UI tests | `e2e/` |

Use TypeScript for frontend code, Rust for native behavior, and CSS Modules for component styles. Follow the existing module boundaries. The backend targets Windows.

Write code whose names and tests explain its behavior. Explanatory code comments are rejected by `npm run check:comments`; tool directives are allowed by that check.

Keep generated dependencies, build output, ConPTY binaries, and test captures out of commits. The ConPTY package version and hashes belong in `resources/conpty.lock.json`; preparation and offline usage are documented in [Bundled ConPTY runtime](resources/conpty.md).

## Update documentation and screenshots

Keep README instructions consistent with `package.json`, Tauri configuration, and the current UI. Document application behavior rather than historical implementation details.

The [Graphite UI test](README.md#test-the-desktop-app) captures demonstration sessions in dark and light themes under `output/graphite/`. Inspect those captures before using them to replace `main-dark.png` and `main-light.png`. Identify simulated AI events in screenshot captions.
