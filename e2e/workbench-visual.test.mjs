import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { Cdp, sleep, waitForPageTarget } from './cdp.mjs'

const executable = process.env.PATTY_VISUAL_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync)
assert.ok(executable, 'Set PATTY_VISUAL_BROWSER to a Chromium browser executable')
const profile = mkdtempSync(join(tmpdir(), 'patty-visual-'))
const output = resolve('output/workbench-visual')
mkdirSync(output, { recursive: true })
const server = await createServer({ configFile: false, root: resolve('.'), plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
let browser
let cdp
try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address === 'object')
  browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', `http://127.0.0.1:${address.port}/e2e/visual/index.html`], { windowsHide: true, stdio: 'ignore' })
  const portFile = join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + 20000
  while (!existsSync(portFile) && Date.now() < deadline) await sleep(100)
  assert.ok(existsSync(portFile), 'Browser did not expose its dedicated debugging port')
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
  const target = await waitForPageTarget(port, 10000)
  cdp = await Cdp.connect(target.webSocketDebuggerUrl)
  const errors = []
  cdp.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text))
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.waitFor(`!!document.querySelector('[aria-label="New terminal"]') && document.querySelectorAll('.xterm').length === 2`)
  await sleep(600)
  const metrics = []
  for (const theme of ['dark', 'light']) {
    for (const width of [160, 264, 320]) {
      await cdp.evaluate(`window.workbenchPreview.setTheme(${JSON.stringify(theme)}); window.workbenchPreview.sessions.getState().setSidebarWidth(${width})`)
      await sleep(200)
      const measured = await cdp.evaluate(`(() => {
        const header = document.querySelector('h2').parentElement.parentElement
        const sidebar = header.parentElement
        const bounds = sidebar.getBoundingClientRect()
        const controls = [...header.querySelectorAll('input, select, button')]
        return { width: bounds.width, headerHeight: header.getBoundingClientRect().height, overflow: sidebar.scrollWidth > sidebar.clientWidth,
          controlsFit: controls.every(element => { const rect = element.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right && rect.width >= 24 }) }
      })()`)
      assert.equal(measured.overflow, false, `${theme} ${width}: sidebar overflow`)
      assert.equal(measured.controlsFit, true, `${theme} ${width}: clipped control`)
      assert.ok(measured.headerHeight <= 132, `${theme} ${width}: header too tall`)
      metrics.push({ theme, ...measured })
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(output, `${theme}-${width}.png`), Buffer.from(shot.data, 'base64'))
    }
  }
  await cdp.evaluate(`document.querySelector('[aria-label="New terminal or collection"]').click()`)
  await cdp.waitFor(`!!document.querySelector('[role="menu"]')`)
  assert.equal(await cdp.evaluate(`document.activeElement?.getAttribute('role')`), 'menuitem')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.waitFor(`!document.querySelector('[role="menu"]')`)
  assert.equal(await cdp.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'New terminal or collection')
  await cdp.evaluate(`document.querySelector('[aria-label="Next session needing attention"]').click()`)
  await cdp.waitFor(`window.workbenchPreview.sessions.getState().activeSessionId === 'agent'`)
  assert.equal(await cdp.evaluate(`window.workbenchPreview.sessions.getState().agentStates.agent.status`), 'waiting_approval')
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ result: 'passed', scope: 'Real React components and xterm with fixture transport; no desktop PTY or CLI integration', metrics }, null, 2))
  console.log(`PASS: workbench layout, menu focus and attention navigation; screenshots in ${output}`)
} finally {
  await cdp?.send('Browser.close').catch(() => {})
  cdp?.close()
  if (browser && browser.exitCode === null) {
    await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), sleep(2000)])
    if (browser.exitCode === null) browser.kill()
  }
  await server.close()
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()))
  assert.ok(basename(profile).startsWith('patty-visual-'))
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
}
