import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { launchApp } from './harness.mjs'
import { sleep } from './cdp.mjs'

const output = resolve('output/graphite')
const repository = resolve('.').replaceAll("'", "''")
mkdirSync(output, { recursive: true })
const app = await launchApp()
const { cdp } = app
const nativeDensity = await cdp.evaluate('devicePixelRatio')
const errors = []
let attentionSessionId = null
cdp.on('Runtime.exceptionThrown', (event) =>
  errors.push(event.exceptionDetails.text)
)
cdp.on('Runtime.consoleAPICalled', (event) => {
  if (event.type === 'error')
    errors.push(
      event.args.map((item) => item.value ?? item.description).join(' ')
    )
})
await cdp.send('Runtime.enable')

async function clickText(text) {
  const clicked = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)})
    if (!button) return false
    button.click()
    return true
  })()`)
  assert.equal(clicked, true, `Missing button: ${text}`)
}

async function press(key, keyCode) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    windowsVirtualKeyCode: keyCode
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: key,
    windowsVirtualKeyCode: keyCode
  })
}

async function screenshot(name, width = 1486, height = 1059) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: nativeDensity,
    mobile: false
  })
  await sleep(300)
  if (attentionSessionId) {
    await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
      event: 'pty:attn', payload: [${JSON.stringify(attentionSessionId)}, 'permission', 'claude']
    })`)
    await cdp.waitFor(
      `document.querySelector('[data-tree-id="session:${attentionSessionId}"]').innerText.includes('Needs input')`
    )
    await sleep(50)
  }
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width, height, scale: 1 / nativeDensity }
  })
  writeFileSync(join(output, name + '.png'), Buffer.from(data, 'base64'))
}

async function verifyFocusContrast() {
  await press('ArrowUp', 38)
  const evidence = await cdp.evaluate(`(() => {
    const row = document.querySelector('[role="treeitem"][aria-selected="true"]')
    row.focus()
    const style = getComputedStyle(row)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const rgb = (color) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    return { foreground: rgb(style.outlineColor), background: rgb(style.backgroundColor), width: style.outlineWidth, style: style.outlineStyle }
  })()`)
  const luminance = (channels) =>
    channels
      .map((value) => {
        const channel = value / 255
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4
      })
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0
      )
  const values = [
    luminance(evidence.foreground),
    luminance(evidence.background)
  ].sort((a, b) => b - a)
  const ratio = (values[0] + 0.05) / (values[1] + 0.05)
  assert.equal(evidence.style, 'solid')
  assert.ok(parseFloat(evidence.width) >= 2)
  assert.ok(ratio >= 3, `Selected row focus contrast: ${ratio}`)
  return { ...evidence, ratio }
}

async function verifyAgentAnimations(sessionId, theme) {
  const rowSelector = `[data-tree-id="session:${sessionId}"]`
  const sampleGrid = () =>
    cdp.evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(rowSelector)})
    const grid = row.querySelector('[data-type]')
    const canvas = grid?.querySelector('canvas')
    if (!canvas) return null
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    let checksum = 0
    for (let index = 0; index < pixels.length; index++) {
      checksum = (checksum * 31 + pixels[index]) >>> 0
      if (index % 4 === 3 && pixels[index] > 0) painted++
    }
    const icon = row.querySelector('[data-testid="agent-icon"]')
    const content = icon.parentElement
    return { type: grid.dataset.type, painted, checksum, shadow: getComputedStyle(icon).boxShadow, contentLayer: getComputedStyle(content).zIndex, pointerEvents: getComputedStyle(grid).pointerEvents }
  })()`)
  const emit = (attention, aiType) =>
    cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
    event: 'pty:attn', payload: [${JSON.stringify(sessionId)}, ${JSON.stringify(attention)}, ${JSON.stringify(aiType)}]
  })`)
  const animation = () =>
    cdp.evaluate(`(() => {
    const glow = document.querySelector(${JSON.stringify(rowSelector)}).querySelector('[data-testid="agent-attention-glow"]')
    const effect = glow?.getAnimations()[0]
    return { state: glow?.dataset.attention, start: effect?.startTime, duration: effect?.effect.getTiming().duration, iterations: effect?.effect.getTiming().iterations, pointerEvents: glow && getComputedStyle(glow).pointerEvents }
  })()`)
  const brands = []
  await cdp.evaluate(
    `document.querySelector(${JSON.stringify(rowSelector)}).click()`
  )
  for (const aiType of [
    'claude',
    'opencode',
    'codex',
    'omp',
    'qwen',
    'copilot'
  ]) {
    await emit('permission', aiType)
    await cdp.waitFor(
      `document.querySelector(${JSON.stringify(rowSelector)}).querySelector('[data-type="${aiType}"] canvas') !== null`
    )
    await sleep(500)
    const first = await sampleGrid()
    await sleep(240)
    const second = await sampleGrid()
    assert.equal(second.type, aiType)
    assert.ok(second.painted > 0, `${theme} ${aiType}: empty animation canvas`)
    assert.notEqual(
      first.checksum,
      second.checksum,
      `${theme} ${aiType}: frozen animation canvas`
    )
    assert.notEqual(
      second.shadow,
      'none',
      `${theme} ${aiType}: selected icon has no glow`
    )
    assert.equal(second.contentLayer, '1')
    assert.equal(second.pointerEvents, 'none')
    brands.push(second)
    const bounds = await cdp.evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(rowSelector)}).getBoundingClientRect()
      return { x: row.x, y: row.y, width: row.width, height: row.height }
    })()`)
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...bounds, scale: 1 / nativeDensity }
    })
    writeFileSync(
      join(output, `agent-${theme}-${aiType}.png`),
      Buffer.from(data, 'base64')
    )
  }

  const notifications = []
  for (const [attention, label] of [
    ['complete', 'Completed'],
    ['error', 'Error'],
    ['permission', 'Needs input']
  ]) {
    await emit(attention, 'claude')
    await cdp.waitFor(
      `document.querySelector(${JSON.stringify(rowSelector)}).innerText.includes(${JSON.stringify(label)})`
    )
    await sleep(60)
    const effect = await animation()
    assert.equal(effect.state, attention)
    assert.equal(effect.duration, 1050)
    assert.equal(effect.iterations, 1)
    assert.equal(effect.pointerEvents, 'none')
    assert.ok(typeof effect.start === 'number')
    notifications.push(effect)
  }
  const beforeRepeat = await animation()
  await emit('permission', 'claude')
  await sleep(80)
  assert.equal(
    (await animation()).start,
    beforeRepeat.start,
    'Repeated notification restarted the glow'
  )
  await emit(null, null)
  await cdp.waitFor(
    `!document.querySelector(${JSON.stringify(rowSelector)}).querySelector('canvas, [data-testid="agent-attention-glow"]')`
  )
  await emit('permission', 'claude')
  await cdp.waitFor(
    `!!document.querySelector(${JSON.stringify(rowSelector)}).querySelector('[data-type="claude"] canvas')`
  )
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await cdp.waitFor(`(() => {
    const row = document.querySelector(${JSON.stringify(rowSelector)})
    return getComputedStyle(row.querySelector('[data-type]')).display === 'none' && getComputedStyle(row.querySelector('[data-testid="agent-attention-glow"]')).display === 'none' && row.innerText.includes('Needs input')
  })()`)
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await cdp.waitFor(
    `getComputedStyle(document.querySelector(${JSON.stringify(rowSelector)}).querySelector('[data-type]')).display !== 'none'`
  )
  await cdp.evaluate(
    `document.querySelector('[data-tree-id^="session:"]').click()`
  )
  assert.equal(
    await cdp.evaluate(
      `document.querySelector('[data-tree-id^="session:"]').querySelector('canvas') === null`
    ),
    true
  )
  return {
    theme,
    brands,
    notifications,
    repeatPreservesAnimation: true,
    clearingRemovesEffects: true,
    reducedMotion: true
  }
}

try {
  assert.ok(
    resolve(app.appData).startsWith(resolve(tmpdir()) + sep + 'patty-e2e-')
  )
  await cdp.waitFor(
    `!!document.querySelector('[aria-label="Search sessions"]')`
  )
  await screenshot('empty')
  await clickText('New terminal')
  await cdp.waitFor(
    `document.querySelectorAll('.xterm').length === 1 && /PID [0-9]+/.test(document.body.innerText)`
  )
  await cdp.evaluate(
    `document.querySelector('[aria-label="Split terminal to the right"]').click()`
  )
  await cdp.waitFor(`document.querySelectorAll('.xterm').length === 2`)
  for (const [index, name] of ['PowerShell', 'Claude Code'].entries()) {
    await cdp.evaluate(
      `document.querySelectorAll('[data-tree-id^="session:"]')[${index}].focus()`
    )
    await press('F2', 113)
    await cdp.waitFor(`document.activeElement?.tagName === 'INPUT'`)
    await cdp.evaluate('document.activeElement.select()')
    await cdp.insertText(name)
    await cdp.pressEnter()
    assert.equal(
      await cdp.evaluate(
        `document.querySelectorAll('[data-tree-id^="session:"]')[${index}].getAttribute('aria-label')`
      ),
      name
    )
    assert.equal(
      await cdp.evaluate('document.activeElement?.getAttribute("role")'),
      'treeitem'
    )
  }
  assert.equal(
    await cdp.evaluate(
      `document.querySelector('[aria-label="Switch workspace"]') === null`
    ),
    true
  )
  const splitRatioBeforeNavigation = await cdp.evaluate(
    `document.querySelector('[aria-label="Resize terminal panes"]').getAttribute('aria-valuenow')`
  )
  await clickText('New terminal')
  await cdp.waitFor(
    `document.querySelectorAll('[data-tree-id^="session:"]').length === 3 && /PID [0-9]+/.test(document.body.innerText)`
  )
  await cdp.evaluate(
    `(() => {
      const row = document.querySelector('[role="treeitem"][aria-label="Terminal 3"]')
      row.click()
      row.focus()
    })()`
  )
  await cdp.waitFor(
    `document.activeElement?.getAttribute('aria-label') === 'Terminal 3'`
  )
  await press('F2', 113)
  await cdp.waitFor(`document.activeElement?.tagName === 'INPUT'`)
  await cdp.evaluate('document.activeElement.select()')
  await cdp.insertText('编译日志')
  await cdp.pressEnter()
  await cdp.waitFor(
    `document.querySelector('[aria-label="Close terminal 编译日志"]')?.offsetWidth > 0`
  )
  const visibleTerminalTitles = () =>
    cdp.evaluate(
      `Array.from(document.querySelectorAll('button[aria-label^="Close terminal "]')).filter(button => button.offsetWidth > 0).map(button => button.getAttribute('aria-label'))`
    )
  assert.deepEqual(await visibleTerminalTitles(), ['Close terminal 编译日志'])
  await screenshot('sidebar-navigation')
  await cdp.evaluate(
    `document.querySelector('[role="treeitem"][aria-label="PowerShell"]').click()`
  )
  await cdp.waitFor(
    `document.querySelector('[aria-label="Close terminal PowerShell"]')?.offsetWidth > 0`
  )
  assert.deepEqual(await visibleTerminalTitles(), [
    'Close terminal PowerShell',
    'Close terminal Claude Code'
  ])
  assert.equal(
    await cdp.evaluate(
      `document.querySelector('[aria-label="Resize terminal panes"]').getAttribute('aria-valuenow')`
    ),
    splitRatioBeforeNavigation
  )
  await screenshot('sidebar-split-navigation')
  await cdp.evaluate(
    `document.querySelector('[role="treeitem"][aria-label="编译日志"]').click()`
  )
  await cdp.waitFor(
    `document.querySelector('[aria-label="Close terminal 编译日志"]')?.offsetWidth > 0`
  )
  assert.deepEqual(await visibleTerminalTitles(), ['Close terminal 编译日志'])
  await cdp.evaluate(
    `document.querySelector('[aria-label="Close terminal 编译日志"]').click()`
  )
  await cdp.waitFor(
    `document.querySelectorAll('[data-tree-id^="session:"]').length === 2 && document.querySelectorAll('.xterm').length === 2`
  )
  await cdp.evaluate(
    `document.querySelector('[role="treeitem"][aria-label="PowerShell"]').click()`
  )
  for (const name of ['Patty', 'AgentNexus']) {
    await cdp.evaluate(
      `document.querySelector('[aria-label="New terminal or collection"]').click()`
    )
    await clickText('New Collection')
    await cdp.waitFor(
      `document.activeElement?.getAttribute('aria-label') === 'Collection name'`
    )
    await cdp.insertText(name)
    await cdp.pressEnter()
  }
  const agentId = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-tree-id^="session:"]')]
    const group = document.querySelector('[data-collection-id][aria-label="Patty"]')
    for (const row of rows) {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('application/json', JSON.stringify({ type: 'session', id: row.dataset.treeId.slice(8) }))
      group.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
    }
    return rows[1].dataset.treeId.slice(8)
  })()`)
  attentionSessionId = agentId
  await cdp.waitFor(
    `document.querySelectorAll('[role="group"] [data-tree-id^="session:"]').length === 2`
  )
  await sleep(1200)
  for (const index of [0, 1]) {
    await cdp.evaluate(
      `document.querySelectorAll('.xterm-helper-textarea')[${index}].focus()`
    )
    await cdp.insertText(
      `Clear-Host; rtk proxy git --no-pager -C '${repository}' -c color.ui=always ${index === 0 ? 'status --short' : 'log -8 --oneline'}`
    )
    await cdp.pressEnter()
  }
  await sleep(1000)
  await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
    event: 'pty:attn', payload: [${JSON.stringify(agentId)}, 'permission', 'claude']
  })`)
  await cdp.waitFor(
    `document.querySelector('[data-tree-id="session:${agentId}"]').innerText.includes('Needs input')`
  )
  await cdp.evaluate(
    `document.querySelector('[aria-label="Resize terminal panes"]').focus()`
  )
  for (let step = 0; step < 3; step++) await press('ArrowRight', 39)
  await cdp.evaluate(
    `document.querySelectorAll('.xterm-helper-textarea')[0].focus()`
  )
  await screenshot('workbench')
  const metrics = await cdp.evaluate(`({
    dpr: devicePixelRatio,
    width: innerWidth,
    height: innerHeight,
    bodyFont: getComputedStyle(document.body).font,
    terminals: [...document.querySelectorAll('.xterm')].map(element => ({
      font: getComputedStyle(element).font,
      transform: getComputedStyle(element).transform,
      width: element.clientWidth,
      height: element.clientHeight,
      screen: element.querySelector('.xterm-screen')?.getAttribute('style'),
      canvases: [...element.querySelectorAll('canvas')].map(canvas => ({ width: canvas.width, height: canvas.height, style: canvas.getAttribute('style') }))
    }))
  })`)
  writeFileSync(
    join(output, 'render-metrics.json'),
    JSON.stringify(metrics, null, 2)
  )
  const darkAgentAnimations = await verifyAgentAnimations(agentId, 'dark')

  const ratio = await cdp.evaluate(`(() => {
    const splitter = document.querySelector('[aria-label="Resize terminal panes"]')
    splitter.focus()
    return Number(splitter.getAttribute('aria-valuenow'))
  })()`)
  await press('ArrowRight', 39)
  const nextRatio = await cdp.evaluate(
    `Number(document.querySelector('[aria-label="Resize terminal panes"]').getAttribute('aria-valuenow'))`
  )
  assert.ok(nextRatio > ratio)

  await cdp.evaluate(
    `document.querySelector('[aria-label="New terminal or collection"]').click()`
  )
  await cdp.waitFor(
    `document.activeElement?.getAttribute('role') === 'menuitem'`
  )
  await press('ArrowDown', 40)
  assert.match(
    await cdp.evaluate('document.activeElement.textContent'),
    /Choose Folder/
  )
  await screenshot('create-menu')
  await press('Escape', 27)
  assert.equal(
    await cdp.evaluate(`document.activeElement?.getAttribute('aria-label')`),
    'New terminal or collection'
  )

  const tabStops = await cdp.evaluate(
    `document.querySelectorAll('[role="treeitem"][tabindex="0"]').length`
  )
  assert.equal(tabStops, 1)
  await cdp.evaluate(`document.querySelector('[role="treeitem"]').focus()`)
  await press('ArrowLeft', 37)
  await cdp.waitFor(
    `document.activeElement?.getAttribute('aria-expanded') === 'false'`
  )
  await press('ArrowRight', 39)
  await cdp.waitFor(
    `document.activeElement?.getAttribute('aria-expanded') === 'true'`
  )
  await press('ArrowDown', 40)
  assert.equal(
    await cdp.evaluate(`document.activeElement?.getAttribute('role')`),
    'treeitem'
  )
  await screenshot('keyboard-focus')
  const darkFocusContrast = await verifyFocusContrast()

  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080]
  ]) {
    await screenshot('workbench-' + width, width, height)
    const overflow = await cdp.evaluate(
      'document.documentElement.scrollWidth > innerWidth'
    )
    assert.equal(overflow, false, `Horizontal overflow at ${width}`)
  }

  await cdp.evaluate(
    `document.querySelector('[aria-label="Sidebar width"]').focus()`
  )
  await press('Home', 36)
  assert.equal(
    await cdp.evaluate(
      `document.querySelector('[aria-label="Sidebar width"]').getAttribute('aria-valuenow')`
    ),
    '160'
  )
  await cdp.evaluate(
    `document.querySelector('[data-tree-id^="session:"]').focus()`
  )
  await press('F2', 113)
  await cdp.waitFor(`document.activeElement?.tagName === 'INPUT'`)
  await cdp.evaluate('document.activeElement.select()')
  await cdp.insertText('构建任务与终端状态'.repeat(10))
  await cdp.pressEnter()
  await screenshot('narrow-sidebar', 1280, 720)
  const narrow = await cdp.evaluate(`(() => {
    const row = document.querySelector('[data-tree-id^="session:"]')
    const close = row.querySelector('button').getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    return { closeRight: close.right, rowRight: bounds.right, closeWidth: close.width, overflow: row.scrollWidth > row.clientWidth }
  })()`)
  assert.equal(narrow.overflow, false)
  assert.ok(narrow.closeRight <= narrow.rowRight && narrow.closeWidth >= 28)
  const longName = await cdp.evaluate(`(() => {
    const name = document.querySelector('[role="status"][aria-live="polite"] [title]')
    const create = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'New terminal')
    return { width: name.getBoundingClientRect().width, truncated: name.scrollWidth > name.clientWidth, buttonOverflow: create.scrollHeight > create.clientHeight }
  })()`)
  assert.ok(longName.width <= 180 && longName.truncated)
  assert.equal(longName.buttonOverflow, false)
  await cdp.evaluate(
    `document.querySelector('[data-tree-id^="session:"]').focus()`
  )
  await press('F2', 113)
  await cdp.waitFor(`document.activeElement?.tagName === 'INPUT'`)
  await cdp.evaluate('document.activeElement.select()')
  await cdp.insertText('PowerShell')
  await cdp.pressEnter()
  const handle = await cdp.evaluate(`(() => {
    const bounds = document.querySelector('[aria-label="Sidebar width"]').getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...handle,
    button: 'left',
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: handle.x + 104,
    y: handle.y,
    button: 'left',
    buttons: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: handle.x + 104,
    y: handle.y,
    button: 'left',
    clickCount: 1
  })
  await cdp.waitFor(
    `document.querySelector('[aria-label="Sidebar width"]').getAttribute('aria-valuenow') === '264'`
  )

  await clickText('Settings')
  await cdp.waitFor(`!!document.querySelector('[role="dialog"]')`)
  await screenshot('settings')
  await press('Escape', 27)
  await cdp.waitFor(`!document.querySelector('[role="dialog"]')`)

  await cdp.evaluate(`window.terminalAPI.settingsSet('theme', 'light')`)
  await sleep(500)
  await cdp.send('Page.reload')
  await cdp.waitFor(
    `getComputedStyle(document.documentElement).getPropertyValue('--bg-sidebar').trim() === '#f6f7f9'`
  )
  await cdp.waitFor(`document.querySelectorAll('.xterm').length === 2`)
  await screenshot('light-workbench')
  const lightFocusContrast = await verifyFocusContrast()
  const lightAgentAnimations = await verifyAgentAnimations(agentId, 'light')
  writeFileSync(
    join(output, 'agent-animations.json'),
    JSON.stringify(
      { dark: darkAgentAnimations, light: lightAgentAnimations },
      null,
      2
    )
  )
  writeFileSync(
    join(output, 'focus-contrast.json'),
    JSON.stringify(
      { dark: darkFocusContrast, light: lightFocusContrast },
      null,
      2
    )
  )

  await cdp.evaluate(
    `document.querySelector('[data-tauri-drag-region="deep"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 2 }))`
  )
  await cdp.waitFor(`!!document.querySelector('[aria-label="Restore"]')`)
  await cdp.evaluate(`document.querySelector('[aria-label="Restore"]').click()`)
  await cdp.waitFor(`!!document.querySelector('[aria-label="Maximize"]')`)
  assert.deepEqual(errors, [])
  writeFileSync(
    join(output, 'verification.json'),
    JSON.stringify(
      {
        result: 'passed',
        checks: [
          'real terminal creation and split',
          'real shell input',
          'sidebar navigation across named sessions and split layouts without a header workspace selector',
          'keyboard splitter',
          'menu focus and Escape',
          'one tree tab stop',
          'computed focus contrast in dark and light themes',
          'collection keyboard collapse and expand',
          'synthetic attention event rendering',
          'six agent brands animate in dark and light themes',
          'notification glow, repeat suppression and selected icon glow',
          'clearing agent effects and reduced motion',
          'responsive widths',
          'minimum sidebar width, long Chinese title and pointer resize',
          'settings dialog',
          'light theme persistence',
          'native title double click maximize and restore',
          'no runtime exceptions'
        ],
        fixture:
          'Two real PowerShell PTYs, renamed and grouped through UI events. Agent statuses use synthetic attention events for all six supported brands; no AI agent or SSH connection was started.',
        screenshots: [
          'empty',
          'sidebar-navigation',
          'sidebar-split-navigation',
          'workbench',
          'create-menu',
          'keyboard-focus',
          'workbench-1280',
          'workbench-1440',
          'workbench-1920',
          'narrow-sidebar',
          'settings',
          'light-workbench'
        ]
      },
      null,
      2
    )
  )
  console.log(
    '[graphite] PASS: terminal, split, focus, menu, responsive layout and themes'
  )
  console.log('[graphite] screenshots: ' + output)
} catch (error) {
  writeFileSync(
    join(output, 'failure.json'),
    JSON.stringify(
      {
        message: String(error),
        state: await cdp.evaluate('window.terminalAPI.stateLoad()'),
        text: await cdp.evaluate('document.body.innerText'),
        terminals: await cdp.evaluate(
          "document.querySelectorAll('.xterm').length"
        ),
        collections: await cdp.evaluate(
          "document.querySelectorAll('[data-collection-id]').length"
        ),
        errors
      },
      null,
      2
    )
  )
  await screenshot('failure')
  throw error
} finally {
  await app.close()
}
