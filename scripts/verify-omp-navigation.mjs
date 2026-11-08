import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import xterm from '@xterm/xterm'

const root = fileURLToPath(new URL('..', import.meta.url))
const { Terminal } = xterm
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  assert.ok(args[index + 1], `Missing value for ${name}`)
  return args[index + 1]
}
const localBun = resolve(root, 'output/omp-navigation/runtime/bun-windows-x64/bun.exe')
const runtime = option('--bun', existsSync(localBun) ? localBun : 'bun')
const fixture = resolve(root, option('--fixture', 'integrations/omp/gate0-fixture.ts'))
const reportPath = resolve(root, option('--report', 'output/omp-navigation/gate0-report.json'))
const terminal = new Terminal({ cols: 100, rows: 28, scrollback: 1000, allowProposedApi: true })
const frames = []
const prefix = 'patty-nav-v1;'
let bytes = 0
let stderr = ''
let parseError = null
const start = performance.now()

terminal.parser.registerOscHandler(777, data => {
  if (!data.startsWith(prefix)) return false
  try {
    const metadata = JSON.parse(Buffer.from(data.slice(prefix.length), 'base64url').toString('utf8'))
    assert.equal(typeof metadata.frameId, 'string')
    assert.ok(metadata.mode === 'live' || metadata.mode === 'browsing')
    assert.equal(typeof metadata.viewRevision, 'number')
    const buffer = terminal.buffer.active
    const visible = Array.from({ length: terminal.rows }, (_, offset) =>
      buffer.getLine(buffer.viewportY + offset)?.translateToString(true) ?? '')
    let retainedFirstQuestion = false
    for (let row = 0; row < buffer.length; row++) {
      if (buffer.getLine(row)?.translateToString(true).includes('OMP_NAV_QUESTION_000')) {
        retainedFirstQuestion = true
        break
      }
    }
    frames.push({ ...metadata, screen: buffer.type, visible, retainedFirstQuestion, receivedAtMs: performance.now() - start })
  } catch (error) {
    parseError = error
  }
  return true
})

let pendingWrite = Promise.resolve()
const child = spawn(runtime, [fixture], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const timeout = setTimeout(() => child.kill(), 60_000)
child.stdout.on('data', data => {
  bytes += data.length
  pendingWrite = pendingWrite.then(() => new Promise(done => terminal.write(data, done)))
})
child.stderr.on('data', data => {
  if (stderr.length < 256 * 1024) stderr += data.toString('utf8')
})

let passed = false
let failure = null
try {
  const exit = await new Promise((done, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => done({ code, signal }))
  })
  await pendingWrite
  assert.equal(exit.code, 0, `Fixture failed: ${JSON.stringify(exit)}\n${stderr}`)
  if (parseError) throw parseError
  const before = frames.find(frame => frame.frameId === 'live-before-seek')
  const browsing = frames.find(frame => frame.frameId === 'seek-first')
  const returned = frames.find(frame => frame.frameId === 'return-live')
  assert.ok(before, 'Missing live-before-seek frame')
  assert.ok(browsing, 'Missing seek-first frame')
  assert.ok(returned, 'Missing return-live frame')
  assert.equal(before.screen, 'normal')
  assert.equal(before.retainedFirstQuestion, false, 'First question must have left retained scrollback')
  assert.equal(browsing.mode, 'browsing')
  assert.equal(browsing.screen, 'alternate')
  assert.ok(browsing.visible.some(line => line.includes('OMP_NAV_QUESTION_000')), 'Target question is not visible')
  assert.equal(returned.mode, 'live')
  assert.equal(returned.screen, 'normal')
  assert.ok(returned.visible.some(line => line.includes('OMP_NAV_LIVE_TAIL')), 'Live tail was not restored')
  assert.ok(returned.visible.some(line => line.includes('OMP_NAV_GENERATED_WHILE_BROWSING')), 'Concurrent output is missing')
  passed = true
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  terminal.dispose()
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify({
    passed,
    evidence: 'actual OMP renderer output consumed by actual xterm parser',
    excludes: ['native ConPTY transport', 'DOM renderer completion', 'full CLI integration'],
    runtime,
    fixture,
    bytes,
    durationMs: performance.now() - start,
    frames,
    stderr,
    failure
  }, null, 2)}\n`)
}
console.log(JSON.stringify({ passed, reportPath, bytes, frames: frames.length, failure }))
