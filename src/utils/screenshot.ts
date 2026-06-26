import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { createLogger } from "./logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("screenshot");

/**
 * Capture the whole Windows desktop (all monitors) to a PNG and return its path.
 * Uses PowerShell + .NET (System.Windows.Forms / System.Drawing) so there's no
 * native npm dependency. Windows-only.
 */
export async function captureDesktop(): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("Desktop screenshots are only supported on Windows.");
  }

  const outFile = path.join(os.tmpdir(), `tg-claude-shot-${process.pid}-${hrtag()}.png`);

  // Single PowerShell script: grab the virtual screen bounds, copy pixels, save PNG.
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
    "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen;",
    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;",
    "$g = [System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size);",
    `$bmp.Save('${outFile.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png);`,
    "$g.Dispose(); $bmp.Dispose();",
  ].join(" ");

  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 20_000 },
  );

  log.info("desktop captured", { file: outFile });
  return outFile;
}

/** Short, monotonic-ish tag for unique filenames without Math.random/Date deps elsewhere. */
function hrtag(): string {
  return process.hrtime.bigint().toString(36);
}
