import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { resolveExe, waitForProcessDeath } from './harness.mjs'

const exe = resolve(resolveExe('patty-integration-test.exe'))
const programMode = process.env.PATTY_VERIFY_PROGRAM_STATUS === '1'
const output = resolve(programMode ? 'output/program-status' : 'output/notification-activation')
const root = mkdtempSync(join(tmpdir(), 'patty-e2e-notification-'))
const data = join(root, 'Patty')
mkdirSync(data)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const settings = { desktopNotifications: true, defaultShell: 'cmd', windowMaterial: 'solid', notifications: {
  claudeCode: false, openCode: false, codex: false, ohMyPi: false, qwenCode: false, copilotCli: false,
} }
const sessions = ['target', 'sibling', 'other'].map(id => ({
  id, title: id, shell: 'cmd', cwd: root, color: 'blue', collectionId: null, createdAt: 1,
}))
writeFileSync(join(data, 'settings.json'), JSON.stringify(settings))
writeFileSync(join(data, 'state.json'), JSON.stringify({
  sessions, collections: [], activeSessionId: 'other', sidebarVisible: true, sidebarWidth: 264,
  activeWorkspaceId: 'other-workspace', workspaces: [
    { id: 'target-workspace', name: 'Target', collectionId: null, focusedPaneId: 'sibling-pane',
      paneTree: { id: 'split', type: 'split', direction: 'horizontal', ratio: 0.5,
        first: { id: 'sibling-pane', type: 'leaf', sessionId: 'sibling' },
        second: { id: 'target-pane', type: 'leaf', sessionId: 'target' } } },
    { id: 'other-workspace', name: 'Other', collectionId: null, focusedPaneId: 'other-pane',
      paneTree: { id: 'other-pane', type: 'leaf', sessionId: 'other' } },
  ],
}))
let sequence = 0
let app
let processOutput = ''
let failed = false
let lastReport = null
const pids = new Set()
const observations = []

async function publish(action, fields = {}) {
  const request = { sequence: ++sequence, action, ...fields }
  const temporary = join(data, 'native-request.tmp')
  writeFileSync(temporary, JSON.stringify(request))
  const deadline = Date.now() + 2000
  for (;;) {
    try { await rename(temporary, join(data, 'native-request.json')); break }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error
      await sleep(20)
    }
  }
  return request
}

async function reply(request, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const report = JSON.parse(readFileSync(join(data, 'native-report.json'), 'utf8'))
      if (report.sequence === request.sequence) {
        assert.equal(report.error, undefined, JSON.stringify(report))
        lastReport = report
        pids.add(report.nativeProcessId)
        return report
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await sleep(60)
  }
  throw new Error(`Timed out on ${JSON.stringify(request)}\n${processOutput}`)
}

async function command(action, fields, timeout) { return reply(await publish(action, fields), timeout) }

async function until(label, check, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const report = await command('snapshot')
    if (check(report)) { observations.push({ label, ...report }); return report }
    await sleep(100)
  }
  throw new Error(`State did not converge: ${label}\n${JSON.stringify(lastReport)}`)
}

function activateCallback(argument, rejected = false, identity = lastReport.callbackIdentity) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('e2e/notification-callback.ps1'),
    '-ClassId', lastReport.callbackClassId, '-Identity', identity, '-Argument', argument], {
    windowsHide: true, encoding: 'utf8', timeout: 30_000,
  })
  if (result.error) throw result.error
  assert.equal(result.status, rejected ? 1 : 0, result.stdout + result.stderr)
  assert.equal(JSON.parse(result.stdout).hresult, rejected ? '0x80070057' : '0x00000000')
}

function protocolSupport() {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('e2e/windows-uri.ps1')], {
    windowsHide: true, encoding: 'utf8',
  }))
}

function registeredCallback() {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $path = 'CLSID\\' + $env:PATTY_TEST_CLSID + '\\LocalServer32'
    $result = @{client64=[Environment]::Is64BitProcess;views=@()}
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
      $rootKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::ClassesRoot,$view)
      try {
        $key = $rootKey.OpenSubKey($path)
        try { $result.views += @{view=[string]$view;command=$(if($key){$key.GetValue('')}else{$null})} }
        finally { if($key){$key.Dispose()} }
      } finally { $rootKey.Dispose() }
    }
    $result | ConvertTo-Json -Depth 4 -Compress
  `], { windowsHide: true, encoding: 'utf8', env: { ...process.env, PATTY_TEST_CLSID: lastReport.callbackClassId } }))
}

async function verifyPrograms() {
  await command('select', { sessionId: 'target' })
  await command('select', { sessionId: 'other' })
  const sample = report => command('program', { sessionId: 'target', report })
  const current = report => report.programs.target?.program
  await sample('blocked')
  const blocked = await until('real program output reaches sidebar attention', report => current(report)?.state === 'blocked' && report.notices.includes('target'))
  assert.equal(current(blocked).title, 'Deploy preview')
  assert.equal(current(blocked).message, 'Approve deployment')
  assert.equal(current(blocked).progress, 60)
  await command('nextAttention')
  const selected = await until('palette keyboard command selects the target split', report => report.activeWorkspaceId === 'target-workspace'
    && report.focusedPaneId === 'target-pane' && report.actualFocusPaneId === 'target-pane' && report.terminalFocused)
  assert.equal(selected.programs.target.activity.unread, false)
  await command('openDetails')
  await until('real session details show plain program metadata', report => report.text.includes('Deploy preview') && report.text.includes('Approve deployment') && report.text.includes('60%'))
  await command('closePanel')
  await sample('working')
  const working = await until('resumed program leaves attention', report => current(report)?.state === 'working' && !report.notices.includes('target'))
  await sample('invalid')
  const invalid = await until('invalid report is rejected before the following valid record', report => report.programs.target.recordCount === 2)
  assert.equal(current(invalid).revision, current(working).revision)
  assert.equal(current(invalid).state, 'working')
  await sample('done')
  await until('completed program has an unread result', report => current(report)?.state === 'done' && report.programs.target.activity.unread)
  await sample('prompt')
  await until('prompt preserves the finished result', report => current(report)?.state === 'done')
  await sample('working')
  await until('next program starts', report => current(report)?.state === 'working')
  await sample('prompt')
  await until('prompt clears volatile work', report => current(report)?.id === 'validation' && current(report)?.state === 'idle')
  await sample('done')
  await until('new completed report', report => current(report)?.state === 'done')
  await sample('reset')
  await until('full terminal reset clears reports', report => current(report) === null)
  await command('minimize')
  await until('native application is in the background', report => !report.nativeFocused)
  await command('program', { sessionId: 'sibling', report: 'error' })
  await until('program error is delivered to Windows with its terminal target', report => report.programs.sibling?.program?.state === 'error'
    && /patty-e2e:\/\/session\/sibling/.test(report.notificationXml ?? '') && report.notificationXml.includes('Reported an error'))
  await command('program', { sessionId: 'sibling', report: 'working' })
  await until('resuming dismisses the Windows notification', report => report.programs.sibling?.program?.state === 'working' && report.notificationXml === null)
}

try {
  const initial = await publish('snapshot')
  app = spawn(exe, [], { windowsHide: true, env: {
    ...process.env, APPDATA: root, PATTY_E2E_INTEGRATION_HOME: join(root, 'integrations'),
    WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'),
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  app.stdout.on('data', bytes => { processOutput = (processOutput + bytes.toString()).slice(-8000) })
  app.stderr.on('data', bytes => { processOutput = (processOutput + bytes.toString()).slice(-8000) })
  pids.add(app.pid)
  const boot = await reply(initial)
  assert.equal(boot.activeSessionId, 'other')
  if (programMode) {
    await verifyPrograms()
    await command('cleanup')
    await command('closeApp')
    await waitForProcessDeath(boot.nativeProcessId, 10_000)
    pids.delete(boot.nativeProcessId)
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'report.json'), JSON.stringify({ status: 'ok', observations }, null, 2))
    console.log('PASS: OSC 7501 real output, sidebar attention, keyboard navigation, details, cleanup and Windows delivery')
  } else {
  const notification = await command('notify', { sessionId: 'target' })
  assert.equal(notification.notificationSent, true)
  assert.ok(notification.protocolHandler, JSON.stringify(notification))
  assert.equal(resolve(notification.protocolHandler).toLowerCase(), exe.toLowerCase())
  assert.match(notification.notificationXml ?? '', /patty-e2e:\/\/session\/target/)
  const support = protocolSupport()
  observations.push({ label: 'Windows URI discovery diagnostic; callbacks do not depend on it', ...support })
  await command('select', { sessionId: 'other' })
  await command('openSettings')
  const click = process.env.PATTY_NOTIFICATION_MANUAL_CLICK === '1'
  if (click) assert.match(notification.notificationXml ?? '', /activationType="foreground"/, 'Manual verification requires a callback-activated toast')
  if (click) console.log('Waiting for a click on the Windows notification for Patty integration test')
  else activateCallback('patty-e2e://session/target')
  const warm = await until('warm COM callback selects the target split', report =>
    report.activeSessionId === 'target' && report.activeWorkspaceId === 'target-workspace'
      && report.focusedPaneId === 'target-pane' && report.actualFocusPaneId === 'target-pane'
      && report.terminalFocused && !report.settingsOpen && report.activationCount > boot.activationCount, click ? 900_000 : 20_000)
  assert.equal(warm.nativeProcessId, boot.nativeProcessId)
  const beforeRejected = await command('select', { sessionId: 'other' })
  activateCallback('patty-e2e://session/target?run=exit', true)
  activateCallback('patty-e2e://session/target', true, beforeRejected.callbackIdentity.endsWith('.dev') ? 'com.patty.integration-test' : 'com.patty.integration-test.dev')
  const rejected = await command('snapshot')
  assert.equal(rejected.activeSessionId, 'other')
  assert.equal(rejected.activationCount, beforeRejected.activationCount)
  observations.push({ label: 'callback registration before exit', ...registeredCallback() })
  await command('closeApp')
  await waitForProcessDeath(boot.nativeProcessId, 10_000)
  pids.delete(boot.nativeProcessId)
  observations.push({ label: 'callback registration after exit', ...registeredCallback() })
  const coldRequest = await publish('snapshot')
  activateCallback('patty-e2e://session/target')
  await reply(coldRequest)
  const cold = await until('cold COM activation selects the target split', report =>
    report.activeSessionId === 'target' && report.activeWorkspaceId === 'target-workspace'
      && report.focusedPaneId === 'target-pane' && report.actualFocusPaneId === 'target-pane' && report.terminalFocused)
  assert.notEqual(cold.nativeProcessId, boot.nativeProcessId)
  await command('remove', { sessionId: 'target' })
  await command('select', { sessionId: 'other' })
  activateCallback('patty-e2e://session/target')
  await until('missing target retains the current terminal', report =>
    report.activeSessionId === 'other' && report.text.includes('This session is no longer available.'))
  await command('cleanup')
  await command('closeApp')
  await waitForProcessDeath(cold.nativeProcessId, 10_000)
  pids.delete(cold.nativeProcessId)
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'report.json'), JSON.stringify({ status: 'ok', manualClick: process.env.PATTY_NOTIFICATION_MANUAL_CLICK === '1', observations }, null, 2))
  console.log('PASS: Windows notification delivery, system COM warm/cold activation, workspace/split focus, rejected and missing targets')
  }
} catch (error) {
  failed = true
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'report.json'), JSON.stringify({ status: 'error', error: String(error), lastReport, observations }, null, 2))
  console.error(error)
  throw error
} finally {
  if (pids.size > 0) {
    try { await command('cleanup', {}, 3000) }
    catch (error) { console.error('Native test cleanup:', String(error)) }
  }
  const remaining = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -eq $env:PATTY_TEST_EXE -and $_.CommandLine -and $_.CommandLine.Contains($env:PATTY_TEST_ROOT)
    } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress
  `], { windowsHide: true, encoding: 'utf8', env: { ...process.env, PATTY_TEST_EXE: exe, PATTY_TEST_ROOT: root } }).trim()
  for (const pid of remaining ? [].concat(JSON.parse(remaining)) : []) pids.add(pid)
  for (const pid of pids) {
    try { process.kill(pid, 0); execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }) } catch {}
  }
  await sleep(500)
  try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $owned = $false
    if ($env:PATTY_TEST_CLSID -match '^\\{[0-9A-Fa-f-]{36}\\}$') {
      $callback = 'HKCU:\\Software\\Classes\\CLSID\\' + $env:PATTY_TEST_CLSID
      $server = Get-Item -LiteralPath ($callback + '\\LocalServer32') -ErrorAction SilentlyContinue
      if ($server) {
        $command = $server.GetValue('')
        if (-not ($command.Contains($env:PATTY_TEST_EXE) -and $command.Contains($env:PATTY_TEST_ROOT))) { throw 'Test callback ownership differs; registration retained' }
        Remove-Item -LiteralPath $callback -Recurse -Force
        $owned = $true
      }
    }
    $protocol = 'HKCU:\\Software\\Classes\\patty-e2e'
    $key = Get-Item -LiteralPath ($protocol + '\\shell\\open\\command') -ErrorAction SilentlyContinue
    if ($key) {
      $value = $key.GetValue('')
      if ($value.Contains($env:PATTY_TEST_EXE) -and $value.Contains($env:PATTY_TEST_ROOT)) {
        Remove-Item -LiteralPath $protocol -Recurse -Force
        $owned = $true
      } else { throw 'Test protocol ownership differs; registration retained' }
    }
    if ($owned) {
      foreach ($identity in @('com.patty.integration-test', 'com.patty.integration-test.dev')) {
        Remove-Item -LiteralPath ('HKCU:\\Software\\Classes\\AppUserModelId\\' + $identity) -Recurse -Force -ErrorAction SilentlyContinue
      }
      $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Patty integration test.lnk'
      if (Test-Path -LiteralPath $shortcut) {
        $shell = New-Object -ComObject WScript.Shell
        if ($shell.CreateShortcut($shortcut).TargetPath -eq $env:PATTY_TEST_EXE) { Remove-Item -LiteralPath $shortcut -Force }
      }
    }
    exit 0
  `], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PATTY_TEST_EXE: exe, PATTY_TEST_ROOT: root, PATTY_TEST_CLSID: lastReport?.callbackClassId ?? '' } }) }
  catch (error) { if (!failed) throw error; console.error('Test registration cleanup failed:', String(error)) }
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  assert.ok(basename(root).startsWith('patty-e2e-notification-'))
  if (existsSync(root)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
