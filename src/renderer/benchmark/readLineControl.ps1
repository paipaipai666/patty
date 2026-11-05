function global:Invoke-PattyBenchmarkReadLineControl {
  param([ValidateSet('Install','Verify','Restore')][string]$Action, [int]$ExpectedCount)
  switch ($Action) {
    'Install' {
      if (-not $global:__PattyShellState -or -not $global:__PattyShellState.OriginalReadLine) { throw 'Patty input integration is unavailable' }
      if (Test-Path Variable:global:__PattyBenchmarkReadLineState) { throw 'ReadLine control is already installed' }
      $global:__PattyBenchmarkReadLineState = @{
        Original = $global:__PattyShellState.OriginalReadLine
        Wrapper = (Get-Item Function:\PSConsoleHostReadLine).ScriptBlock
        Commands = 0
      }
      $global:__PattyShellState.OriginalReadLine = { [Console]::ReadLine() }
    }
    'Verify' {
      if (-not (Test-Path Variable:global:__PattyBenchmarkReadLineState)) { throw 'ReadLine control is not installed' }
      if ($global:__PattyBenchmarkReadLineState.Commands -ne $ExpectedCount) { throw 'Real commands did not execute' }
      if (-not [object]::ReferenceEquals($global:__PattyBenchmarkReadLineState.Wrapper, (Get-Item Function:\PSConsoleHostReadLine).ScriptBlock)) { throw 'Patty command wrapper was replaced' }
    }
    'Restore' {
      if (-not (Test-Path Variable:global:__PattyBenchmarkReadLineState)) { throw 'ReadLine control is not installed' }
      $original = $global:__PattyBenchmarkReadLineState.Original
      $global:__PattyShellState.OriginalReadLine = $original
      if (-not [object]::ReferenceEquals($original, $global:__PattyShellState.OriginalReadLine)) { throw 'Input editor was not restored' }
      if (-not [object]::ReferenceEquals($global:__PattyBenchmarkReadLineState.Wrapper, (Get-Item Function:\PSConsoleHostReadLine).ScriptBlock)) { throw 'Patty command wrapper was replaced' }
      Remove-Variable -Scope Global -Name __PattyBenchmarkReadLineState
    }
  }
}
