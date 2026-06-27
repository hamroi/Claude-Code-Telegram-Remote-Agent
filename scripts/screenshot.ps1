param([Parameter(Mandatory = $true)][string]$OutFile)

# Full-resolution screenshot of the ENTIRE virtual desktop (all monitors).
#
# The DPI-awareness call below is the important part: a console process is
# DPI-UNAWARE by default, so on a scaled display (e.g. 150%) VirtualScreen
# reports logical pixels while CopyFromScreen copies physical pixels — the
# result is that only the top-left portion of the screen ends up in the image.
# Declaring the process DPI-aware makes the bounds match the real pixels, so we
# capture the whole screen. Per-Monitor-V2 is preferred, with fallbacks for
# older Windows builds.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
'@ -Name DpiApi -Namespace Win32 -PassThru | Out-Null

try {
    # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
    [Win32.DpiApi]::SetProcessDpiAwarenessContext([System.IntPtr](-4)) | Out-Null
}
catch {
    try {
        # PROCESS_PER_MONITOR_DPI_AWARE = 2
        [Win32.DpiApi]::SetProcessDpiAwareness(2) | Out-Null
    }
    catch {
        try { [Win32.DpiApi]::SetProcessDPIAware() | Out-Null } catch {}
    }
}

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()

Write-Output $OutFile
