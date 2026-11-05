param(
    [string]$Uri = 'patty-e2e://session/target'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Wait-WinRtOperation($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(10000)) { throw 'Windows URI operation timed out' }
    $task.Result
}

$parsed = [Uri]$Uri
$operation = [Windows.System.Launcher,Windows.System,ContentType=WindowsRuntime]::QueryUriSupportAsync(
    $parsed, [Windows.System.LaunchQuerySupportType,Windows.System,ContentType=WindowsRuntime]::Uri)
$support = Wait-WinRtOperation $operation ([Windows.System.LaunchQuerySupportStatus,Windows.System,ContentType=WindowsRuntime])
[pscustomobject]@{scheme=$parsed.Scheme;support=[string]$support} | ConvertTo-Json -Compress
