
   
import { launchApp, waitForProcessDeath } from './harness.mjs'

const SESSION_TAB = '[aria-label="Terminal sessions"] [role="tab"]'
const NEW_BTN = 'button[aria-label="New terminal or collection"]'

async function main() {
  const { cdp, close } = await launchApp()
  try {

    await cdp.waitFor(`!!document.querySelector('${NEW_BTN}')`)
    const baseline = await cdp.evaluate(`document.querySelectorAll('${SESSION_TAB}').length`)

    if (baseline !== 0 && !process.env.PATTY_E2E_ALLOW_RESTORED) {
      throw new Error(
        `expected 0 restored sessions with an isolated APPDATA, got ${baseline} — ` +
        'the exe likely predates the env-based data dir; rebuild it or set PATTY_EXE'
      )
    }
    console.log(`[e2e] sidebar up, ${baseline} restored session(s)`)


    await cdp.evaluate(`document.querySelector('${NEW_BTN}').click()`)
    await cdp.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'New Terminal')`)
    await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New Terminal').click()`)
    console.log('[e2e] clicked New Terminal')


    await cdp.waitFor(`document.querySelectorAll('${SESSION_TAB}').length === ${baseline + 1}`)
    await cdp.waitFor(`!!document.querySelector('.xterm-helper-textarea')`)
    console.log('[e2e] session created, xterm mounted (PTY spawned)')


    await cdp.waitFor(`/PID \\d+/.test(document.body.innerText)`)
    const shellPid = Number(await cdp.evaluate(`document.body.innerText.match(/PID (\\d+)/)[1]`))
    console.log(`[e2e] shell pid: ${shellPid}`)


    await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    await cdp.insertText('exit')
    await cdp.pressEnter()

    await waitForProcessDeath(shellPid, 20_000)
    console.log('[e2e] shell process exited (typed input reached ConPTY and ran)')


    await cdp.evaluate(`document.querySelector('[aria-label^="Close "]').click()`)
    await cdp.waitFor(`document.querySelectorAll('${SESSION_TAB}').length === ${baseline}`)
    console.log('[e2e] session closed and removed from the store')
    console.log('[e2e] PASS')
  } catch (e) {
    console.error(`[e2e] FAIL: ${e.message}`)
    try {
      const text = await cdp.evaluate(`document.body.innerText.slice(0, 500)`)
      console.error(`[e2e] page text at failure:\n${text}`)
    } catch {                         }
    process.exitCode = 1
  } finally {
    await close()
  }
}

main().catch((e) => {
  console.error(`[e2e] FAIL: ${e.message}`)
  process.exitCode = 1
})
