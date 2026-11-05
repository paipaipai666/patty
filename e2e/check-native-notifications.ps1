param([switch]$ManualClick)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding
$repository = Split-Path $PSScriptRoot
Push-Location $repository
try {
    $metadata = & cargo.exe metadata --format-version 1 --no-deps --manifest-path (Join-Path $repository 'src-tauri/Cargo.toml')
    if ($LASTEXITCODE -ne 0) { throw 'Unable to locate the dedicated test build' }
    $target = ($metadata | ConvertFrom-Json).target_directory
    $binary = Join-Path $target 'debug/patty-integration-test.exe'
    if (-not [IO.File]::Exists($binary)) { throw ('Dedicated integration build missing: '+$binary) }
    $env:PATTY_EXE = $binary
    $env:PATTY_NOTIFICATION_MANUAL_CLICK = if($ManualClick){'1'}else{'0'}
    & node.exe --test (Join-Path $PSScriptRoot 'notification-callback-output.test.mjs')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & node.exe (Join-Path $PSScriptRoot 'notification-activation.test.mjs')
    exit $LASTEXITCODE
} finally { Pop-Location }
