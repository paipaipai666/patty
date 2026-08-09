/**
 * Shared harness for the E2E scripts: resolve the prod exe, launch it with an
 * isolated APPDATA and a WebView2 debug port, attach CDP, and clean up.
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { waitForPageTarget, Cdp, sleep } from './cdp.mjs'

/** Poll until the OS reports the pid gone (signal 0 = existence probe). */
export async function waitForProcessDeath(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (e) {
      if (e.code === 'ESRCH') return
      // EPERM still means the process exists.
    }
    await sleep(250)
  }
  throw new Error(`pid ${pid} still alive after ${timeoutMs}ms`)
}

export function resolveExe() {  if (process.env.PATTY_EXE) return process.env.PATTY_EXE
  const targetDir = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
      cwd: resolve('src-tauri'),
      encoding: 'utf8'
    })
  ).target_directory
  // Only a production exe works: plain `cargo build` leaves the `dev` cfg on
  // (tauri marks any build without the custom-protocol feature as dev), so a
  // debug exe tries to load http://127.0.0.1:1420 instead of embedded assets.
  // The Tauri CLI passes --features custom-protocol; `tauri build --no-bundle`
  // is the fast way to get a prod exe without the NSIS step.
  const exe = join(targetDir, 'release', 'patty.exe')
  if (!existsSync(exe)) {
    throw new Error(`no release exe at ${exe} — run \`npx tauri build --no-bundle\` first`)
  }
  return exe
}

/**
 * Launch Patty and attach CDP. Returns { cdp, appData, close }.
 * close() kills the process tree and removes the isolated APPDATA.
 */
export async function launchApp() {
  if (!existsSync(resolve('out/renderer/index.html'))) {
    throw new Error('out/renderer missing — run `npm run build` first')
  }
  const exe = resolveExe()
  const appData = mkdtempSync(join(tmpdir(), 'patty-e2e-'))
  const debugPort = 9300 + (process.pid % 500)
  const startedAt = Date.now()

  console.log(`[harness] exe: ${exe}`)
  console.log(`[harness] isolated APPDATA: ${appData}`)

  const app = spawn(exe, [], {
    env: {
      ...process.env,
      APPDATA: appData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`
    },
    stdio: 'ignore'
  })
  let appExited = null
  app.on('exit', (code) => { appExited = code })

  const page = await waitForPageTarget(debugPort)
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
  // Ride out WebView2's early navigation (about:blank → tauri.localhost):
  // waitFor retries through the transient context errors.
  await cdp.waitFor(`document.readyState === 'complete' && document.querySelector('#root')?.children.length > 0`)

  const close = async () => {
    cdp.close()
    if (appExited === null) {
      app.kill('SIGTERM')
      await sleep(500)
      if (appExited === null) app.kill('SIGKILL')
    }
    rmSync(appData, { recursive: true, force: true })
  }

  return { cdp, appData, startedAt, close, get appExited() { return appExited } }
}
