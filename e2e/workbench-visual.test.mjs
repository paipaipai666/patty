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
assert.ok(executable && existsSync(executable), 'Set PATTY_VISUAL_BROWSER to a Chromium browser executable')
const profile = mkdtempSync(join(tmpdir(), 'patty-visual-'))
const output = resolve('output/workbench-visual')
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'verification.json'), JSON.stringify({ result: 'running' }))
const server = await createServer({ configFile: false, root: resolve('.'), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/output/**', '**/out/**'] } } })
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
  for (const [theme, side] of [['dark', 'left'], ['light', 'right']]) {
    await cdp.evaluate(`window.workbenchPreview.setTheme(${JSON.stringify(theme)}); window.workbenchPreview.sessions.getState().setSidebarWidth(160); window.workbenchPreview.settings.setState(state => ({settings: {...state.settings, sidebarPosition: ${JSON.stringify(side)}}}))`)
    await sleep(250)
    const anchor = await cdp.evaluate(`(() => { const row = document.querySelector('[data-tree-id="session:agent"]').getBoundingClientRect(); return { x: row.left + 12, y: row.top + row.height / 2 } })()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...anchor })
    await cdp.waitFor(`!!document.querySelector('[role="tooltip"]')`)
    const preview = await cdp.evaluate(`(() => { const card = document.querySelector('[role="tooltip"]'); const rect = card.getBoundingClientRect(); const row = document.querySelector('[data-tree-id="session:agent"]'); return { text: card.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, linked: row.getAttribute('aria-describedby') === card.id } })()`)
    assert.ok(preview.text.includes('Waiting for approval') && preview.text.includes('terminal-sidebar'))
    assert.ok(preview.left >= 12 && preview.right <= 1428 && preview.top >= 12 && preview.bottom <= 888)
    assert.equal(preview.linked, true)
    assert.equal(await cdp.evaluate(`window.workbenchPreview.sessions.getState().agentStates.agent.unread`), true)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(output, `preview-${theme}-${side}.png`), Buffer.from(shot.data, 'base64'))
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.waitFor(`!document.querySelector('[role="tooltip"]')`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 15 })
  }
  await cdp.evaluate(`window.workbenchPreview.settings.setState(state => ({settings: {...state.settings, sidebarPosition: 'left'}}))`)
  await cdp.evaluate(`document.querySelector('[data-pane-id="pane-agent"] [aria-label="Split terminal to the right"]').focus()`)
  await cdp.waitFor(`document.querySelector('[data-pane-id="pane-agent"]').dataset.focused === 'true'`)
  assert.equal(await cdp.evaluate(`window.workbenchPreview.sessions.getState().activeSessionId`), 'agent')
  assert.equal(await cdp.evaluate(`document.querySelector('[data-testid="pane-header"]').getBoundingClientRect().height`), 34)
  await cdp.waitFor(`getComputedStyle(document.querySelector('[data-pane-id="pane-agent"] [aria-label="Split terminal to the right"]').parentElement).opacity === '1'`)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"]').getAttribute('aria-description').includes('Claude Code · terminal-sidebar')`), true)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"] canvas') === null`), true)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"] [aria-label="Waiting for approval"]') !== null`), true)
  await cdp.evaluate(`document.querySelector('[aria-label="New terminal or collection"]').click()`)
  await cdp.waitFor(`!!document.querySelector('[role="menu"]')`)
  assert.equal(await cdp.evaluate(`document.activeElement?.getAttribute('role')`), 'menuitem')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.waitFor(`!document.querySelector('[role="menu"]')`)
  assert.equal(await cdp.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'New terminal or collection')
  await cdp.evaluate(`document.querySelector('[aria-label="Next session needing attention"]').click()`)
  await cdp.waitFor(`window.workbenchPreview.sessions.getState().activeSessionId === 'agent'`)
  assert.equal(await cdp.evaluate(`window.workbenchPreview.sessions.getState().agentStates.agent.status`), 'waiting_approval')
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"]').dataset.agentUnread`), 'false')
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().applyAgentUpdate({ paneId: 'review', revision: 3, agent: { aiType: 'codex', status: 'working' } })`)
  await cdp.waitFor(`!!document.querySelector('[data-tree-id="session:review"] canvas')`)
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().setActive('review')`)
  await cdp.waitFor(`!document.querySelector('[data-tree-id="session:review"] canvas')`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 540, height: 720, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().setSidebarWidth(160); window.workbenchPreview.sessions.getState().setActive('remote'); window.workbenchPreview.workspaces.getState().ensureVisible('remote')`)
  await cdp.waitFor(`!!document.querySelector('[data-testid="pane-header"] [title="deploy@prod-01.example.com:2222"]')`)
  assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-testid="pane-header"] [title="deploy@prod-01.example.com:2222"]')).display !== 'none'`), true)
  await sleep(200)
  const narrow = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'ssh-narrow.png'), Buffer.from(narrow.data, 'base64'))
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().setActive('shell')`)
  await cdp.waitFor(`!!document.querySelector('[data-tree-id="session:review"] canvas')`)
  assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-tree-id="session:review"] canvas').parentElement.parentElement).display`), 'none')
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`window.workbenchPreview.setTheme('dark'); window.workbenchPreview.sessions.getState().setSidebarWidth(264); window.workbenchPreview.settings.getState().openSettings()`)
  await cdp.evaluate(`window.workbenchPreview.addCustomTheme()`)
  await cdp.waitFor(`document.querySelectorAll('[role="dialog"] input[type="radio"]').length === 7`)
  await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"]').focus()`)
  await sleep(450)
  assert.equal(await cdp.evaluate(`document.querySelector('[role="tooltip"]') === null`), true)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-theme-id="dark"]').getBoundingClientRect().width === document.querySelector('[data-theme-id="visual-harbor"]').getBoundingClientRect().width`), true)
  const chooseTheme = async (id) => {
    await cdp.evaluate(`document.querySelector('[data-theme-id="${id}"]').scrollIntoView({block:'nearest'})`)
    const point = await cdp.evaluate(`(() => {const rect = document.querySelector('[data-theme-id="${id}"]').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await cdp.waitFor(`window.workbenchPreview.settings.getState().settings.theme === ${JSON.stringify(id)}`)
  }
  await cdp.evaluate(`document.querySelector('[data-theme-id="dark"] input').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await cdp.waitFor(`window.workbenchPreview.settings.getState().settings.theme === 'dracula'`)
  assert.equal(await cdp.evaluate(`document.activeElement?.value`), 'dracula')
  await chooseTheme('dark')
  await cdp.evaluate(`document.querySelector('[role="dialog"] [class*="content"]').scrollTop = 0`)
  await sleep(200)
  const darkThemes = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'themes-dark.png'), Buffer.from(darkThemes.data, 'base64'))
  await cdp.evaluate(`document.querySelector('[data-theme-id="light"]').scrollIntoView({block:'nearest'})`)
  const lightTarget = await cdp.evaluate(`(() => {const rect = document.querySelector('[data-theme-id="light"]').getBoundingClientRect(); return {x:rect.left+10,y:rect.top+10}})()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...lightTarget })
  assert.equal(await cdp.evaluate(`window.workbenchPreview.settings.getState().settings.theme`), 'dark')
  await chooseTheme('light')
  await cdp.evaluate(`document.querySelector('[role="dialog"] [class*="content"]').scrollTop = 0`)
  await cdp.waitFor(`document.documentElement.dataset.theme === 'light'`)
  await sleep(200)
  const lightThemes = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'themes-light.png'), Buffer.from(lightThemes.data, 'base64'))
  await chooseTheme('visual-harbor')
  await cdp.waitFor(`window.workbenchPreview.settings.getState().settings.theme === 'visual-harbor'`)
  assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-theme-id="visual-harbor"] [data-testid="theme-thumbnail"]')).backgroundColor`), 'rgb(16, 42, 51)')
  await cdp.evaluate(`document.querySelector('[data-theme-id="light"] input').click(); document.querySelector('[data-theme-id="light"] input').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert.equal(await cdp.evaluate(`document.activeElement?.textContent.trim()`), 'Import')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 540, height: 720, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`document.querySelector('[role="dialog"] [class*="content"]').scrollTop = 0`)
  await sleep(200)
  assert.equal(await cdp.evaluate(`(() => {const dialog = document.querySelector('[role="dialog"]');const picker = dialog.querySelector('fieldset');return dialog.scrollWidth <= dialog.clientWidth && picker.scrollWidth <= picker.clientWidth})()`), true)
  const narrowThemes = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'themes-narrow.png'), Buffer.from(narrowThemes.data, 'base64'))
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.waitFor(`!document.querySelector('[role="dialog"]')`)
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ result: 'passed', scope: 'Real React components and xterm with fixture transport; no desktop PTY or CLI integration', metrics }, null, 2))
  console.log(`PASS: workbench, session previews and keyboard theme thumbnails; screenshots in ${output}`)
} catch (error) {
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ result: 'failed', message: String(error) }, null, 2))
  throw error
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
