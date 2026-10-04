# Read-only directory-handle API probe on its own disposable directory, not a writer.
$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Run this probe with Windows PowerShell" }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class TasksDirectoryFlushProbe {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);
    public static int[] Probe(string directory, uint access) {
        using (var handle = CreateFileW(directory, access, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
            if (handle.IsInvalid) return new int[] { 0, 0, Marshal.GetLastWin32Error() };
            bool flushed = FlushFileBuffers(handle);
            return new int[] { 1, flushed ? 1 : 0, flushed ? 0 : Marshal.GetLastWin32Error() };
        }
    }
}
'@
$directory = Join-Path ([IO.Path]::GetTempPath()) ("tasks-fcf-directory-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $directory | Out-Null
try {
    $results = foreach ($access in @(
        @{ name = "GENERIC_READ"; value = [uint32]2147483648 },
        @{ name = "GENERIC_WRITE"; value = [uint32]1073741824 },
        @{ name = "GENERIC_READ_WRITE"; value = [uint32]3221225472 }
    )) {
        $result = [TasksDirectoryFlushProbe]::Probe($directory, $access.value)
        [ordered]@{ access = $access.name; opened = ($result[0] -eq 1); flushed = ($result[1] -eq 1); win32Error = $result[2] }
    }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    [ordered]@{
        platform = "Windows"; directory = $directory
        elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        openFlags = "FILE_FLAG_BACKUP_SEMANTICS, OPEN_EXISTING, share read/write/delete"
        observations = @($results)
        limitations = "Directory-handle probe only. No volume flush, task mutation, publication, recovery or native application proof."
        directoryWillBeRemoved = $true
    } | ConvertTo-Json -Depth 4
} finally { Remove-Item -LiteralPath $directory -Force }
