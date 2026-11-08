# OMP native navigation companion (legacy test harness)

This folder is the old isolated OMP 18.13.3 test harness. The product path is now the standard `omp` 18.17.0 extension: `scripts/build-omp-hook.mjs` generates `resources/omp-patty-hook.bundle.js`, and `src-tauri/src/installer.rs` copies it to `%USERPROFILE%\.omp\agent\extensions\patty-notifier.ts`. The scripts below remain only for module regression tests and historical evidence; they are not a user startup path.

The companion adds history navigation to an isolated copy of OMP 18.13.3. History appears in the same terminal through OMP's fullscreen TUI overlay. Returning to live resumes the original transcript renderer and its pending history batches.

The companion requires the source fingerprints in `upstream-lock.json` and Bun 1.4.4. It keeps writable packages and the runtime under `output/omp-navigation`. The user's global OMP installation stays unchanged.

## Verification commands

The commands below run from the Patty repository root on Windows. Each prepare restores the upstream package copies, so apply follows prepare.

```powershell
rtk proxy node integrations/omp/prepare.mjs
rtk proxy node integrations/omp/runtime.mjs
rtk proxy node integrations/omp/apply.mjs
rtk proxy node integrations/omp/verify.mjs
rtk proxy npm run test:omp
rtk proxy node scripts/verify-omp-navigation.mjs
rtk proxy node integrations/omp/cli-smoke.mjs
```

The CLI smoke requires a terminal. It starts the complete isolated OMP CLI with a fixture session and a probe extension. The probe checks the catalog, history selection, committed Chinese input, return to live, frame revisions, and the unchanged session leaf. It then submits `/new` through the original editor and checks that the existing API publishes the new session's empty catalog and live position. It sends no model request.

`prepare.mjs` accepts `OMP_SOURCE_MODULES` as the source dependency directory. The default is `%USERPROFILE%/.bun/install/global/node_modules`. Writable package destinations cannot be dependency links. Other dependencies are junctions to the installed packages.

`runtime.mjs` downloads the fixed official Windows x64 Bun asset and verifies its SHA256 before extraction. `apply.mjs` checks owned paths and applies patches by unique source anchors. Repeating apply without source changes reports zero patch operations.

The generated manifests are `output/omp-navigation/source-manifest.json` and `output/omp-navigation/patch-manifest.json`. The patch manifest includes every companion module and the TUI source mapper.

`verify.mjs` checks the global source fingerprints, unpatched upstream copies, patched file hashes, and the seven persistent companion modules against their runnable copies.

## Extension API

`ctx.ui.transcript` implements `TranscriptNavigationApi` from `navigation-api.ts`:

```ts
const navigation = ctx.ui.transcript
if (navigation) {
	const catalog = navigation.getCatalog()
	const current = navigation.getPosition()
	const stopPositions = navigation.onPosition(position => receivePosition(position))
	const stopCatalog = navigation.onCatalog(snapshot => receiveCatalog(snapshot))
	await navigation.seek({
		entryId,
		expectedBranchEpoch: current.branchEpoch,
		expectedDisplayEpoch: current.displayEpoch,
	})
	await navigation.returnToLive()
	stopPositions()
	stopCatalog()
}
```

`getCapabilities()` returns:

```ts
{
	transcriptNavigation: 1,
	catalogSnapshot: 1,
	nativeHistoryViewport: 1,
	frameObservation: 1,
}
```

The catalog contains stable persisted `entryId` values, summaries, and timestamps. Ordinary user messages and OMP's user-attributed custom turn initiators form the catalog. Synthetic user messages remain rendered through their original collapsed component and do not create catalog turns.

Positions include `sessionId`, `branchEpoch`, `displayEpoch`, `viewRevision`, and `frameId`. A browsing position also includes `entryId` and `{ partId, scalarOffset }`. Public offsets count Unicode scalar values. Internal lexer offsets use UTF-16 code units and convert at the API boundary.

Both commands accept optional `expectedBranchEpoch` and `expectedDisplayEpoch`. A mismatch rejects with `stale_branch` or `stale_display`. Other command errors include `entry_not_found`, `part_not_found`, `invalid_anchor`, `busy`, `superseded`, and `navigation_disposed`.

Local input advances `displayEpoch` before an older remote command can apply. Arrow keys and page keys scroll history. Escape returns to live. Committed text, bracketed paste, and interrupts restore the original input owner and replay once. A modal keeps its keyboard ownership; a pending asynchronous restore waits for the modal to close.

## Rendering and lifecycle

`CanonicalBranchIndex` reads OMP's memoized `getBranchView()`. It processes appended entries and updates the originating assistant part when a tool result arrives. Warm position reads and seeks use the cached entry index. Summaries scan at most 640 scalars and retain at most 160 scalars.

`canonical-renderer.ts` uses OMP's `ChatTranscriptBuilder` with the active tool registry and custom message renderers. Assistant text, thinking, tool calls, associated tool results, and image content retain their structured parts.

`markdown-range.ts` selects a source window before the original Markdown component renders. `markdown-source-map.ts` follows lexer token source positions through inline output, code output, and the original wrapping logic. The viewport removes internal source markers before terminal output. Logical source points survive the tested list reflow, modal restore, code selection, and terminal width changes.

`progressive-highlight.ts` draws the first frame with the original code block's base style. One worker runs native syntax parsing while one newer request can wait. Completed colors request a redraw only when the session, view, part, and content revision still match. The cache is limited to 64 entries and 2 MiB. Controller history checkpoints and visited content revisions are each limited to 128 entries.

Session changes and actual branch replacements invalidate browsing. Background appends retain the branch epoch and browsing anchor, including replacement branch memos with the same prefix. The API object and its subscriptions survive `/new` and ordinary session preparation. `InteractiveMode` shutdown alone disposes navigation. Cleanup removes input, paint, and session subscriptions, closes the owned overlay, and terminates the highlighting worker.

## Frame observation

After a completed paint, the controller writes this record into the same terminal output stream:

```text
ESC ] 777 ; patty-nav-v1 ; BASE64URL(JSON_POSITION) BEL
```

The JSON contains the position identity and the current mode. Every published record advances `viewRevision` and uses a new `frameId`, including an idempotent return to live. A command resolves after its first frame record, without waiting for syntax colors. Another foreground overlay suppresses navigation frame records and makes commands return `busy`.

The Patty transport adapter lives in `resources/omp-patty-hook.ts`. HTTP leases, scopes, and admission belong to that adapter and the Patty broker, outside the renderer's domain API.

## Measured evidence and limits

`npm run test:omp` covers the real OMP components, TUI, session manager, and native worker. The suite includes a million-character source line, a 40k-character native syntax case, literal row source positions, Unicode anchors, cold backwards navigation, resize, modal ownership, input transactions, and branch lifecycle.

The 10,000-turn benchmark performs 20 warm seek-and-return cycles without reading another branch snapshot. The measured run took 12.3 ms in this workspace. Timing varies by machine; the test also checks the structural snapshot invariant.

`scripts/verify-omp-navigation.mjs` parses real TUI output with xterm. The first question has left a 1,000-line scrollback before selection. History selection displays it in alternate mode, and return to live restores the normal buffer with the update added during browsing. The report is `output/omp-navigation/gate0-report.json`.

The parser harness does not measure ConPTY transmission or DOM paint completion. Desktop end-to-end validation is tracked separately.

Native highlighting still costs O(prefix), and pathological lines can delay colors in the worker. The first frame and local terminal input do not wait for those colors. Partial Markdown structures and specialized tool `details` do not yet have exhaustive source-map and bounded-layout coverage. Reusing an original component does not prove bounds for every custom renderer.
