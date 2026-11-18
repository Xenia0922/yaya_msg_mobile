param (
    [string]$CommandLine = "node scripts/build-apk.js",
    [string]$WorkingDirectory = "E:\yymsg\_gh_analysis",
    [string]$Flavor = "public"
)

$env:JAVA_HOME = "E:\jdk17\jdk-17.0.12+7"
$env:ANDROID_HOME = "E:\yymsg\sdk\android"
$env:Path = "E:\jdk17\jdk-17.0.12+7\bin;$env:Path"
$env:RELEASE_STORE_FILE = "E:\yymsg\_gh_analysis\android\app\debug.keystore"
$env:RELEASE_STORE_PASSWORD = "android"
$env:RELEASE_KEY_ALIAS = "androiddebugkey"
$env:RELEASE_KEY_PASSWORD = "android"
$env:YAYA_FLAVOR = $Flavor

$csharpCode = @"
using System;
using System.Runtime.InteropServices;

public class DesktopHost {
    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")]
    public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")]
    public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr h);

    public static int Execute(string cmdLine, string workDir) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = "winsta0\\default";
        PROCESS_INFORMATION pi;
        if (!CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, workDir, ref si, out pi)) {
            Console.WriteLine("CreateProcess failed: " + Marshal.GetLastWin32Error());
            return -1;
        }
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint code;
        GetExitCodeProcess(pi.hProcess, out code);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return (int)code;
    }
}
"@

Add-Type -TypeDefinition $csharpCode
$fullCmd = "cmd.exe /c $CommandLine"
Write-Host "Running in winsta0\default: $fullCmd"
$exitCode = [DesktopHost]::Execute($fullCmd, $WorkingDirectory)
Write-Host "Process finished with exit code: $exitCode"
exit $exitCode
