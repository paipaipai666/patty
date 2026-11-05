param([int]$AppPid, [string]$OutputPath, [ValidateSet('full','process')][string]$Mode = 'full')

$ErrorActionPreference = 'Stop'
$gpuEngines = 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine'
$gpuMemory = 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory'

while (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) {
  $tree = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name)
  $included = [System.Collections.Generic.HashSet[int]]::new()
  $null = $included.Add($AppPid)
  do {
    $previous = $included.Count
    foreach ($process in $tree) {
      if ($included.Contains($process.ParentProcessId)) { $null = $included.Add($process.ProcessId) }
    }
  } while ($included.Count -ne $previous)

  $engines = $null
  $memory = $null
  if ($Mode -eq 'full') {
    try {
      $byProcess = @{}
      foreach ($engine in (Get-CimInstance $gpuEngines -Property Name,UtilizationPercentage)) {
        if ($engine.Name -match '^pid_(\d+)_') {
          $key = [int]$Matches[1]
          if ($included.Contains($key)) { $byProcess[$key] = [Math]::Max([int]$byProcess[$key], [int]$engine.UtilizationPercentage) }
        }
      }
      $engines = $byProcess
    } catch { }
    try {
      $byProcess = @{}
      foreach ($allocation in (Get-CimInstance $gpuMemory -Property Name,DedicatedUsage)) {
        if ($allocation.Name -match '^pid_(\d+)_') {
          $key = [int]$Matches[1]
          if ($included.Contains($key)) { $byProcess[$key] = [long]$byProcess[$key] + [long]$allocation.DedicatedUsage }
        }
      }
      $memory = $byProcess
    } catch { }
  }
  $time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $processes = @(foreach ($process in (Get-Process -Id @($included) -ErrorAction SilentlyContinue)) {
    $gpu = if ($null -ne $engines) { [int]$engines[$process.Id] } else { $null }
    $dedicated = if ($null -ne $memory) { [long]$memory[$process.Id] } else { $null }
    @{
      pid = $process.Id
      name = $process.ProcessName
      cpuMs = $process.TotalProcessorTime.TotalMilliseconds
      workingSetBytes = $process.WorkingSet64
      privateBytes = $process.PrivateMemorySize64
      busiestGpuEnginePercent = $gpu
      dedicatedGpuBytes = $dedicated
    }
  })
  @{ at = $time; processes = $processes } | ConvertTo-Json -Compress -Depth 4 | Add-Content -LiteralPath $OutputPath -Encoding UTF8
  Start-Sleep -Milliseconds 550
}
