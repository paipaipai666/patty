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
const forceCanvas = process.env.PATTY_VISUAL_DISABLE_WEBGL === '1'
const output = resolve(forceCanvas ? 'output/workbench-visual-canvas' : 'output/workbench-visual')
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'verification.json'), JSON.stringify({ result: 'running' }))
const server = await createServer({ configFile: false, root: resolve('.'), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/output/**', '**/out/**'] } } })
let browser
let cdp

async function captureFlameRow() {
  const clip = await cdp.evaluate(`(() => { const rect = document.querySelector('[data-tree-id="session:review"]').getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } })()`)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip })
  return shot.data
}

async function measureFlame(first, second, baseline) {
  return cdp.evaluate(`(async () => {
    const decode = async data => {
      const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
      bitmap.close()
      return pixels
    }
    const [first, second, baseline] = await Promise.all(${JSON.stringify([first, second, baseline])}.map(decode))
    let visiblePixels = 0, motionPixels = 0, left = first.width, right = -1
    for (let index = 0; index < first.data.length; index += 4) {
      let contrast = 0, motion = 0
      for (let channel = 0; channel < 3; channel++) {
        contrast = Math.max(contrast, Math.abs(first.data[index + channel] - baseline.data[index + channel]), Math.abs(second.data[index + channel] - baseline.data[index + channel]))
        motion = Math.max(motion, Math.abs(first.data[index + channel] - second.data[index + channel]))
      }
      if (contrast >= 12) {
        visiblePixels++
        const x = (index / 4) % first.width
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
      if (motion >= 8) motionPixels++
    }
    return { width: first.width, visiblePixels, motionPixels, trailWidth: Math.max(0, right - left + 1) }
  })()`)
}

try {
  await server.listen()
  const address = server.httpServer.address()
  assert.ok(address && typeof address === 'object')
  browser = spawn(executable, [...(forceCanvas ? ['--disable-webgl'] : []), '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', `http://127.0.0.1:${address.port}/e2e/visual/index.html`], { windowsHide: true, stdio: 'ignore' })
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
  try {
    await cdp.waitFor(`!!document.querySelector('[aria-label="New terminal"]') && document.querySelectorAll('.xterm').length === 2`)
  } catch (error) {
    if (errors.length) throw new Error(errors.join('\n'), { cause: error })
    throw error
  }
  await sleep(600)
  if (forceCanvas) {
    assert.equal(await cdp.evaluate(`document.createElement('canvas').getContext('webgl2') === null && document.querySelectorAll('.xterm-text-layer').length === 2`), true, 'Canvas fallback must render both visible terminals')
  }
  const metrics = []
  const flames = []
  for (const theme of ['dark', 'light']) {
    for (const width of [160, 264, 320]) {
      await cdp.evaluate(`window.workbenchPreview.setTheme(${JSON.stringify(theme)}); window.workbenchPreview.sessions.getState().setSidebarWidth(${width})`)
      await sleep(200)
      const measured = await cdp.evaluate(`(() => {
        const header = document.querySelector('[data-sidebar-toolbar]')
        const sidebar = document.querySelector('[data-sidebar]')
        const bounds = sidebar.getBoundingClientRect()
        const controls = [...header.querySelectorAll('input, select, button')]
        const rows = [...sidebar.querySelectorAll('[role="treeitem"]')].filter(row => row.getBoundingClientRect().height > 0)
        return { width: bounds.width, headerHeight: header.getBoundingClientRect().height, overflow: sidebar.scrollWidth > sidebar.clientWidth,
          rowHeights: rows.map(row => row.getBoundingClientRect().height),
          rowTextFits: rows.every(row => [...row.querySelectorAll('span')].filter(span => span.textContent.trim()).every(span => { const box = span.getBoundingClientRect(); const rowBox = row.getBoundingClientRect(); return box.top >= rowBox.top && box.bottom <= rowBox.bottom })),
          controlsFit: controls.every(element => { const rect = element.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right && rect.width >= 24 }) }
      })()`)
      assert.equal(measured.overflow, false, `${theme} ${width}: sidebar overflow`)
      assert.equal(measured.controlsFit, true, `${theme} ${width}: clipped control`)
      assert.ok(measured.rowHeights.length >= 5 && measured.rowHeights.every(height => height === 48), `${theme} ${width}: inconsistent collection and terminal row heights`)
      assert.equal(measured.rowTextFits, true, `${theme} ${width}: vertically clipped row text`)
      assert.ok(measured.headerHeight <= 56, `${theme} ${width}: header too tall`)
      assert.equal(await cdp.evaluate(`document.querySelector('[data-testid="pane-header"]') === null && document.querySelector('[aria-label="Search sessions"]') === null`), true)
      assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-sidebar]')).backgroundColor === getComputedStyle(document.querySelector('[data-tauri-drag-region]').parentElement).backgroundColor`), true)
      assert.deepEqual(await cdp.evaluate(`(() => { const button = document.querySelector('[aria-label="Show performance metrics"]'); const rect = button.getBoundingClientRect(); return { previous: button.previousElementSibling.getAttribute('aria-label'), next: button.nextElementSibling.getAttribute('aria-label'), text: button.textContent, width: rect.width, height: rect.height } })()`), { previous: 'Notifications', next: 'Open command palette', text: '', width: 28, height: 28 })
      metrics.push({ theme, ...measured })
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(output, `${theme}-${width}.png`), Buffer.from(shot.data, 'base64'))
    }
    await cdp.evaluate(`document.querySelector('[aria-label="Show performance metrics"]').focus()`)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await cdp.waitFor(`document.body.textContent.includes('CPU Load') && document.body.textContent.includes('Memory') && document.body.textContent.includes('GPU')`)
    await cdp.evaluate(`document.querySelector('[data-terminal-surface] [aria-label="Close"]').click()`)
    await cdp.waitFor(`!document.body.textContent.includes('CPU Load')`)
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
    await cdp.evaluate(`document.querySelector('[aria-label="Notifications"]').focus(); document.querySelector('[aria-label="Notifications"]').click()`)
    await cdp.waitFor(`!!document.querySelector('[aria-label="Notification view"]')`)
    const notification = await cdp.evaluate(`(() => { const panel = document.querySelector('[role="dialog"]'); const bounds = panel.getBoundingClientRect(); return { text: panel.textContent, left: bounds.left, right: bounds.right, bottom: bounds.bottom, overflow: panel.scrollWidth > panel.clientWidth } })()`)
    assert.ok(notification.text.includes('Waiting for approval'))
    assert.ok(notification.left >= 12 && notification.right <= 1428 && notification.bottom <= 888)
    assert.equal(notification.overflow, false)
    const notificationShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(output, `notifications-${theme}-${side}.png`), Buffer.from(notificationShot.data, 'base64'))
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cdp.waitFor(`!document.querySelector('[role="dialog"]') && document.activeElement?.getAttribute('aria-label') === 'Notifications'`)
  }
  await cdp.evaluate(`window.workbenchPreview.settings.setState(state => ({settings: {...state.settings, sidebarPosition: 'left'}}))`)
  await cdp.evaluate(`document.querySelector('[data-tree-id="collection:project"]').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F2', code: 'F2', windowsVirtualKeyCode: 113 })
  await cdp.waitFor(`!!document.querySelector('[data-tree-id="collection:project"] input')`)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="collection:project"]').getBoundingClientRect().height`), 48)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.evaluate(`document.querySelector('[data-tree-id="session:shell"]').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F2', code: 'F2', windowsVirtualKeyCode: 113 })
  await cdp.waitFor(`!!document.querySelector('[data-tree-id="session:shell"] input')`)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:shell"]').getBoundingClientRect().height`), 48)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.evaluate(`document.querySelector('[data-pane-id="pane-agent"] .xterm-helper-textarea').focus()`)
  await cdp.waitFor(`document.querySelector('[data-pane-id="pane-agent"]').dataset.focused === 'true'`)
  assert.equal(await cdp.evaluate(`window.workbenchPreview.sessions.getState().activeSessionId`), 'agent')
  assert.equal(await cdp.evaluate(`document.querySelectorAll('[data-testid="pane-header"]').length`), 0)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"]').getAttribute('aria-description').includes('Claude Code · terminal-sidebar')`), true)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"] canvas') === null`), true)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"] [aria-label="Waiting for approval"]') !== null`), true)
  await cdp.evaluate(`document.querySelector('[aria-label="New terminal or collection"]').click()`)
  await cdp.waitFor(`!!document.querySelector('[role="menu"]')`)
  assert.equal(await cdp.evaluate(`document.activeElement?.getAttribute('role')`), 'menuitem')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.waitFor(`!document.querySelector('[role="menu"]')`)
  assert.equal(await cdp.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'New terminal or collection')
  await cdp.evaluate(`document.querySelector('[aria-label="Notifications"]').click()`)
  await cdp.waitFor(`!!document.querySelector('[aria-label="Notification view"]')`)
  await cdp.evaluate(`document.querySelector('[role="dialog"] strong').parentElement.click()`)
  await cdp.waitFor(`window.workbenchPreview.sessions.getState().activeSessionId === 'agent'`)
  assert.equal(await cdp.evaluate(`window.workbenchPreview.sessions.getState().agentStates.agent.status`), 'waiting_approval')
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:agent"]').dataset.agentUnread`), 'false')
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().applyAgentUpdate({ paneId: 'review', revision: 3, agent: { aiType: 'codex', status: 'working' } })`)
  await cdp.waitFor(`document.querySelector('[data-tree-id="session:review"]').dataset.agentStatus === 'working'`)
  await cdp.waitFor(`!!document.querySelector('[data-tree-id="session:review"] canvas')`)
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().setActive('review')`)
  await cdp.waitFor(`!!document.querySelector('[data-tree-id="session:review"][aria-selected="true"] canvas')`)
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().setSidebarWidth(264)`)
  let flameRevision = 4
  for (const theme of ['light', 'dark']) for (const aiType of ['claude', 'opencode', 'codex', 'omp', 'qwen', 'copilot']) {
    await cdp.evaluate(`window.workbenchPreview.setTheme(${JSON.stringify(theme)}); window.workbenchPreview.sessions.getState().setActive(${JSON.stringify(theme === 'light' ? 'review' : 'shell')}); window.workbenchPreview.sessions.getState().applyAgentUpdate({ paneId: 'review', revision: ${flameRevision++}, agent: { aiType: ${JSON.stringify(aiType)}, status: 'working' } })`)
    await cdp.waitFor(`!!document.querySelector('[data-tree-id="session:review"] [data-type="${aiType}"] canvas')`)
    await cdp.waitFor(`(() => { const canvas = document.querySelector('[data-tree-id="session:review"] canvas'); return [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data].some((value, index) => index % 4 === 3 && value > 0) })()`)
    const before = await cdp.evaluate(`document.querySelector('[data-tree-id="session:review"] canvas').toDataURL()`)
    await sleep(450)
    assert.notEqual(await cdp.evaluate(`document.querySelector('[data-tree-id="session:review"] canvas').toDataURL()`), before, `${aiType}: frozen working animation`)
    const first = await captureFlameRow()
    await sleep(450)
    const second = await captureFlameRow()
    await cdp.evaluate(`document.querySelector('[data-tree-id="session:review"] canvas').parentElement.style.visibility = 'hidden'`)
    const baseline = await captureFlameRow()
    await cdp.evaluate(`document.querySelector('[data-tree-id="session:review"] canvas').parentElement.style.visibility = ''`)
    const measured = await measureFlame(first, second, baseline)
    flames.push({ theme, aiType, ...measured })
    assert.ok(measured.visiblePixels >= 120 && measured.trailWidth >= measured.width * 0.25, `${theme} ${aiType}: flame is too faint or confined: ${JSON.stringify(measured)}`)
    assert.ok(measured.motionPixels >= 10, `${theme} ${aiType}: rendered flame is not moving`)
    writeFileSync(join(output, `flame-${theme}-${aiType}.png`), Buffer.from(second, 'base64'))
    if (theme === 'light' && aiType === 'codex') {
      for (let frame = 0; frame < 12; frame++) {
        writeFileSync(join(output, `flame-motion-${String(frame).padStart(2, '0')}.png`), Buffer.from(await captureFlameRow(), 'base64'))
        await sleep(180)
      }
    }
  }
  const flamePoint = await cdp.evaluate(`(() => { const rect = document.querySelector('[data-tree-id="session:review"]').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...flamePoint })
  await cdp.waitFor(`getComputedStyle(document.querySelector('[data-tree-id="session:review"] canvas').parentElement).opacity === '0.75'`)
  assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-tree-id="session:review"] canvas').parentElement, '::after').opacity`), '1')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 15 })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 540, height: 720, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().setSidebarWidth(160); window.workbenchPreview.sessions.getState().setActive('remote'); window.workbenchPreview.workspaces.getState().ensureVisible('remote')`)
  await cdp.waitFor(`document.querySelector('[data-tree-id="session:remote"]').textContent.includes('deploy@prod-01.example.com:2222')`)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-testid="pane-header"]') === null`), true)
  await sleep(200)
  const narrow = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'ssh-narrow.png'), Buffer.from(narrow.data, 'base64'))
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await cdp.evaluate(`window.workbenchPreview.sessions.getState().setActive('shell')`)
  await cdp.waitFor(`getComputedStyle(document.querySelector('[data-tree-id="session:review"] canvas').parentElement).display === 'none'`)
  const reducedFrame = await cdp.evaluate(`document.querySelector('[data-tree-id="session:review"] canvas').toDataURL()`)
  await sleep(450)
  assert.equal(await cdp.evaluate(`document.querySelector('[data-tree-id="session:review"] canvas').toDataURL()`), reducedFrame)
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
  await cdp.evaluate(`document.querySelector('#window-material').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await cdp.waitFor(`window.workbenchPreview.settings.getState().settings.windowMaterial === 'solid'`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 })
  await cdp.waitFor(`window.workbenchPreview.settings.getState().settings.windowMaterial === 'auto'`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.waitFor(`!document.querySelector('[role="dialog"]')`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`document.querySelector('[data-focused="true"] .xterm-helper-textarea').focus(); window.workbenchPreview.writes.length = 0`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', modifiers: 2, windowsVirtualKeyCode: 49 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1', modifiers: 2, windowsVirtualKeyCode: 49 })
  await cdp.waitFor(`window.workbenchPreview.sessions.getState().activeSessionId === 'shell' && window.workbenchPreview.workspaces.getState().activeWorkspaceId === 'main' && document.activeElement === document.querySelector('[data-pane-id="pane-shell"] .xterm-helper-textarea')`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ']', code: 'BracketRight', modifiers: 2, windowsVirtualKeyCode: 221 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ']', code: 'BracketRight', modifiers: 2, windowsVirtualKeyCode: 221 })
  await cdp.waitFor(`window.workbenchPreview.sessions.getState().activeSessionId === 'agent' && document.activeElement === document.querySelector('[data-pane-id="pane-agent"] .xterm-helper-textarea')`)
  assert.deepEqual(await cdp.evaluate(`window.workbenchPreview.writes`), [])
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ',', code: 'Comma', modifiers: 2, windowsVirtualKeyCode: 188 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ',', code: 'Comma', modifiers: 2, windowsVirtualKeyCode: 188 })
  await cdp.waitFor(`!!document.querySelector('[role="dialog"]')`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 't', code: 'KeyT', modifiers: 2, windowsVirtualKeyCode: 84 })
  assert.equal(await cdp.evaluate(`window.workbenchPreview.sessions.getState().sessions.length`), 4)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 't', code: 'KeyT', modifiers: 2, windowsVirtualKeyCode: 84 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.waitFor(`!document.querySelector('[role="dialog"]') && document.activeElement === document.querySelector('[data-pane-id="pane-agent"] .xterm-helper-textarea')`)
  const press = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers })
  }
  const searchCommands = async (query) => {
    await press('a', 'KeyA', 65, 2)
    await press('Backspace', 'Backspace', 8)
    if (query) await cdp.send('Input.insertText', { text: query })
    await cdp.waitFor(`document.querySelector('[role="combobox"]')?.value === ${JSON.stringify(query)}`)
  }
  const openPalette = async (modifiers = 10) => {
    await press('P', 'KeyP', 80, modifiers)
    await cdp.waitFor(`document.activeElement?.getAttribute('role') === 'combobox'`)
  }
  await cdp.evaluate(`window.workbenchPreview.setTheme('dark'); window.workbenchPreview.settings.setState(state => ({settings: {...state.settings, sshProfiles: [{id:'demo-prod',name:'Production',host:'prod-01.example.com',user:'deploy',port:2222}]}})); window.workbenchPreview.writes.length = 0`)
  await openPalette()
  assert.equal(await cdp.evaluate(`document.querySelector('[role="tooltip"]') === null`), true)
  const commandsDark = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'commands-dark.png'), Buffer.from(commandsDark.data, 'base64'))
  await searchCommands('切换 prod')
  assert.equal(await cdp.evaluate(`document.querySelectorAll('[role="option"]').length`), 1)
  assert.equal(await cdp.evaluate(`document.querySelector('[role="option"]').dataset.commandId`), 'session:remote')
  await press('Escape', 'Escape', 27)
  await cdp.waitFor(`!document.querySelector('[role="combobox"]') && document.activeElement === document.querySelector('[data-pane-id="pane-agent"] .xterm-helper-textarea')`)
  await openPalette()
  assert.equal(await cdp.evaluate(`document.querySelector('[role="combobox"]').value`), '')
  await searchCommands('切换 prod')
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`!document.querySelector('[role="combobox"]') && window.workbenchPreview.sessions.getState().activeSessionId === 'remote' && document.activeElement?.classList.contains('xterm-helper-textarea')`)
  assert.deepEqual(await cdp.evaluate(`window.workbenchPreview.writes`), [])
  await openPalette()
  await searchCommands('Show session details')
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`!!document.querySelector('[aria-label="Close session details"]')`)
  assert.equal(await cdp.evaluate(`document.querySelector('[role="dialog"]').textContent.includes('deploy@prod-01.example.com:2222')`), true)
  const detailShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'session-details.png'), Buffer.from(detailShot.data, 'base64'))
  await press('Escape', 'Escape', 27)
  await cdp.waitFor(`!document.querySelector('[role="dialog"]') && document.activeElement?.classList.contains('xterm-helper-textarea')`)
  await openPalette()
  await searchCommands('split horizontally')
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`window.workbenchPreview.sessions.getState().sessions.length === 5 && document.activeElement?.classList.contains('xterm-helper-textarea') && document.activeElement.closest('[data-pane-id]').dataset.focused === 'true'`)
  assert.equal(await cdp.evaluate(`(() => { const state = window.workbenchPreview.sessions.getState(); const session = state.sessions.find(item => item.id === state.activeSessionId); return session.shell === 'ssh' && session.ssh.host === 'prod-01.example.com' })()`), true)
  await openPalette()
  await searchCommands('Use Light theme')
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`document.documentElement.dataset.theme === 'light' && document.activeElement?.classList.contains('xterm-helper-textarea')`)
  await openPalette()
  await searchCommands('主题')
  const commandsLight = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'commands-light.png'), Buffer.from(commandsLight.data, 'base64'))
  await searchCommands('keyboard')
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`!document.querySelector('[role="combobox"]') && !!document.querySelector('[aria-label="Edit open command palette shortcut"]')`)
  await cdp.evaluate(`document.querySelector('[aria-label="Edit open command palette shortcut"]').focus()`)
  await press('Enter', 'Enter', 13)
  assert.equal(await cdp.evaluate(`document.body.textContent.includes('Press keys...')`), true)
  await press('p', 'KeyP', 80, 3)
  await cdp.waitFor(`window.workbenchPreview.settings.getState().settings.shortcuts.commandPalette === 'Ctrl+Alt+P'`)
  await press('Escape', 'Escape', 27)
  await cdp.waitFor(`!document.querySelector('[role="dialog"]') && document.activeElement?.classList.contains('xterm-helper-textarea')`)
  await press('P', 'KeyP', 80, 10)
  assert.equal(await cdp.evaluate(`document.querySelector('[role="combobox"]') === null`), true)
  await openPalette(3)
  await press('Tab', 'Tab', 9)
  assert.equal(await cdp.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Close command palette')
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`!document.querySelector('[role="combobox"]') && document.activeElement?.classList.contains('xterm-helper-textarea')`)
  await cdp.evaluate(`document.querySelector('[aria-label="Open command palette"]').focus()`)
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`document.activeElement?.getAttribute('role') === 'combobox'`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 520, deviceScaleFactor: 1, mobile: false })
  await searchCommands('connect Production')
  assert.equal(await cdp.evaluate(`(() => { const dialog = document.querySelector('[role="dialog"]'); const bounds = dialog.getBoundingClientRect(); return dialog.scrollWidth <= dialog.clientWidth && bounds.left >= 12 && bounds.right <= 348 && bounds.bottom <= 508 })()`), true)
  const commandsNarrow = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'commands-narrow.png'), Buffer.from(commandsNarrow.data, 'base64'))
  await searchCommands('no result for this query')
  await press('Enter', 'Enter', 13)
  assert.equal(await cdp.evaluate(`document.querySelector('[role="dialog"] [role="status"]').textContent`), '0 results')
  await press('Escape', 'Escape', 27)
  await cdp.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Open command palette'`)
  await press('b', 'KeyB', 66, 2)
  await cdp.waitFor(`!window.workbenchPreview.sessions.getState().sidebarVisible && !!document.querySelector('[aria-label="Show sidebar"]')`)
  await cdp.evaluate(`document.querySelector('[aria-label="Open command palette"]').focus()`)
  await press('Enter', 'Enter', 13)
  await cdp.waitFor(`document.activeElement?.getAttribute('role') === 'combobox'`)
  await press('Escape', 'Escape', 27)
  await cdp.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Open command palette'`)
  await cdp.evaluate(`document.querySelector('[aria-label="Show sidebar"]').click()`)
  await cdp.waitFor(`window.workbenchPreview.sessions.getState().sidebarVisible && !!document.querySelector('[aria-label="Notifications"]')`)
  for (const side of ['left', 'right']) {
    await cdp.evaluate(`window.workbenchPreview.settings.setState(state => ({settings: {...state.settings, sidebarPosition: ${JSON.stringify(side)}}}))`)
    const corner = await cdp.evaluate(`(() => { const button = document.querySelector('[aria-label="Hide sidebar"]'); const rect = button.getBoundingClientRect(); return { x: rect.left, y: rect.top, width: rect.width, height: rect.height } })()`)
    assert.ok(corner.x <= 16 && corner.y <= 12 && corner.width >= 24 && corner.height >= 24)
    const point = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    await cdp.waitFor(`!window.workbenchPreview.sessions.getState().sidebarVisible && document.activeElement?.getAttribute('aria-label') === 'Show sidebar'`)
    assert.deepEqual(await cdp.evaluate(`(() => { const rect = document.querySelector('[aria-label="Show sidebar"]').getBoundingClientRect(); return { x: rect.left, y: rect.top, width: rect.width, height: rect.height } })()`), corner)
    await press('Enter', 'Enter', 13)
    await cdp.waitFor(`window.workbenchPreview.sessions.getState().sidebarVisible && document.activeElement?.getAttribute('aria-label') === 'Hide sidebar'`)
    assert.equal(await cdp.evaluate(`document.activeElement.getAttribute('aria-pressed')`), 'true')
  }
  await cdp.evaluate(`window.workbenchPreview.settings.setState(state => ({settings: {...state.settings, sidebarPosition: 'left'}}))`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`window.workbenchPreview.setTheme('dark'); window.workbenchPreview.setMaterialResult('mica')`)
  await cdp.waitFor(`document.documentElement.dataset.windowMaterial === 'mica'`)
  assert.match(await cdp.evaluate(`getComputedStyle(document.querySelector('#root').firstElementChild).backgroundColor`), /\/ 0\.7\)$/)
  assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-sidebar]')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-terminal-surface]')).backgroundColor`), 'rgb(17, 18, 20)')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
  await cdp.waitFor(`document.documentElement.dataset.windowMaterial === 'solid'`)
  assert.equal(await cdp.evaluate(`window.workbenchPreview.materialRequests.at(-1).enabled`), false)
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await cdp.evaluate(`window.workbenchPreview.setMaterialResult('solid')`)
  await cdp.waitFor(`document.documentElement.dataset.windowMaterial === 'solid'`)
  assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('[data-sidebar]')).backgroundColor`), 'rgb(32, 32, 32)')
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ result: 'passed', renderer: forceCanvas ? 'canvas' : 'automatic', scope: 'Real React components and xterm with fixture transport; simulated material responses validate CSS gating only, not native desktop appearance; no desktop PTY or CLI integration', metrics, flames }, null, 2))
  console.log(`PASS: workbench, previews, themes, command execution, remapping and keyboard focus; screenshots in ${output}`)
} catch (error) {
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ result: 'failed', message: String(error) }, null, 2))
  if (cdp) {
    const state = await cdp.evaluate(`({active:document.activeElement?.outerHTML, error:document.querySelector('[role="alert"]')?.textContent, shortcuts:window.workbenchPreview?.settings.getState().settings.shortcuts, capturing:document.body.textContent.includes('Press keys...')})`).catch(() => null)
    writeFileSync(join(output, 'failure-state.json'), JSON.stringify(state, null, 2))
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).catch(() => null)
    if (shot) writeFileSync(join(output, 'failure.png'), Buffer.from(shot.data, 'base64'))
  }
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
