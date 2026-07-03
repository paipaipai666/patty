# Patty shell integration for PowerShell (pwsh 6+ / powershell 5.1).
# Injected via -Command spawn arg on PTY creation. Only activates inside Patty
# because it guards on $env:PATTY_PANE_ID; external PowerShell windows ignore it.
$esc = [char]27
$__PattyPrompt = if (Test-Path Function:\prompt) { (Get-Item Function:\prompt).ScriptBlock }
function global:prompt {
  $path = (Get-Location).ProviderPath
  $osc7 = "$esc]7;file://localhost/$([uri]::EscapeDataString($path))$esc\"
  $userPrompt = if ($__PattyPrompt) {
    try { & $__PattyPrompt } catch { "PS $path> " }
  } else {
    "PS $path> "
  }
  return "$osc7$userPrompt"
}
