import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './harness.mjs'
import { sleep } from './cdp.mjs'

const output = resolve('output/session-workflow')
mkdirSync(output, { recursive: true })

const sessions = [
  { id: 'server', title: 'Server', collectionId: 'api', cwd: resolve('.') },
  { id: 'review', title: 'Review', collectionId: null, cwd: resolve('.') },
  { id: 'scratch', title: 'Scratch', collectionId: null, cwd: '' }
].map((session) => ({ color: 'blue', shell: 'cmd', createdAt: 1, ...session }))

const app = await launchApp({
  connectDebugger: process.argv[2] !== '--native',
  state: {
    sessions,
    collections: [
      { id: 'work', name: 'Work', parentId: null, collapsed: true, createdAt: 1 },
      { id: 'api', name: 'Payments API', parentId: 'work', collapsed: true, createdAt: 2 }
    ],
    activeSessionId: 'scratch',
    sidebarVisible: true,
    sidebarWidth: 264,
    activeWorkspaceId: 'ws-scratch',
    workspaces: sessions.map((session) => ({
      id: `ws-${session.id}`,
      name: session.title,
      collectionId: session.collectionId,
      focusedPaneId: `pane-${session.id}`,
      paneTree: { id: `pane-${session.id}`, type: 'leaf', sessionId: session.id }
    }))
  },
  settings: {
    defaultShell: 'cmd',
    notifications: { claudeCode: false, openCode: false, codex: false, ohMyPi: false, qwenCode: false, copilotCli: false }
  }
})

if (process.argv[2] === '--native') {
  console.log('Native verification fixture ready; close the Patty test window when finished')
  while (app.appExited === null) await sleep(250)
  await app.close()
} else {
const { cdp } = app
const errors = []
cdp.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails.text))
await cdp.send('Runtime.enable')

const visibleSessions = `Array.from(document.querySelectorAll('[data-tree-id^="session:"]'))
  .filter(item => item.getClientRects().length > 0)
  .map(item => item.dataset.treeId.slice('session:'.length))`

async function search(query, expected) {
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[aria-label="Search sessions"]')
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await cdp.waitFor(`JSON.stringify(${visibleSessions}) === ${JSON.stringify(JSON.stringify(expected))}`)
  assert.deepEqual(await cdp.evaluate(visibleSessions), expected)
}

try {
  await cdp.waitFor('document.querySelector(\'[data-tree-id="session:scratch"]\')')
  await search('wOrK Payments Server', ['server'])
  await search(resolve('.').replaceAll('\\', '/'), ['server', 'review'])
  await search('CMD review', ['review'])
  await search('does-not-exist', [])
  assert.equal(await cdp.evaluate('document.body.innerText.includes("No matches")'), true)
  await search('Work Server', ['server'])
  await cdp.evaluate(`document.querySelector('[data-tree-id="session:server"]').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cdp.waitFor('document.querySelector(\'[data-tree-id="session:server"][aria-selected="true"]\')')
  await cdp.waitFor('document.querySelector(\'.xterm-helper-textarea\')')
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(output, 'search.png'), Buffer.from(screenshot.data, 'base64'))
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'result.json'), JSON.stringify({ search: 'passed', errors }, null, 2))
  console.log('Session workflow: contextual search, collapsed collection, empty state, and keyboard selection passed')
} finally {
  await app.close()
}
}
