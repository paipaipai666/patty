import assert from 'node:assert/strict'
import { existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './harness.mjs'

const output = resolve('output/omp-navigation/desktop')
const workspace = resolve('output/omp-navigation')
const visualOnly = process.argv.includes('--rail-visual')
const reportFile = join(output, visualOnly ? 'rail-visual-report.json' : 'report.json')
mkdirSync(output, { recursive: true })
const backgroundReady = join(output, 'background-ready')
const browseActive = join(output, 'browse-active')
if (existsSync(backgroundReady)) rmSync(backgroundReady)
if (existsSync(browseActive)) rmSync(browseActive)
const ompHome = join(workspace, 'omp-home')
const ompExtensions = join(ompHome, '.omp', 'agent', 'extensions')
mkdirSync(ompExtensions, { recursive: true })
copyFileSync(resolve('resources/omp-patty-hook.bundle.js'), join(ompExtensions, 'patty-notifier.ts'))
const timestamp = new Date().toISOString()
const entries = [{ type: 'session', version: 3, id: 'desktop-navigation-fixture', cwd: workspace, timestamp }]
const fixtureTurnCount = 650
let parentId = null
for (let index = 0; index < fixtureTurnCount; index++) {
  const id = `turn-${String(index).padStart(3, '0')}`
  entries.push({ type: 'message', id, parentId, timestamp, message: { role: 'user',
    content: index === 0 ? 'OMP_NAV_QUESTION_000' : `Question ${index}: inspect the historical reply`, timestamp: Date.now() } })
  parentId = id
  const assistantId = `reply-${index}`
  entries.push({ type: 'message', id: assistantId, parentId, timestamp, message: { role: 'assistant', timestamp: Date.now(),
    api: 'anthropic-messages', provider: 'anthropic', model: 'fixture', stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: 'thinking', thinking: `Historical reasoning ${index}\n`.repeat(12) }, { type: 'text', text: `Historical reply ${index}\n` + 'Completed result\n'.repeat(4) }] } })
  parentId = assistantId
}
entries.push({ type: 'message', id: 'turn-live', parentId, timestamp, message: { role: 'user', content: 'OMP_NAV_LIVE_TAIL', timestamp: Date.now() } })
const session = join(output, 'session.jsonl')
writeFileSync(session, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
const app = await launchApp({ state: {
  sessions: [{ id: 'omp-navigation', title: 'OMP navigation', color: 'blue', shell: 'cmd', cwd: workspace, createdAt: 1, collectionId: null }],
  collections: [], activeSessionId: 'omp-navigation', sidebarVisible: true, sidebarWidth: 240,
  activeWorkspaceId: 'navigation-workspace', workspaces: [{ id: 'navigation-workspace', name: 'OMP navigation', collectionId: null,
    focusedPaneId: 'navigation-pane', paneTree: { id: 'navigation-pane', type: 'leaf', sessionId: 'omp-navigation' } }]
}, settings: { defaultShell: 'cmd', scrollback: 1000, desktopNotifications: false,
  notifications: { claudeCode: false, openCode: false, codex: false, ohMyPi: true, qwenCode: false, copilotCli: false } } })
const { cdp } = app
const status = `window.__TAURI_INTERNALS__.invoke('omp_navigation_status',{paneId:'omp-navigation'})`
const view = `window.__PATTY_OMP_VERIFY__?.snapshot('omp-navigation')`
const quote = value => `"${value}"`
const ompExe = process.env.OMP_EXE ?? join(process.env.USERPROFILE ?? '', '.bun', 'bin', 'omp.exe')
const command = [quote(ompExe), '--resume', quote(session),
  '--extension', quote(resolve('integrations/omp/desktop-fixture.ts')),
  '--no-rules', '--no-skills', '--no-context-files', '--no-tools', '--no-lsp', '--no-title', '--cwd', quote(workspace)].join(' ')
const report = { passed: false, validation: visualOnly ? 'rail visual interactions' : 'full navigation and rail', transport: 'real ConPTY', renderer: 'real WebView2 xterm', firstTurn: false, returnedLive: false, generatedWhileBrowsing: false }
writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
const railSelector = '[data-turn-rail]'
const viewportSelector = '[data-turn-viewport]'
const previewSelector = '[aria-label="Conversation turn preview"]'
const measureRail = `(() => {
  const rail = document.querySelector('${railSelector}')
  const viewport = document.querySelector('${viewportSelector}')
  const pane = document.querySelector('[data-pane-id="navigation-pane"]')
  if (!rail || !viewport || !pane) return null
  const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } }
  const bounds = box(viewport)
  const marks = [...viewport.querySelectorAll('[data-entry-id]')].map(element => {
    const mark = element.querySelector('[data-turn-mark]')
    return { entryId: element.dataset.entryId, ...box(element), length: mark.getBoundingClientRect().width,
      distance: Number(mark.dataset.distance), color: getComputedStyle(mark).backgroundColor }
  })
  return { rail: box(rail), viewport: bounds, pane: box(pane), expanded: rail.dataset.expanded, background: getComputedStyle(rail).backgroundColor,
    scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight, rendered: marks.length,
    marks: marks.filter(mark => mark.top >= bounds.top && mark.bottom <= bounds.bottom) }
})()`

async function pointer(point) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0, modifiers: 0 })
}

async function click(selector) {
  const point = await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error('Missing click target: ' + ${JSON.stringify(selector)})
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await pointer(point)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, modifiers: 0, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, modifiers: 0, clickCount: 1 })
}

async function screenshot(name) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, name + '.png'), Buffer.from(image.data, 'base64'))
}

function semanticPosition(snapshot) {
  const position = snapshot.position
  return { mode: position.mode, entryId: position.entryId, anchor: position.anchor }
}

async function hoverMark() {
  await pointer({ x: 40, y: 30 })
  const current = await cdp.evaluate(status)
  if (current.position.mode === 'browsing' && current.position.entryId.startsWith('turn-') && current.latestRequest?.status?.shown) {
    await cdp.waitFor(`document.querySelector('[data-entry-id="${current.position.entryId}"][aria-current="true"]')`)
  }
  await cdp.evaluate(`new Promise((resolve, reject) => {
    let previous = ''; let stable = 0; let frames = 0
    const sample = () => {
      const element = document.querySelector('${viewportSelector}')
      const key = element ? element.scrollTop + ':' + element.clientHeight + ':' + element.scrollHeight : ''
      stable = key && key === previous ? stable + 1 : 0
      previous = key
      if (stable >= 2) resolve()
      else if (++frames >= 120) reject(new Error('The rail did not settle before pointer hit testing'))
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })`)
  const measured = await cdp.evaluate(measureRail)
  if (!measured || measured.marks.length < 9) report.hoverFailure = { before: measured, position: current.position }
  assert.ok(measured?.marks.length >= 9, 'the rail must expose enough real marks for a distance gradient')
  const target = measured.marks[Math.floor(measured.marks.length / 2)]
  const point = { x: measured.rail.right - 4, y: target.top + target.height / 2 }
  await pointer(point)
  try {
    await cdp.waitFor(`document.querySelector('${previewSelector}') && document.querySelector('[data-entry-id="${target.entryId}"] [data-turn-mark]').getBoundingClientRect().width >= 47.8`)
  } catch (error) {
    report.hoverFailure = { target, point, before: measured, after: await cdp.evaluate(measureRail), hit: await cdp.evaluate(`document.elementsFromPoint(${point.x},${point.y}).slice(0,5).map(element => ({tag:element.tagName,entryId:element.dataset.entryId,label:element.getAttribute('aria-label'),className:element.className}))`), realPointerEvents: await cdp.evaluate('window.__railPointerEvents') }
    await cdp.evaluate(`document.elementFromPoint(${point.x},${point.y}).dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:${point.x},clientY:${point.y},pointerId:1,pointerType:'mouse',buttons:0}))`)
    await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    report.hoverFailure.afterSyntheticPointer = await cdp.evaluate(measureRail)
    throw error
  }
  await cdp.evaluate(`Promise.all(document.querySelector('${previewSelector}').getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})))`)
  await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  return target.entryId
}

async function collapseRail() {
  await pointer({ x: 40, y: 30 })
  await cdp.waitFor(`document.querySelector('${railSelector}')?.dataset.expanded === 'false' && !document.querySelector('${previewSelector}')`)
  assert.ok(Math.abs((await cdp.evaluate(measureRail)).rail.width - 24) <= 1)
}

async function stableTerminal(label) {
  const deadline = Date.now() + 10000
  let previous = ''
  let unchangedSince = 0
  while (Date.now() < deadline) {
    const terminal = await cdp.evaluate(view)
    const serialized = JSON.stringify(terminal)
    const expectedVisible = terminal.lines.join('\n').includes(label === 'live' ? 'OMP_NAV_LIVE_TAIL' : 'OMP_NAV_QUESTION_000')
    if (serialized !== previous || !expectedVisible) unchangedSince = Date.now()
    else if (Date.now() - unchangedSince >= 500) return terminal
    previous = serialized
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${label}: the terminal did not finish rendering its source output before wheel verification`)
}

async function verifyWheelIsolation(label) {
  const terminal = await stableTerminal(label)
  const before = await cdp.evaluate(measureRail)
  const beforeStatus = await cdp.evaluate(status)
  const position = semanticPosition(beforeStatus)
  const requestId = beforeStatus.latestRequest?.requestId
  const target = before.marks[Math.floor(before.marks.length / 2)]
  const point = { x: before.rail.right - 4, y: target.top + target.height / 2 }
  await pointer(point)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: before.scrollTop > 0 ? -240 : 240 })
  await cdp.waitFor(`Math.abs(document.querySelector('${viewportSelector}').scrollTop - ${before.scrollTop}) > 100`)
  await new Promise(resolve => setTimeout(resolve, 200))
  const after = await cdp.evaluate(measureRail)
  assert.notDeepEqual(after.marks.map(mark => mark.entryId), before.marks.map(mark => mark.entryId))
  assert.ok(after.rendered < 80, 'the real rail must virtualize the 651-turn fixture')
  const afterPosition = await cdp.evaluate(status)
  assert.deepEqual(semanticPosition(afterPosition), position, `${label}: wheel changed the OMP reading position`)
  assert.equal(afterPosition.latestRequest?.requestId, requestId, `${label}: wheel issued a navigation request`)
  assert.equal(afterPosition.position.displayEpoch, beforeStatus.position.displayEpoch, `${label}: wheel input reached the native terminal`)
  const afterTerminal = await cdp.evaluate(view)
  assert.equal(afterTerminal.viewportY, terminal.viewportY, `${label}: wheel reached xterm scrollback`)
  assert.equal(afterTerminal.type, terminal.type)
  assert.deepEqual(afterTerminal.lines, terminal.lines, `${label}: wheel changed the displayed terminal content`)
  for (const boundary of ['top', 'bottom']) {
    await cdp.evaluate(`(() => {const element=document.querySelector('${viewportSelector}');element.scrollTop=${boundary === 'top' ? '0' : 'element.scrollHeight-element.clientHeight'}})()`)
    await cdp.waitFor(`(() => {const element=document.querySelector('${viewportSelector}');return Math.abs(element.scrollTop-(${boundary === 'top' ? '0' : 'element.scrollHeight-element.clientHeight'}))<1})()`)
    const edge = (await cdp.evaluate(measureRail)).scrollTop
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: boundary === 'top' ? -240 : 240 })
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.ok(Math.abs((await cdp.evaluate(measureRail)).scrollTop - edge) < 1)
    assert.equal((await cdp.evaluate(view)).viewportY, terminal.viewportY, `${label}: a wheel event at the ${boundary} rail boundary leaked to xterm`)
    const edgePosition = await cdp.evaluate(status)
    assert.deepEqual(semanticPosition(edgePosition), position)
    assert.equal(edgePosition.position.displayEpoch, beforeStatus.position.displayEpoch, `${label}: the ${boundary} edge forwarded wheel input to OMP`)
  }
  await cdp.evaluate(`document.querySelector('${viewportSelector}').scrollTop = 0`)
  return { rendered: after.rendered, scrollTopBefore: before.scrollTop, scrollTopAfter: after.scrollTop, boundaryContained: true, boundaries: ['top', 'bottom'] }
}

async function returnLive() {
  await hoverMark()
  await click('[aria-label="Return to live terminal"]')
}

async function searchTurn(prompt) {
  await click('[aria-label="Open conversation turns"]')
  await cdp.waitFor(`document.querySelector('[aria-label="Search conversation turns"]')`)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[aria-label="Search conversation turns"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(prompt)})
    input.dispatchEvent(new Event('input',{bubbles:true}))
  })()`)
}

async function changeTheme(theme) {
  await click('[aria-label="Open command palette"]')
  await cdp.waitFor(`document.querySelector('[aria-label="Search commands"]')`)
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[aria-label="Search commands"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(`Use ${theme === 'light' ? 'Light' : 'Dark'} theme`)})
    input.dispatchEvent(new Event('input',{bubbles:true}))
  })()`)
  await cdp.waitFor(`document.querySelector('[data-command-id="theme:${theme}"]')`)
  await click(`[data-command-id="theme:${theme}"]`)
  await cdp.waitFor(`!document.querySelector('[aria-label="Search commands"]') && document.documentElement.dataset.theme === '${theme}'`)
}

async function captureResponsiveRail(theme, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await collapseRail()
  const collapsed = await cdp.evaluate(measureRail)
  assert.ok(collapsed.rail.left >= 0 && collapsed.rail.right <= width, 'collapsed rail overflowed the viewport')
  assert.ok(collapsed.rail.top >= 0 && collapsed.rail.bottom <= height, 'collapsed rail was vertically clipped')
  await screenshot(`rail-${theme}-${width}-collapsed`)
  await hoverMark()
  const preview = await cdp.evaluate(`(() => {
    const element = document.querySelector('${previewSelector}')
    const rect = element.getBoundingClientRect()
    const content = document.querySelector('${railSelector}').parentElement.getBoundingClientRect()
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, contentLeft: content.left, contentRight: content.right,
      leftHit: element.contains(document.elementFromPoint(rect.left + 4, rect.top + 16)),
      rightHit: element.contains(document.elementFromPoint(rect.right - 4, rect.top + 16)) }
  })()`)
  await screenshot(`rail-${theme}-${width}-preview`)
  report.responsiveMeasurement = { theme, width, height, collapsed: collapsed.rail, preview }
  assert.ok(preview.left >= 0 && preview.right <= width, `the ${width}px preview overflowed horizontally: ${JSON.stringify(preview)}`)
  assert.ok(preview.top >= 0 && preview.bottom <= height, `the ${width}px preview overflowed vertically: ${JSON.stringify(preview)}`)
  assert.ok(preview.leftHit && preview.rightHit, `the ${width}px preview is clipped or covered despite its DOM rectangle: ${JSON.stringify(preview)}`)
  await collapseRail()
  return { theme, width, height, collapsed: collapsed.rail, preview }
}

try {
  await cdp.evaluate(`(() => {
    window.__railPointerEvents=[]
    const target = element => element instanceof Element ? {tag:element.tagName,entryId:element.getAttribute('data-entry-id'),label:element.getAttribute('aria-label'),className:element.getAttribute('class')} : null
    for(const type of ['pointermove','pointerover','pointerout','mousemove','mousedown','mouseup']) document.addEventListener(type,event=>{
      window.__railPointerEvents.push({type:event.type,x:event.clientX,y:event.clientY,buttons:event.buttons,pointerId:event.pointerId,captured:event.target instanceof Element && typeof event.target.hasPointerCapture==='function' ? event.target.hasPointerCapture(event.pointerId):false,target:target(event.target),related:target(event.relatedTarget),path:event.composedPath().slice(0,5).map(target)})
      if(window.__railPointerEvents.length>80)window.__railPointerEvents.shift()
    },true)
  })()`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.waitFor(`${view} !== null && ${view} !== undefined`)
  await cdp.evaluate(`window.terminalAPI.write('omp-navigation',${JSON.stringify(`set "USERPROFILE=${ompHome}"\r${command}\r`)})`)
  await cdp.waitFor(`(await ${status}).turnCount === ${fixtureTurnCount + 1}`, 30000)
  await cdp.waitFor(`document.querySelector('[aria-label="Open conversation turns"]')`)
  await cdp.waitFor(`window.__PATTY_OMP_VERIFY__.snapshot('omp-navigation').lines.join('\\n').includes('OMP_NAV_LIVE_TAIL') && !window.__PATTY_OMP_VERIFY__.contains('omp-navigation','OMP_NAV_QUESTION_000')`, 15000)
  const before = await cdp.evaluate(view)
  assert.equal(before.type, 'normal')
  assert.equal(await cdp.evaluate(`window.__PATTY_OMP_VERIFY__.contains('omp-navigation','OMP_NAV_QUESTION_000')`), false)
  await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
  await collapseRail()
  const collapsed = await cdp.evaluate(measureRail)
  assert.equal(await cdp.evaluate(`document.querySelector('[role="toolbar"][aria-label="Conversation navigation"]') === null`), true)
  assert.ok(Math.abs(collapsed.pane.right - collapsed.rail.right - 18) <= 2)
  assert.ok(collapsed.viewport.height <= 276)
  assert.ok(collapsed.rendered < 80)
  assert.equal(collapsed.background, 'rgba(0, 0, 0, 0)')
  assert.ok(collapsed.marks.every(mark => Math.abs(mark.length - 8) <= 0.8))
  await screenshot('rail-dark-collapsed')
  const beforeHoverPosition = semanticPosition(await cdp.evaluate(status))
  const hoveredId = await hoverMark()
  const expanded = await cdp.evaluate(measureRail)
  for (const [distance, expected] of [[0, 48], [1, 34], [2, 22], [3, 15], [4, 10]]) {
    const marks = expanded.marks.filter(item => item.distance === distance)
    assert.equal(marks.length, distance === 0 ? 1 : 2, `distance ${distance} must affect both neighbors`)
    assert.ok(marks.every(mark => Math.abs(mark.length - expected) <= 0.8), `distance ${distance} expected ${expected}px, received ${JSON.stringify(marks)}`)
  }
  assert.notEqual(expanded.marks.find(mark => mark.distance === 0).color, expanded.marks.find(mark => mark.distance === 4).color)
  assert.ok(Math.abs(expanded.rail.width - 64) <= 1)
  const expectedPrompt = entries.find(entry => entry.id === hoveredId)?.message.content
  assert.equal(await cdp.evaluate(`document.querySelector('${previewSelector}').textContent.includes(${JSON.stringify(expectedPrompt)})`), true)
  assert.equal(await cdp.evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea')`), true)
  assert.deepEqual(semanticPosition(await cdp.evaluate(status)), beforeHoverPosition)
  assert.deepEqual(expanded.pane, collapsed.pane)
  await screenshot('rail-dark-hover')
  report.hoverGradient = { lengths: [48, 34, 22, 15, 10], previewEntryId: hoveredId, preservedTerminalFocus: true }
  report.wheelLive = await verifyWheelIsolation('live')
  await collapseRail()
  report.collapsedRail = { width: collapsed.rail.width, viewportHeight: collapsed.viewport.height, noToolbar: true }
  report.responsive = []
  await changeTheme('light')
  for (const [width, height] of [[1440, 900], [540, 720], [360, 520]]) report.responsive.push(await captureResponsiveRail('light', width, height))
  await changeTheme('dark')
  report.responsive.push(await captureResponsiveRail('dark', 360, 520))
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  if (!visualOnly) {
  await searchTurn('OMP_NAV_QUESTION_000')
  await cdp.waitFor(`document.querySelector('[data-entry-id="turn-000"]')`)
  await screenshot('directory')
  const start = Date.now()
  await click('[data-entry-id="turn-000"]')
  await cdp.waitFor(`(await ${status}).latestRequest?.status?.shown === true`, 10000)
  const first = await cdp.evaluate(view)
  assert.equal(first.type, 'alternate')
  assert.match(first.lines.join('\n'), /OMP_NAV_QUESTION_000/)
  const historyScrollbar = await cdp.evaluate(`(() => {
    const bar = document.querySelector('[data-omp-history-scrollbar]')
    const thumb = bar?.querySelector('[class*="historyScrollbarThumb"]')
    return bar && thumb ? { width: bar.getBoundingClientRect().width, height: bar.getBoundingClientRect().height, thumbHeight: thumb.getBoundingClientRect().height, thumbTop: thumb.style.top } : null
  })()`)
  assert.ok(historyScrollbar && historyScrollbar.height > 0 && historyScrollbar.thumbHeight > 0, 'history browsing must expose the terminal scrollbar')
  report.historyScrollbar = historyScrollbar
  report.firstTurn = true
  report.jumpToShownUpperBoundMs = Date.now() - start
  writeFileSync(browseActive, '1')
  const firstImage = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'first-turn.png'), Buffer.from(firstImage.data, 'base64'))
  report.wheelHistory = await verifyWheelIsolation('history')
  const backgroundDeadline = Date.now() + 5000
  while (!existsSync(backgroundReady) && Date.now() < backgroundDeadline) await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(existsSync(backgroundReady), true, 'the fixture must append its update while history is visible')
  await cdp.waitFor(`(await ${status}).position.mode === 'browsing'`)
  await returnLive()
  await cdp.waitFor(`(await ${status}).latestRequest?.status?.shown === true && (await ${status}).position.mode === 'live'`, 10000)
  const live = await cdp.evaluate(view)
  assert.equal(live.type, 'normal')
  await cdp.waitFor(`window.__PATTY_OMP_VERIFY__.snapshot('omp-navigation').lines.join('\\n').includes('OMP_NAV_GENERATED_WHILE_BROWSING')`, 5000)
  report.returnedLive = true
  report.generatedWhileBrowsing = true
  const previousRequest = (await cdp.evaluate(status)).latestRequest.requestId
  await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, modifiers: 10 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, modifiers: 10 })
  await cdp.waitFor(`(await ${status}).latestRequest?.requestId !== ${JSON.stringify(previousRequest)} && (await ${status}).latestRequest?.status?.shown === true && (await ${status}).position.entryId === 'turn-live'`)
  report.previousShortcut = true
  await cdp.insertText('中文草稿')
  await cdp.waitFor(`(await ${status}).position.mode === 'live' && window.__PATTY_OMP_VERIFY__.snapshot('omp-navigation').lines.join('\\n').includes('中文草稿')`)
  const draftView = await cdp.evaluate(view)
  assert.equal(draftView.lines.join('\n').split('中文草稿').length - 1, 1)
  report.committedUnicodeInputExactlyOnce = true
  await searchTurn('OMP_NAV_QUESTION_000')
  await cdp.waitFor(`document.querySelector('[data-entry-id="turn-000"]')`)
  await click('[data-entry-id="turn-000"]')
  await cdp.waitFor(`(await ${status}).position.entryId === 'turn-000' && (await ${status}).latestRequest?.status?.shown === true`)
  await returnLive()
  await cdp.waitFor(`(await ${status}).position.mode === 'live' && (await ${status}).latestRequest?.status?.shown === true`)
  assert.equal((await cdp.evaluate(view)).lines.join('\n').split('中文草稿').length - 1, 1)
  report.draftPreservedAcrossNavigation = true
  await searchTurn('OMP_NAV_LIVE_TAIL')
  await cdp.waitFor(`document.querySelector('[data-entry-id="turn-live"]')`)
  await click('[data-entry-id="turn-live"]')
  await cdp.waitFor(`(await ${status}).position.entryId === 'turn-live' && (await ${status}).latestRequest?.status?.shown === true`)
  await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
  for (let index = 0; index < 40; index++) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, modifiers: 0 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, modifiers: 0 })
  }
  await cdp.waitFor(`(await ${status}).position.mode === 'live' && (await ${status}).latestRequest?.status?.shown === true`, 10000)
  const scrolledLive = await cdp.evaluate(view)
  assert.equal(scrolledLive.type, 'normal')
  assert.match(scrolledLive.lines.join('\n'), /no-model/)
  report.scrollToLive = true
  await screenshot('live')
  await cdp.evaluate(`document.querySelector('.xterm-helper-textarea').focus(); window.terminalAPI.write('omp-navigation','\\u0015/new\\r')`)
  await cdp.waitFor(`(await ${status}).kind === 'ready' && (await ${status}).sessionId !== 'desktop-navigation-fixture' && (await ${status}).turnCount === 0`, 15000)
  report.sessionSwitchRebound = true
  }
  report.passed = true
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} catch (error) {
  await screenshot(visualOnly ? 'rail-visual-failure' : 'failure').catch(() => {})
  writeFileSync(reportFile, JSON.stringify({ ...report, error: String(error) }, null, 2) + '\n')
  writeFileSync(join(output, visualOnly ? 'rail-visual-failure.json' : 'failure.json'), JSON.stringify({ error: String(error), status: await cdp.evaluate(status).catch(() => null), view: await cdp.evaluate(view).catch(() => null) }, null, 2))
  throw error
} finally { await app.close() }
