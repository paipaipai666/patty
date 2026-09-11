# Patty shell integration for PowerShell (pwsh 6+ / powershell 5.1).
# Injected via -Command spawn arg on PTY creation. Only activates inside Patty
# because it guards on $env:PATTY_PANE_ID; external PowerShell windows ignore it.
$esc = [char]27
$__PattyPrompt = if (Test-Path Function:\prompt) { (Get-Item Function:\prompt).ScriptBlock }
# Cached HttpClient for the image-row poll — created once per session, not per
# prompt (a fresh client per prompt costs ~50ms+ of TCP setup each time).
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

# ConPTY cursor repair: OSC 1337 images pass through ConPTY without advancing
# conhost's cursor, while xterm.js advances its own cursor past the image. The
# models diverge by the image's row count, so PSReadLine's next absolute
# redraw lands inside the image. The backend scans the PTY stream and counts
# owed image rows per session; here — before each prompt renders — we pull the
# count and teleport conhost's cursor below the image with an absolute write
# (the only console-API channel that escapes the additive mismatch).
function __PattyRepairImageCursor {
  # 已知边界（后续如需再说）：
  # - cmd.exe 的 cmd-prompt.cmd 做不了这个 HTTP 查询，cmd 暂不覆盖（cmd 无
  #   PSReadLine 式绝对定位重绘，症状轻得多）；bash 是流式提示符，本就不受影响。
  # - 动画图像（chafa --watch / GIF）每帧都会累计行数，退出动画后首个 prompt
  #   会把行数一次结清并 clamp 到底部——静态图是设计场景，动图慎用。
  if (-not $env:PATTY_PORT -or -not $env:PATTY_HOOK_SECRET) { return }
  try {
    $resp = __PattyGetImageRows
    $tries = 0
    # pending = an image is still streaming through the backend scanner; retry
    # briefly rather than consume a partial row count.
    while ($resp -and $resp.pending -and $tries -lt 5) {
      Start-Sleep -Milliseconds 60
      $resp = __PattyGetImageRows
      $tries++
    }
    $rows = 0
    if ($resp -and $resp.rows) { $rows = [int]$resp.rows }
    if ($rows -gt 0) {
      # rows-1: chafa's trailing \r\n already advanced conhost one row past the
      # image anchor; the remaining deficit is the image height minus that row.
      $target = [Console]::CursorTop + $rows - 1
      $maxTop = [Console]::BufferHeight - 1
      if ($target -gt $maxTop) { $target = $maxTop }
      if ($target -gt [Console]::CursorTop) { [Console]::SetCursorPosition(0, $target) }
    }
  } catch { } # hook server down / busy prompt — never block the shell
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
