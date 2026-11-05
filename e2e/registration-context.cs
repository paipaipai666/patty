public static class PattyRegistrationContext {
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern System.IntPtr GetProcessWindowStation();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern System.IntPtr GetThreadDesktop(uint threadId);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern bool GetUserObjectInformation(System.IntPtr handle, int index, System.Text.StringBuilder buffer, uint size, out uint needed);
    [System.Runtime.InteropServices.DllImport("advapi32.dll")]
    private static extern bool GetTokenInformation(System.IntPtr token, int kind, System.IntPtr buffer, uint size, out uint needed);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern System.IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [System.Runtime.InteropServices.DllImport("advapi32.dll")]
    private static extern bool OpenProcessToken(System.IntPtr process, uint access, out System.IntPtr token);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern bool CloseHandle(System.IntPtr handle);
    public static string TokenForProcess(uint processId) {
        var process = OpenProcess(0x1000,false,processId);
        System.IntPtr token;
        if (process == System.IntPtr.Zero) return "unavailable";
        try {
            if (!OpenProcessToken(process,8,out token)) return "unavailable";
            try { return TokenDetails(token); } finally { CloseHandle(token); }
        } finally { CloseHandle(process); }
    }
    private static string TokenDetails(System.IntPtr token) {
        var buffer = System.Runtime.InteropServices.Marshal.AllocHGlobal(64);
        try {
            uint needed;
            string result="";
            if (GetTokenInformation(token,10,buffer,64,out needed)) result+="authentication="+System.Runtime.InteropServices.Marshal.ReadInt64(buffer,8).ToString("X16");
            if (GetTokenInformation(token,17,buffer,64,out needed)) result+=";origin="+System.Runtime.InteropServices.Marshal.ReadInt64(buffer).ToString("X16");
            if (GetTokenInformation(token,18,buffer,64,out needed)) result+=";elevationType="+System.Runtime.InteropServices.Marshal.ReadInt32(buffer);
            if (GetTokenInformation(token,21,buffer,64,out needed)) result+=";restricted="+System.Runtime.InteropServices.Marshal.ReadInt32(buffer);
            if (GetTokenInformation(token,29,buffer,64,out needed)) result+=";appContainer="+System.Runtime.InteropServices.Marshal.ReadInt32(buffer);
            return result;
        } finally { System.Runtime.InteropServices.Marshal.FreeHGlobal(buffer); }
    }
    private static string ObjectName(System.IntPtr handle) {
        var name = new System.Text.StringBuilder(256);
        uint needed;
        return GetUserObjectInformation(handle,2,name,512,out needed) ? name.ToString() : "unavailable";
    }
    public static string Snapshot() {
        using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent()) {
            var principal = new System.Security.Principal.WindowsPrincipal(identity);
            return "pid="+System.Diagnostics.Process.GetCurrentProcess().Id+";session="+System.Diagnostics.Process.GetCurrentProcess().SessionId+
                ";administrator="+principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator)+";"+TokenDetails(identity.Token)+
                ";station="+ObjectName(GetProcessWindowStation())+";desktop="+ObjectName(GetThreadDesktop(GetCurrentThreadId()));
        }
    }
}
