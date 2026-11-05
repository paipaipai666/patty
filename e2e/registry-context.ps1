param([string]$ClassId)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
public static class RegistryContextProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct SiloInfo { public uint id; public uint parent; public uint processes; public byte server; }
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool QueryInformationJobObject(IntPtr job, int info, out SiloInfo result, uint length, IntPtr returned);
    [DllImport("ntdll.dll")]
    private static extern int NtQueryKey(IntPtr key, int kind, IntPtr buffer, int length, out int needed);
    [DllImport("advapi32.dll")]
    private static extern int RegOpenUserClassesRoot(IntPtr token, uint options, uint access, out SafeRegistryHandle result);
    public static string Name(RegistryKey key) {
        int needed;
        NtQueryKey(key.Handle.DangerousGetHandle(), 3, IntPtr.Zero, 0, out needed);
        if (needed <= 4 || needed > 65536) throw new InvalidOperationException("Invalid registry name size");
        IntPtr buffer = Marshal.AllocHGlobal(needed);
        try {
            int status = NtQueryKey(key.Handle.DangerousGetHandle(), 3, buffer, needed, out needed);
            if (status < 0) throw new InvalidOperationException("Registry query failed: "+status);
            return Marshal.PtrToStringUni(IntPtr.Add(buffer,4),Marshal.ReadInt32(buffer)/2);
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    public static RegistryKey UserClasses() {
        SafeRegistryHandle handle;
        using (var identity = WindowsIdentity.GetCurrent()) {
            int status = RegOpenUserClassesRoot(identity.Token,0,0x20019,out handle);
            if (status != 0) throw new InvalidOperationException("User classes query failed: "+status);
        }
        return RegistryKey.FromHandle(handle);
    }
}
'@
$silo=New-Object RegistryContextProbe+SiloInfo
$queried=[RegistryContextProbe]::QueryInformationJobObject([IntPtr]::Zero,36,[ref]$silo,16,[IntPtr]::Zero)
[pscustomobject]@{view='execution-context';session=[Diagnostics.Process]::GetCurrentProcess().SessionId;querySucceeded=$queried;error=$(if($queried){0}else{[Runtime.InteropServices.Marshal]::GetLastWin32Error()});siloId=$silo.id;serverSilo=$silo.server} | ConvertTo-Json -Compress
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($path in @('Software\Classes','Software\Classes\vscode')) {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
    try { [pscustomobject]@{view=('current-user\'+$path);native=[RegistryContextProbe]::Name($key)} | ConvertTo-Json -Compress }
    finally { $key.Dispose() }
}
$classes=[RegistryContextProbe]::UserClasses()
try {
    $key=$classes.OpenSubKey('vscode')
    try { [pscustomobject]@{view='token-classes\vscode';native=[RegistryContextProbe]::Name($key)} | ConvertTo-Json -Compress }
    finally { $key.Dispose() }
    if ($ClassId) {
        $parsed=[Guid]$ClassId
        $path='CLSID\'+$parsed.ToString('B')+'\LocalServer32'
        $key=$classes.OpenSubKey($path)
        try { [pscustomobject]@{view='token-classes\callback';native=$(if($key){[RegistryContextProbe]::Name($key)}else{$null});command=$(if($key){$key.GetValue('')}else{$null})} | ConvertTo-Json -Compress }
        finally { if($key){$key.Dispose()} }
    }
} finally { $classes.Dispose() }
