/**
 * E2E smoke: launches the real Patty binary (WebView2 + ConPTY + hook server)
 * and drives a full terminal lifecycle through CDP:
 *
 *   launch → sidebar renders → New Terminal → session appears (PTY spawned)
 *   → type "exit" + Enter into xterm → session disappears (PTY exit observed)
 *
 * That single path covers ConPTY spawn/write/exit, the Tauri IPC bridge,
 * xterm mounting, and the store → sidebar render loop — the integration the
 * 470 unit tests cannot see.
 *
 * Usage:  npm run test:e2e
 * Requires a production exe (`npx tauri build --no-bundle` — plain cargo build
 * produces a dev-mode binary that expects vite on :1420) and a built frontend
 * (out/renderer). Set PATTY_EXE to point at a specific binary.
 */
import { launchApp, waitForProcessDeath } from './harness.mjs'

const SESSION_TAB = '[aria-label="Terminal sessions"] [role="tab"]'
const NEW_BTN = 'button[aria-label="New terminal or collection"]'

async function main() {
  const { cdp, close } = await launchApp()
  try {
    // 1. Sidebar renders on a fresh profile.
    await cdp.waitFor(`!!document.querySelector('${NEW_BTN}')`)
    const baseline = await cdp.evaluate(`document.querySelectorAll('${SESSION_TAB}').length`)
    // Isolation tripwire: a redirected APPDATA yields zero restored sessions.
    // Anything else means the binary read the REAL user state — stop before
    // the smoke clicks around in it.
    if (baseline !== 0 && !process.env.PATTY_E2E_ALLOW_RESTORED) {
      throw new Error(
        `expected 0 restored sessions with an isolated APPDATA, got ${baseline} — ` +
        'the exe likely predates the env-based data dir; rebuild it or set PATTY_EXE'
      )
    }
    console.log(`[e2e] sidebar up, ${baseline} restored session(s)`)

    // 2. New Terminal via the sidebar dropdown.
    await cdp.evaluate(`document.querySelector('${NEW_BTN}').click()`)
    await cdp.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'New Terminal')`)
    await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New Terminal').click()`)
    console.log('[e2e] clicked New Terminal')

    // 3. Session appears in the sidebar and the terminal mounts.
    await cdp.waitFor(`document.querySelectorAll('${SESSION_TAB}').length === ${baseline + 1}`)
    await cdp.waitFor(`!!document.querySelector('.xterm-helper-textarea')`)
    console.log('[e2e] session created, xterm mounted (PTY spawned)')

    // The shell PID is shown in the status bar once create_pty resolves.
    await cdp.waitFor(`/PID \\d+/.test(document.body.innerText)`)
    const shellPid = Number(await cdp.evaluate(`document.body.innerText.match(/PID (\\d+)/)[1]`))
    console.log(`[e2e] shell pid: ${shellPid}`)

    // 4. Type exit + Enter. Input is queued by ConPTY even if the shell is
    //    still initializing, so no prompt-readiness wait is needed. Note the
    //    session is NOT auto-removed on exit (by design, "[Process exited]");
    //    the honest end-to-end signal is the OS process dying.
    await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    await cdp.insertText('exit')
    await cdp.pressEnter()

    await waitForProcessDeath(shellPid, 20_000)
    console.log('[e2e] shell process exited (typed input reached ConPTY and ran)')

    // 5. Close the exited session via its sidebar close button → store removal.
    await cdp.evaluate(`document.querySelector('[aria-label^="Close "]').click()`)
    await cdp.waitFor(`document.querySelectorAll('${SESSION_TAB}').length === ${baseline}`)
    console.log('[e2e] session closed and removed from the store')
    console.log('[e2e] PASS')
  } catch (e) {
    console.error(`[e2e] FAIL: ${e.message}`)
    try {
      const text = await cdp.evaluate(`document.body.innerText.slice(0, 500)`)
      console.error(`[e2e] page text at failure:\n${text}`)
    } catch { /* page already gone */ }
    process.exitCode = 1
  } finally {
    await close()
  }
}

main().catch((e) => {
  console.error(`[e2e] FAIL: ${e.message}`)
  process.exitCode = 1
})
