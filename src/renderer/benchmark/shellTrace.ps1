
function global:Invoke-PattyBenchmarkShellTrace {
  param([ValidateSet('Install','Begin','Pause','Export','Restore')][string]$Action, [string]$Name, [int]$ExpectedCount, [string]$Path)
  switch ($Action) {
    'Install' {
      if (Test-Path Variable:global:__PattyBenchmarkShellTrace) { throw 'Shell trace is already installed' }
      if (-not $global:__PattyShellState.OriginalReadLine -or -not (Test-Path Function:\__PattyResultKind)) { throw 'Patty Shell integration is unavailable' }
      if (-not ('PattyBenchmarkShellClock' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class PattyBenchmarkShellClock {
  [DllImport("kernel32.dll")]
  private static extern void GetSystemTimePreciseAsFileTime(out long value);
  public static double[] Calibrate() {
    long before = Stopwatch.GetTimestamp();
    long fileTime;
    GetSystemTimePreciseAsFileTime(out fileTime);
    long after = Stopwatch.GetTimestamp();
    return new double[] { before, (fileTime - 116444736000000000L) / 10000.0, after };
  }
}
'@
      }
      $global:__PattyBenchmarkShellTrace = @{
        Editor = $global:__PattyShellState.OriginalReadLine
        Classifier = (Get-Item Function:\__PattyResultKind).ScriptBlock
        Wrapper = (Get-Item Function:\PSConsoleHostReadLine).ScriptBlock
        Enabled = $false
        Rows = [Collections.Generic.List[object]]::new()
        Batches = [Collections.Generic.List[object]]::new()
        Current = $null
      }
      $global:__PattyShellState.OriginalReadLine = {
        $trace = $global:__PattyBenchmarkShellTrace
        $trace.Current = $null
        $line = & $trace.Editor
        $returned = [Diagnostics.Stopwatch]::GetTimestamp()
        if ($trace.Enabled) {
          $match = [regex]::Match($line, '^__PattyBenchmarkStamp ([0-9]+) 0;')
          if ($match.Success) {
            if ($trace.Rows.Count -ge 256) { throw 'Shell trace exceeds 256 probes' }
            $row = [double[]]@([int]$match.Groups[1].Value,$returned,0,0,0,0,0)
            $trace.Rows.Add($row)
            $trace.Current = $row
          }
        }
        return $line
      }
      function global:__PattyResultKind([string]$line) {
        $trace = $global:__PattyBenchmarkShellTrace
        $row = $trace.Current
        if ($null -ne $row) { $row[2] = [Diagnostics.Stopwatch]::GetTimestamp() }
        $kind = & $trace.Classifier $line
        if ($null -ne $row) { $row[3] = [Diagnostics.Stopwatch]::GetTimestamp() }
        return $kind
      }
      function global:__PattyBenchmarkStamp([int]$Id, [int]$Stage) {
        $at = [Diagnostics.Stopwatch]::GetTimestamp()
        $trace = $global:__PattyBenchmarkShellTrace
        if (-not $trace.Enabled) { return }
        $row = $trace.Current
        if ($null -eq $row -or $row[0] -ne $Id -or $Stage -lt 0 -or $Stage -gt 2) { throw 'Shell trace probe or stage mismatch' }
        if ($row[4 + $Stage] -ne 0) { throw 'Duplicate Shell trace stage' }
        $row[4 + $Stage] = $at
      }
    }
    'Begin' {
      if (-not (Test-Path Variable:global:__PattyBenchmarkShellTrace)) { throw 'Shell trace is not installed' }
      $trace = $global:__PattyBenchmarkShellTrace
      $trace.Enabled = $false
      $trace.Current = $null
      $trace.Rows.Clear()
      $trace.ClockBefore = [PattyBenchmarkShellClock]::Calibrate()
      $trace.Enabled = $true
    }
    'Pause' {
      if (-not (Test-Path Variable:global:__PattyBenchmarkShellTrace)) { throw 'Shell trace is not installed' }
      $global:__PattyBenchmarkShellTrace.Enabled = $false
      $global:__PattyBenchmarkShellTrace.Current = $null
    }
    'Export' {
      if (-not (Test-Path Variable:global:__PattyBenchmarkShellTrace)) { throw 'Shell trace is not installed' }
      $trace = $global:__PattyBenchmarkShellTrace
      $trace.Enabled = $false
      $trace.Current = $null
      if ($ExpectedCount -le 0 -or $trace.Rows.Count -ne $ExpectedCount) { throw 'Shell trace count mismatch' }
      if ($Name -notmatch '^[a-z][a-z0-9-]{0,63}$' -or $trace.Batches.Count -ge 4) { throw 'Invalid Shell trace batch' }
      if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Shell trace requires an absolute output path' }
      foreach ($row in $trace.Rows) {
        for ($index = 1; $index -lt 7; $index++) {
          if ($row[$index] -le 0 -or ($index -gt 1 -and $row[$index] -lt $row[$index - 1])) { throw 'Incomplete or reversed Shell trace' }
        }
      }
      $trace.Batches.Add(@{
        name = $Name
        frequency = [double][Diagnostics.Stopwatch]::Frequency
        clockBefore = $trace.ClockBefore
        clockAfter = [PattyBenchmarkShellClock]::Calibrate()
        rows = $trace.Rows.ToArray()
      })
      $json = ConvertTo-Json -InputObject $trace.Batches.ToArray() -Depth 6 -Compress
      if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 65536) { throw 'Shell trace exceeds 64 KiB' }
      [IO.File]::WriteAllText($Path,$json,[Text.UTF8Encoding]::new($false))
    }
    'Restore' {
      if (-not (Test-Path Variable:global:__PattyBenchmarkShellTrace)) { throw 'Shell trace is not installed' }
      $trace = $global:__PattyBenchmarkShellTrace
      $trace.Enabled = $false
      $global:__PattyShellState.OriginalReadLine = $trace.Editor
      Set-Item -LiteralPath Function:global:__PattyResultKind -Value $trace.Classifier
      if (-not [object]::ReferenceEquals($trace.Editor,$global:__PattyShellState.OriginalReadLine) -or -not [object]::ReferenceEquals($trace.Classifier,(Get-Item Function:\__PattyResultKind).ScriptBlock) -or -not [object]::ReferenceEquals($trace.Wrapper,(Get-Item Function:\PSConsoleHostReadLine).ScriptBlock)) { throw 'Shell functions were not restored' }
      Remove-Item -LiteralPath Function:global:__PattyBenchmarkStamp
      Remove-Variable -Scope Global -Name __PattyBenchmarkShellTrace
    }
  }
}
