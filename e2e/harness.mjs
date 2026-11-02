
   
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { waitForPageTarget, Cdp, sleep } from './cdp.mjs'

                                                                           
export async function waitForProcessDeath(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (e) {
      if (e.code === 'ESRCH') return

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

  const exe = join(targetDir, 'release', 'patty.exe')
  if (!existsSync(exe)) {
    throw new Error(`no release exe at ${exe} — run \`npx tauri build --no-bundle\` first`)
  }
  return exe
}

                                                                                
async function freePort() {
  const srv = createServer()
  await new Promise((res) => srv.listen(0, '127.0.0.1', res))
  const { port } = srv.address()
  await new Promise((res) => srv.close(res))
  return port
}


   
export async function launchApp({ state, settings, connectDebugger = true } = {}) {
  if (!existsSync(resolve('out/renderer/index.html'))) {
    throw new Error('out/renderer missing — run `npm run build` first')
  }
  const exe = resolveExe()
  const appData = mkdtempSync(join(tmpdir(), 'patty-e2e-'))
  const dataDirectory = join(appData, 'Patty')
  mkdirSync(dataDirectory, { recursive: true })
  if (state) writeFileSync(join(dataDirectory, 'state.json'), JSON.stringify(state))
  if (settings) writeFileSync(join(dataDirectory, 'settings.json'), JSON.stringify(settings))
  const debugPort = await freePort()
  const startedAt = Date.now()

  console.log(`[harness] exe: ${exe}`)
  console.log(`[harness] isolated APPDATA: ${appData}`)

  const app = spawn(exe, [], {
    env: {
      ...process.env,
      APPDATA: appData,
      USERPROFILE: appData,
      WEBVIEW2_USER_DATA_FOLDER: join(appData, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let appExited = null
  let processOutput = ''
  const captureOutput = (chunk) => { processOutput = (processOutput + chunk.toString()).slice(-8000) }
  app.stdout.on('data', captureOutput)
  app.stderr.on('data', captureOutput)
  app.on('exit', (code) => { appExited = code })


  const killApp = async () => {
    if (appExited !== null) return

    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(app.pid)], { stdio: 'ignore' })
    } catch {
      app.kill('SIGKILL')
    }

    await sleep(300)
  }

  let page
  let cdp
  const close = async () => {
    cdp?.close()
    await killApp()
    rmSync(appData, { recursive: true, force: true })
  }
  if (!connectDebugger) {
    return { appData, startedAt, close, get appExited() { return appExited } }
  }
  try {
    page = await waitForPageTarget(debugPort)
    cdp = await Cdp.connect(page.webSocketDebuggerUrl)

    await cdp.waitFor(`document.readyState === 'complete' && document.querySelector('#root')?.children.length > 0`)
  } catch (e) {
    const exitBeforeCleanup = appExited
    await killApp()
    rmSync(appData, { recursive: true, force: true })
    throw new Error(`${e.message}\nApp exit before cleanup: ${exitBeforeCleanup}\n${processOutput}`, { cause: e })
  }

  return { cdp, appData, startedAt, close, get appExited() { return appExited } }
}
