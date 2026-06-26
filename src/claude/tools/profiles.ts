import fs from "node:fs";
import path from "node:path";

/** Root of Chrome's profiles (override with CHROME_USER_DATA_DIR if non-standard). */
export const chromeUserDataDir =
  process.env.CHROME_USER_DATA_DIR ||
  path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");

export interface ChromeProfile {
  /** Display name you see in Chrome, e.g. "Lana". */
  name: string;
  /** On-disk folder Chrome actually uses, e.g. "Profile 6". */
  dir: string;
}

/** Read the display-name → folder mapping from Chrome's "Local State" file. */
export function listProfiles(): ChromeProfile[] {
  try {
    const raw = fs.readFileSync(path.join(chromeUserDataDir, "Local State"), "utf8");
    const cache = JSON.parse(raw)?.profile?.info_cache ?? {};
    return Object.entries(cache)
      .map(([dir, info]) => ({ dir, name: (info as { name?: string }).name ?? dir }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Resolve typed input to a profile, case-insensitively. Accepts:
 *   - display name:  "Lana"
 *   - folder:        "Profile 6"
 *   - bare number:   "5"  -> "Profile 5"   ("Default" stays "Default")
 */
export function resolveProfile(query: string): ChromeProfile | undefined {
  const q = query.trim().toLowerCase();
  const all = listProfiles();
  const numeric = /^\d+$/.test(q) ? `profile ${q}` : q;
  return (
    all.find((p) => p.name.toLowerCase() === q) ||
    all.find((p) => p.dir.toLowerCase() === q) ||
    all.find((p) => p.dir.toLowerCase() === numeric)
  );
}
