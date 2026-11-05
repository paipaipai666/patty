param([switch]$ColdOnly, [switch]$ServerExecutable)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding
$classId = [Guid]::NewGuid().ToString('B')
$identity = 'com.patty.integration-test.registration-probe'
$registration = 'Software\Classes\CLSID\' + $classId
$existing = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registration)
if ($existing) { $existing.Dispose(); throw 'Probe refuses to overwrite an existing registration' }
$temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$root = Join-Path $temporary ('patty-e2e-registration-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($root)
$binary = Join-Path $root 'registration-probe.exe'
$callback = Join-Path $PSScriptRoot 'notification-callback.ps1'
$report = [ordered]@{client64=[Environment]::Is64BitProcess;classId=$classId;observations=@()}
$source = @'
using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
[ComVisible(true), Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IRegistrationProbeCallback {
    void Activate([MarshalAs(UnmanagedType.LPWStr)] string identity, [MarshalAs(UnmanagedType.LPWStr)] string argument, IntPtr data, uint count);
}
[ComVisible(true), Guid("7D43B290-5069-4D91-9FB6-9E5345CB2F23"), ClassInterface(ClassInterfaceType.None)]
public class RegistrationProbeCallback : IRegistrationProbeCallback {
    public void Activate(string identity, string argument, IntPtr data, uint count) {
        if (identity != "com.patty.integration-test.registration-probe" || argument != "patty-probe://session/target" || count != 0) Marshal.ThrowExceptionForHR(unchecked((int)0x80070057));
        File.WriteAllText(Path.Combine(RegistrationProbe.Root, "received.json"), "{\"pid\":"+Process.GetCurrentProcess().Id+",\"server64\":"+Environment.Is64BitProcess.ToString().ToLowerInvariant()+"}");
    }
}
public static class RegistrationProbe {
    public static string Root;
    [MTAThread]
    public static void Main(string[] args) {
        Root = @"__PROBE_ROOT__";
        try {
            File.WriteAllLines(Path.Combine(Root,"startup.args"),args);
            File.WriteAllText(Path.Combine(Root,"startup.temp"),Path.GetTempPath());
            File.WriteAllText(Path.Combine(Root,"startup.context"),PattyRegistrationContext.Snapshot());
            var registration = new RegistrationServices();
            int cookie = registration.RegisterTypeForComClients(typeof(RegistrationProbeCallback), RegistrationClassContext.LocalServer, RegistrationConnectionType.MultipleUse);
            File.WriteAllText(Path.Combine(Root,"registered.clsid"),typeof(RegistrationProbeCallback).GUID.ToString("B"));
            try {
                File.WriteAllText(Path.Combine(Root,"ready"), Process.GetCurrentProcess().Id.ToString());
                DateTime deadline = DateTime.UtcNow.AddSeconds(90);
                while (!File.Exists(Path.Combine(Root,"stop")) && DateTime.UtcNow < deadline) Thread.Sleep(25);
            } finally { registration.UnregisterTypeForComClients(cookie); }
        } catch (Exception error) { File.WriteAllText(Path.Combine(Root,"error"),error.ToString()); }
    }
}
'@
$source=$source.Replace('7D43B290-5069-4D91-9FB6-9E5345CB2F23',$classId.Trim('{}'))
$source=$source.Replace('__PROBE_ROOT__',$root.Replace('"','""'))
$source += [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'registration-context.cs'))

function Wait-ProbeFile([string]$Name) {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not [IO.File]::Exists((Join-Path $root $Name))) {
        if ([IO.File]::Exists((Join-Path $root 'error'))) { throw [IO.File]::ReadAllText((Join-Path $root 'error')) }
        if ([DateTime]::UtcNow -gt $deadline) { throw ('Timed out waiting for '+$Name) }
        Start-Sleep -Milliseconds 30
    }
}

function Invoke-ProbeCallback([string]$Stage) {
    $stdout=Join-Path $root ($Stage+'-client.json')
    $stderr=Join-Path $root ($Stage+'-client.err')
    $arguments='-NoProfile -NonInteractive -File "'+$callback+'" -ClassId '+$classId+' -Identity '+$identity+' -Argument "patty-probe://session/target" -ContextFile "'+(Join-Path $root 'client.context')+'"'
    $client=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    if (-not $client.WaitForExit(12000)) {
        Stop-Process -Id $client.Id -Force
        $report.observations += [ordered]@{stage=$Stage;status='timeout';result=$null}
        return
    }
    $client.Refresh()
    $result=[IO.File]::ReadAllText($stdout)
    $parsed=$result | ConvertFrom-Json
    if ($parsed.hresult -notmatch '^0x[0-9A-Fa-f]{8}$') { throw 'The callback client did not return a valid result' }
    $status=if($parsed.hresult -eq '0x00000000'){0}else{1}
    $report.observations += [ordered]@{stage=$Stage;status=$status;result=$parsed;stderr=[IO.File]::ReadAllText($stderr)}
    if ($status -eq 0) {
        Wait-ProbeFile 'received.json'
        $report.observations += [ordered]@{stage=($Stage+'-receiver');receiver=([IO.File]::ReadAllText((Join-Path $root 'received.json')) | ConvertFrom-Json)}
    }
}

try {
    Add-Type -TypeDefinition $source -OutputAssembly $binary -OutputType WindowsApplication
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registration+'\LocalServer32')
    try {
        $key.SetValue('', ('"'+$binary+'" "'+$root+'"'), [Microsoft.Win32.RegistryValueKind]::String)
        if ($ServerExecutable) { $key.SetValue('ServerExecutable',$binary,[Microsoft.Win32.RegistryValueKind]::String) }
    }
    finally { $key.Dispose() }
    if (-not $ColdOnly) {
        $server = Start-Process -FilePath $binary -ArgumentList ('"'+$root+'"') -WindowStyle Hidden -PassThru
        Wait-ProbeFile 'ready'
        Invoke-ProbeCallback 'warm'
        [IO.File]::WriteAllText((Join-Path $root 'stop'), '')
        if (-not $server.WaitForExit(10000)) { throw 'Probe server did not exit' }
        foreach ($name in @('stop','ready','received.json','startup.args','startup.temp','startup.context','registered.clsid','client.context','error')) { [IO.File]::Delete((Join-Path $root $name)) }
    }
    $key = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey(('CLSID\'+$classId+'\LocalServer32'))
    try { $report.observations += [ordered]@{stage='persisted-registration';command=$key.GetValue('')} }
    finally { $key.Dispose() }
    Invoke-ProbeCallback 'cold'
    $report.observations += [ordered]@{stage='cold-startup';started=([IO.File]::Exists((Join-Path $root 'startup.args')));arguments=$(if([IO.File]::Exists((Join-Path $root 'startup.args'))){[IO.File]::ReadAllLines((Join-Path $root 'startup.args'))}else{$null});temp=$(if([IO.File]::Exists((Join-Path $root 'startup.temp'))){[IO.File]::ReadAllText((Join-Path $root 'startup.temp'))}else{$null});error=$(if([IO.File]::Exists((Join-Path $root 'error'))){[IO.File]::ReadAllText((Join-Path $root 'error'))}else{$null})}
    foreach ($name in @('startup.context','registered.clsid','client.context')) {
        if([IO.File]::Exists((Join-Path $root $name))){$report.observations += [ordered]@{stage=$name;value=[IO.File]::ReadAllText((Join-Path $root $name))}}
    }
    $report | ConvertTo-Json -Depth 6
} finally {
    [IO.File]::WriteAllText((Join-Path $root 'stop'), '')
    Get-CimInstance Win32_Process -Filter "Name = 'registration-probe.exe'" | Where-Object { $_.ExecutablePath -eq $binary } | ForEach-Object {
        $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        if ($process -and -not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force }
    }
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($registration, $false)
    $output = Join-Path (Split-Path $PSScriptRoot) 'output\notification-registration'
    $null = [IO.Directory]::CreateDirectory($output)
    [IO.File]::WriteAllText((Join-Path $output 'report.json'), ($report | ConvertTo-Json -Depth 6))
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($root)) -ne $temporary -or -not [IO.Path]::GetFileName($root).StartsWith('patty-e2e-registration-')) { throw 'Probe cleanup path is outside its temporary directory' }
    Remove-Item -LiteralPath $root -Recurse -Force
}
