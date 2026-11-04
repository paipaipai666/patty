
if (Test-Path Variable:\global:__PattyShellState) { return }
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { return }
$global:__PattyShellState = @{
  OriginalPrompt = if (Test-Path Function:\prompt) { (Get-Item Function:\prompt).ScriptBlock } else { $null }
  OriginalReadLine = $null
  InExecution = $false
  ResultKind = 'unknown'
  LastHistoryId = -1
  Escape = [char]27
}

$script:__pattyHttp = $null
function __PattyGetImageRows {
  if ($null -eq $script:__pattyHttp) {
    $script:__pattyHttp = [System.Net.Http.HttpClient]::new()
    $script:__pattyHttp.Timeout = [TimeSpan]::FromSeconds(1)
  }
  $uri = "http://127.0.0.1:$($env:PATTY_PORT)/image-rows?pane=$($env:PATTY_PANE_ID)&secret=$($env:PATTY_HOOK_SECRET)"
  $json = $script:__pattyHttp.GetStringAsync($uri).GetAwaiter().GetResult()
  return ($json | ConvertFrom-Json)
}


function __PattyRepairImageCursor {

  if (-not $env:PATTY_PORT -or -not $env:PATTY_HOOK_SECRET) { return }
  try {
    $resp = __PattyGetImageRows
    $tries = 0

    while ($resp -and $resp.pending -and $tries -lt 5) {
      Start-Sleep -Milliseconds 60
      $resp = __PattyGetImageRows
      $tries++
    }
    $rows = 0
    if ($resp -and $resp.rows) { $rows = [int]$resp.rows }
    if ($rows -gt 0) {

      $target = [Console]::CursorTop + $rows - 1
      $maxTop = [Console]::BufferHeight - 1
      if ($target -gt $maxTop) { $target = $maxTop }
      if ($target -gt [Console]::CursorTop) { [Console]::SetCursorPosition(0, $target) }
    }
  } catch { }
}

function __PattyResultKind([string]$line) {
  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($line, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count -gt 0) { return 'unknown' }
  $statements = $ast.EndBlock.Statements
  if ($statements.Count -eq 0) { return 'unknown' }
  $last = $statements[$statements.Count - 1]
  if ($last -isnot [System.Management.Automation.Language.PipelineAst]) { return 'shell' }
  $element = $last.PipelineElements[$last.PipelineElements.Count - 1]
  if ($element -isnot [System.Management.Automation.Language.CommandAst]) { return 'shell' }
  $name = $element.GetCommandName()
  if (-not $name) { return 'unknown' }
  $command = Get-Command -Name $name -ErrorAction Ignore
  if ($command -is [System.Management.Automation.AliasInfo]) { $command = $command.ResolvedCommand }
  if (-not $command) { return 'unknown' }
  if ($command.CommandType -eq 'Application') { return 'native' }
  if ($command.CommandType -eq 'ExternalScript') { return 'unknown' }
  return 'shell'
}

function __PattyInstallReadLine {
  if ($global:__PattyShellState.OriginalReadLine -or -not (Test-Path Function:\PSConsoleHostReadLine)) { return }
  $global:__PattyShellState.OriginalReadLine = (Get-Item Function:\PSConsoleHostReadLine).ScriptBlock
  function global:PSConsoleHostReadLine {
    $line = & $global:__PattyShellState.OriginalReadLine
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      $global:__PattyShellState.ResultKind = __PattyResultKind $line
      $history = Get-History -Count 1
      $global:__PattyShellState.LastHistoryId = if ($history) { $history.Id } else { -1 }
      $global:__PattyShellState.InExecution = $true
      [Console]::Write("$($global:__PattyShellState.Escape)]133;C" + [char]7)
    }
    return $line
  }
}

if ($Host.Name -eq 'ConsoleHost' -and -not [Console]::IsInputRedirected -and -not (Get-Module PSReadLine)) {
  Import-Module PSReadLine -ErrorAction SilentlyContinue
}
__PattyInstallReadLine

function global:prompt {
  $__pattySuccess = $global:?
  $__pattyNativeExit = Get-Variable LASTEXITCODE -Scope Global -ValueOnly -ErrorAction Ignore
  Set-StrictMode -Off
  $esc = $global:__PattyShellState.Escape
  $markers = ''
  if ($global:__PattyShellState.InExecution) {
    $global:__PattyShellState.InExecution = $false
    $history = Get-History -Count 1
    if ($history -and $history.Id -ne $global:__PattyShellState.LastHistoryId) {
      if ($history.ExecutionStatus -ne 'Stopped') {
        $code = if ($global:__PattyShellState.ResultKind -eq 'native' -and $null -ne $__pattyNativeExit) {
          ";$__pattyNativeExit"
        } elseif ($__pattySuccess) { ';0' }
        elseif ($global:__PattyShellState.ResultKind -eq 'shell') { ';1' }
        else { '' }
        $markers = "$esc]133;D$code" + [char]7
      }
    } else {
      $markers = "$esc]133;D" + [char]7
    }
  }
  $markers += "$esc]133;A" + [char]7
  __PattyInstallReadLine
  __PattyRepairImageCursor
  $path = (Get-Location).ProviderPath
  $osc7 = "$esc]7;file://localhost/$([uri]::EscapeDataString($path))$esc\"
  $userPrompt = if ($global:__PattyShellState.OriginalPrompt) {
    try {
      if (-not $__pattySuccess) { Write-Error 'failure' -ErrorAction Ignore }
      & $global:__PattyShellState.OriginalPrompt
    } catch { "PS $path> " }
  } else {
    "PS $path> "
  }
  return "$markers$osc7$userPrompt$esc]133;B$([char]7)"
}
