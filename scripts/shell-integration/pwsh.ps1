
$esc = [char]27
$__PattyPrompt = if (Test-Path Function:\prompt) { (Get-Item Function:\prompt).ScriptBlock }

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

function global:prompt {
  __PattyRepairImageCursor
  $path = (Get-Location).ProviderPath
  $osc7 = "$esc]7;file://localhost/$([uri]::EscapeDataString($path))$esc\"
  $userPrompt = if ($__PattyPrompt) {
    try { & $__PattyPrompt } catch { "PS $path> " }
  } else {
    "PS $path> "
  }
  return "$osc7$userPrompt"
}
