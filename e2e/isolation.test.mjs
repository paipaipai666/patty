import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from './harness.mjs'
import { sleep } from './cdp.mjs'

const app = await launchApp({
  connectDebugger: false,
  state: { sessions: [], collections: [], workspaces: [] },
  settings: {
    defaultShell: 'cmd',
    notifications: { claudeCode: true, openCode: true, codex: true, ohMyPi: true, qwenCode: true, copilotCli: true }
  }
})

if (process.argv.includes('--expect-unsupported-build')) {
  try {
    const deadline = Date.now() + 10_000
    while (app.appExited === null && Date.now() < deadline) await sleep(100)
    assert.equal(app.appExited, 1, 'ordinary builds must reject the test override before startup')
    assert.equal(existsSync(join(app.appData, 'integrations')), false)
    assert.equal(existsSync(join(app.appData, 'webview')), false)
    assert.equal(existsSync(join(app.appData, 'Patty', 'patty-hook.ps1')), false)
  } finally {
    await app.close()
  }
  console.log('PASS: ordinary build rejected the test override before browser and CLI integration startup')
} else {
  const integrationHome = join(app.appData, 'integrations')
  const files = [
    '.claude/settings.json',
    '.codex/hooks.json',
    '.qwen/settings.json',
    '.copilot/hooks/patty-notifier.json',
    '.config/opencode/plugins/patty-notifier.ts',
    '.omp/agent/extensions/patty-notifier.ts'
  ].map((path) => join(integrationHome, path))

  try {
    const deadline = Date.now() + 20_000
    while (!files.every(existsSync) && Date.now() < deadline) {
      assert.equal(app.appExited, null, 'test build must remain running during integration setup')
      await sleep(100)
    }
    assert.deepEqual(files.filter((file) => !existsSync(file)), [], 'all six integrations must use the isolated directory')
    for (const file of files.slice(0, 4)) {
      const config = JSON.parse(readFileSync(file, 'utf8'))
      assert.ok(JSON.stringify(config).includes(join(app.appData, 'Patty', 'patty-hook.ps1').replaceAll('\\', '\\\\')))
    }
    assert.equal(existsSync(join(app.appData, 'AppData')), false, 'test data must not become a Windows user profile')
  } finally {
    await app.close()
  }
  console.log('PASS: six isolated CLI integrations, no redirected Windows profile')
}

assert.equal(existsSync(app.appData), false, 'temporary test data must be removed after shutdown')
await app.close()
console.log('PASS: temporary data removed; repeated cleanup succeeds')
