import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const fixture = String.raw`
$ErrorActionPreference='Stop'
$global:__PattyTestProcessCalls=0
$global:__PattyTestGpuCalls=0
function Get-Process {
  param($Id,$ErrorAction)
  if($global:__PattyTestProcessCalls -lt 2){
    $global:__PattyTestProcessCalls++
    [pscustomobject]@{Id=11;ProcessName='patty-benchmark';TotalProcessorTime=[TimeSpan]::FromMilliseconds(10);WorkingSet64=1024;PrivateMemorySize64=2048}
  }
}
function Get-CimInstance {
  param($ClassName,$Property)
  if($ClassName -eq 'Win32_Process'){[pscustomobject]@{ProcessId=11;ParentProcessId=0;Name='patty-benchmark.exe'}}
  elseif($ClassName -eq 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine'){
    $global:__PattyTestGpuCalls++
    [pscustomobject]@{Name='pid_11_engine';UtilizationPercentage=7}
  } elseif($ClassName -eq 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory'){
    $global:__PattyTestGpuCalls++
    [pscustomobject]@{Name='pid_11_memory';DedicatedUsage=4096}
  } else {throw 'Unexpected provider'}
}
function Start-Sleep {param($Milliseconds)}
if($env:PATTY_TEST_RESOURCE_MODE){
  & $env:PATTY_TEST_SAMPLER -AppPid 11 -OutputPath $env:PATTY_TEST_SAMPLE -Mode $env:PATTY_TEST_RESOURCE_MODE
} else {
  & $env:PATTY_TEST_SAMPLER -AppPid 11 -OutputPath $env:PATTY_TEST_SAMPLE
}
@{gpuCalls=$global:__PattyTestGpuCalls} | ConvertTo-Json -Compress
`

function run(mode, check) {
  const directory = mkdtempSync(join(tmpdir(), 'patty-sampler-test-'))
  const output = join(directory, 'samples.jsonl')
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', fixture], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000,
      env: { ...process.env, PATTY_TEST_RESOURCE_MODE: mode, PATTY_TEST_SAMPLER: resolve('scripts/benchmark-processes.ps1'), PATTY_TEST_SAMPLE: output },
    })
    if (result.error) throw result.error
    check(result, output)
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('patty-sampler-test-'))
    rmSync(directory, { recursive: true, force: true })
  }
}

test('full sampling remains the default and includes GPU values', { skip: process.platform !== 'win32' }, () => {
  run('', (result, output) => {
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).gpuCalls, 2)
    const sample = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/, ''))
    assert.equal(sample.processes[0].busiestGpuEnginePercent, 7)
    assert.equal(sample.processes[0].dedicatedGpuBytes, 4096)
  })
})

test('process-only sampling never calls a GPU provider and keeps missing GPU data unknown', { skip: process.platform !== 'win32' }, () => {
  run('process', (result, output) => {
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).gpuCalls, 0)
    const sample = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/, ''))
    assert.equal(sample.processes[0].cpuMs, 10)
    assert.equal(sample.processes[0].workingSetBytes, 1024)
    assert.equal(sample.processes[0].busiestGpuEnginePercent, null)
    assert.equal(sample.processes[0].dedicatedGpuBytes, null)
  })
})

test('unknown resource modes fail before writing samples', { skip: process.platform !== 'win32' }, () => {
  run('unknown', (result, output) => {
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(output), false)
  })
})
