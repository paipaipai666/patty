param(
    [Parameter(Mandatory=$true)][Guid]$ClassId,
    [Parameter(Mandatory=$true)][ValidateSet('com.patty.integration-test','com.patty.integration-test.dev','com.patty.integration-test.registration-probe')][string]$Identity,
    [Parameter(Mandatory=$true)][string]$Argument,
    [string]$ContextFile
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding
$source = @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPattyNotificationCallback {
    [PreserveSig]
    int Activate([MarshalAs(UnmanagedType.LPWStr)] string identity, [MarshalAs(UnmanagedType.LPWStr)] string argument, IntPtr data, uint count);
}
public static class PattyNotificationCallbackVerifier {
    [DllImport("ole32.dll", ExactSpelling=true)]
    private static extern int CoCreateInstance(ref Guid classId, IntPtr outer, uint context, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPattyNotificationCallback instance);
    public static void Invoke(Guid classId, string identity, string argument) {
        Guid iid = typeof(IPattyNotificationCallback).GUID;
        IPattyNotificationCallback instance;
        Marshal.ThrowExceptionForHR(CoCreateInstance(ref classId, IntPtr.Zero, 4, ref iid, out instance));
        try { Marshal.ThrowExceptionForHR(instance.Activate(identity, argument, IntPtr.Zero, 0)); }
        finally { Marshal.FinalReleaseComObject(instance); }
    }
}
'@
Add-Type ($source + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'registration-context.cs')))
if ($ContextFile) {
    $path=[IO.Path]::GetFullPath($ContextFile)
    $folder=[IO.Path]::GetDirectoryName($path)
    if ([IO.Path]::GetFileName($path) -ne 'client.context' -or [IO.Path]::GetDirectoryName($folder) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or -not [IO.Path]::GetFileName($folder).StartsWith('patty-e2e-registration-')) { throw 'Callback context requires its probe directory' }
    [IO.File]::WriteAllText($path,[PattyRegistrationContext]::Snapshot())
}
try {
    [PattyNotificationCallbackVerifier]::Invoke($ClassId, $Identity, $Argument)
    [pscustomobject]@{hresult='0x00000000';context=[PattyRegistrationContext]::Snapshot()} | ConvertTo-Json -Compress
} catch {
    [pscustomobject]@{hresult=('0x{0:X8}' -f $_.Exception.GetBaseException().HResult);error=$_.Exception.GetBaseException().Message;context=[PattyRegistrationContext]::Snapshot()} | ConvertTo-Json -Compress
    exit 1
}
