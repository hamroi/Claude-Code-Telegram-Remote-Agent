import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { createLogger } from "./logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("screenshot");

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the bundled PowerShell capture script. Resolves from this
 * module to the repo root (works for both tsx/src and compiled dist layouts),
 * since `scripts/` lives at the project root. Shared by the /screenshot command
 * and Claude's system prompt so both produce identical full-screen captures.
 */
export function screenshotScriptPath(): string {
  return path.resolve(here, "..", "..", "scripts", "screenshot.ps1");
}

/**
 * Capture the whole Windows desktop (all monitors, full resolution) to a PNG and
 * return its path. Delegates to scripts/screenshot.ps1, which is DPI-aware so
 * scaled displays are captured in full rather than just the top-left region.
 * Windows-only; no native npm dependency.
 */
export async function captureDesktop(): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("Desktop screenshots are only supported on Windows.");
  }

  const outFile = path.join(os.tmpdir(), `tg-claude-shot-${process.pid}-${hrtag()}.png`);

  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      screenshotScriptPath(),
      "-OutFile",
      outFile,
    ],
    { windowsHide: true, timeout: 20_000 },
  );

  log.info("desktop captured", { file: outFile });
  return outFile;
}

/** Short, monotonic-ish tag for unique filenames without Math.random/Date deps. */
function hrtag(): string {
  return process.hrtime.bigint().toString(36);
}
