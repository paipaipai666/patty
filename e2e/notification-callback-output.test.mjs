import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import test from 'node:test'

test('native callback errors remain UTF-8 JSON across redirected Windows stdout', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('e2e/notification-callback.ps1'),
    '-ClassId', randomUUID(), '-Identity', 'com.patty.integration-test.registration-probe', '-Argument', 'patty-probe://session/target'], { windowsHide: true, timeout: 10_000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  const output = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)
  assert.equal(JSON.parse(output).hresult, '0x80040154')
})
