import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const script = resolve('scripts/shell-integration/pwsh.ps1').replaceAll("'", "''")

for (const shell of ['powershell.exe', 'pwsh.exe']) {
  it(`${shell} preserves custom prompts, input functions and repeated loading`, () => {
    const source = `
      $ProgressPreference = 'SilentlyContinue'
      function global:prompt { "CUSTOM:$global:?" }
      function global:PSConsoleHostReadLine { 'Get-Location' }
      . '${script}'
      $firstPrompt = $function:prompt
      $firstReadLine = $function:PSConsoleHostReadLine
      . '${script}'
      if ($function:prompt -ne $firstPrompt -or $function:PSConsoleHostReadLine -ne $firstReadLine) { throw 'integration installed twice' }
      $line = PSConsoleHostReadLine
      if ($line -ne 'Get-Location') { throw 'input function changed' }
      Write-Error 'expected failure' -ErrorAction Ignore
      $text = prompt
      if (-not $text.Contains('CUSTOM:False')) { throw "original prompt lost status: $text" }
      if (-not $text.Contains(([char]27 + ']133;B'))) { throw 'prompt boundary missing' }
      [Console]::Write('PATTY_PROMPT_PRESERVED')
    `
    const output = execFileSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {
      encoding: 'utf8', timeout: 15_000, windowsHide: true,
      env: { ...process.env, PATTY_PORT: '', PATTY_HOOK_SECRET: '' }
    })
    expect(output).toContain('PATTY_PROMPT_PRESERVED')
  }, 20_000)
}
