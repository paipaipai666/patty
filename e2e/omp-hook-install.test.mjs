import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp } from './harness.mjs'

const output = resolve('output/omp-hook-install')
mkdirSync(output, { recursive: true })
const bundle = readFileSync(resolve('resources/omp-patty-hook.bundle.js'))
const hookPath = appData =>
  join(appData, 'integrations', '.omp', 'agent', 'extensions', 'patty-notifier.ts')

async function waitForBundle(path) {
  const deadline = Date.now() + 40_000
  let bytes = -1
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try {
        const current = readFileSync(path)
        bytes = current.length
        if (current.equals(bundle)) return { matched: true, bytes }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 200))
  }
  return { matched: false, bytes }
}

const app = await launchApp({
  connectDebugger: false,
  prepareAppData: appData => {
    const dest = hookPath(appData)
    mkdirSync(join(dest, '..'), { recursive: true })
    writeFileSync(dest, 'export default async function patty() {\n  return null\n}\n'.repeat(200))
  }
})

try {
  const result = await waitForBundle(hookPath(app.appData))
  const log = app.processOutput
  const report = {
    checkedAt: new Date().toISOString(),
    bundleBytes: bundle.length,
    installedBytes: result.bytes,
    replacedStaleCopy: result.matched,
    loggedInstall: /\[installer\] omp hook installed: \d+ bytes/.test(log),
    loggedUnchanged: /\[installer\] omp hook unchanged: \d+ bytes/.test(log)
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  assert.ok(result.matched, `installed hook must equal the bundle; got ${result.bytes} bytes`)
  assert.ok(report.loggedInstall, `installer must log the refreshed hook:\n${log}`)
} finally {
  await app.close()
}