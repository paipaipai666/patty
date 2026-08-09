/**
 * Startup benchmark: launches Patty like the smoke test and reports
 * wall-clock milestones for the launch → first-terminal-ready path.
 *
 *   spawn → webview attach → sidebar → (click New Terminal) → xterm mounted
 *   → PTY spawned (PID in status bar) → exit processed
 *
 * If the app was built with perf marks enabled (VITE_PATTY_PERF=1 vite dev /
 * build — see src/shared/perf.ts), the renderer's [perf] console lines are
 * harvested and printed after the external milestones. Note that a debug exe
 * needs vite running (devUrl); a release exe embeds out/renderer.
 *
 * Usage:  node scripts/benchmark-startup.mjs
 * Numbers are for comparison across runs on the same machine, not absolutes.
 */
import { launchApp, waitForProcessDeath } from '../e2e/harness.mjs'

const NEW_BTN = 'button[aria-label="New terminal or collection"]'

const marks = []
const perfLines = []
function mark(name) {
  marks.push({ name, t: Date.now() })
}

async function main() {
  const t0 = Date.now()
  mark('spawn')
  const { cdp, close } = await launchApp()
  mark('webview attached + DOM ready')

  // Harvest [perf] console lines when the build has perf marks enabled.
  const perfEnabled = await cdp.evaluate(`window.terminalAPI?.perfEnabled === true`)
  if (perfEnabled) {
    await cdp.send('Runtime.enable')
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args ?? []).map((a) => a.value).join(' ')
      if (typeof text === 'string' && text.startsWith('[perf]')) perfLines.push(text)
    })
  }

  try {
    await cdp.waitFor(`!!document.querySelector('${NEW_BTN}')`)
    mark('sidebar ready')

    await cdp.evaluate(`document.querySelector('${NEW_BTN}').click()`)
    await cdp.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'New Terminal')`)
    await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New Terminal').click()`)
    mark('New Terminal clicked')

    await cdp.waitFor(`!!document.querySelector('.xterm-helper-textarea')`)
    mark('xterm mounted')

    await cdp.waitFor(`/PID \\d+/.test(document.body.innerText)`)
    mark('PTY spawned (PID visible)')
    const shellPid = Number(await cdp.evaluate(`document.body.innerText.match(/PID (\\d+)/)[1]`))

    // Sessions persist after exit by design ("[Process exited]"); the
    // end-to-end completion signal is the OS process dying.
    await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    await cdp.insertText('exit')
    await cdp.pressEnter()
    await waitForProcessDeath(shellPid, 20_000)
    mark('exit processed')
  } finally {
    await close()
  }

  console.log('\n── startup milestones ─────────────────────────────')
  for (let i = 1; i < marks.length; i++) {
    const delta = marks[i].t - marks[i - 1].t
    const total = marks[i].t - t0
    console.log(`${marks[i].name.padEnd(32)} +${String(delta).padStart(6)}ms   (total ${total}ms)`)
  }
  if (perfLines.length > 0) {
    console.log('\n── renderer [perf] marks ──────────────────────────')
    for (const line of perfLines) console.log(line)
  } else {
    console.log('\n(no [perf] lines — rebuild with VITE_PATTY_PERF=1 for renderer marks)')
  }
}

main().catch((e) => {
  console.error(`[benchmark] FAIL: ${e.message}`)
  process.exitCode = 1
})
