import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONFIG } from "../../config/index.js";
import type { ChatState } from "../../sessions/index.js";
import { chromeUserDataDir } from "./profiles.js";

/**
 * Optional Playwright browser-automation tools, exposed to Claude as an MCP
 * server. Disabled unless BROWSER_ENABLED=true so the core bot has no hard
 * dependency on @playwright/mcp. This is the seam for future tool servers
 * (git, docker, etc.) — add another entry to the returned record.
 */

const require = createRequire(import.meta.url);

/** Resolve @playwright/mcp's cli.js next to its main entry (lazily, so it's optional). */
function resolvePlaywrightCli(): string {
  return path.join(path.dirname(require.resolve("@playwright/mcp")), "cli.js");
}

export type McpServers = Record<string, { command: string; args: string[] }>;

/**
 * Flags that give Claude full, reliable control of Chrome. Without these the
 * Playwright MCP defaults cut actions short:
 *  - the 5s action timeout aborts clicks/typing on slow pages (raised to 30s);
 *  - file access is sandboxed to the workspace (blocks uploads / file:// URLs);
 *  - sites that ask for clipboard/geolocation/camera/etc. are denied;
 *  - HTTPS certificate errors block navigation;
 *  - vision / pdf / devtools tools are off.
 * `--grant-permissions` is variadic, so it MUST stay last in the arg list.
 */
const FULL_ACCESS_ARGS = [
  "--caps", "vision,pdf,devtools",
  "--ignore-https-errors",
  "--allow-unrestricted-file-access",
  "--no-sandbox",
  "--timeout-action", "30000",
  "--timeout-navigation", "120000",
  "--grant-permissions",
  "geolocation",
  "notifications",
  "camera",
  "microphone",
  "clipboard-read",
  "clipboard-write",
  "midi",
];

/**
 * Build the MCP server map for a chat. Returns an empty object when browser
 * tools are disabled. When a Chrome profile is selected, Playwright is pointed
 * at the real user-data-dir and that exact profile folder.
 */
export function mcpServers(state: ChatState): McpServers {
  // Master switch (env) AND per-chat toggle must both be on. Skipping this
  // avoids booting the Playwright MCP server on turns that never browse.
  if (!CONFIG.browserEnabled || !state.browser) return {};

  const node = process.execPath;
  const cli = resolvePlaywrightCli();

  if (state.chromeProfile) {
    const config = {
      browser: {
        userDataDir: chromeUserDataDir,
        launchOptions: {
          channel: "chrome",
          headless: CONFIG.browserHeadless,
          args: [`--profile-directory=${state.chromeProfile.dir}`],
        },
      },
    };
    const configPath = path.join(CONFIG.workdir, ".mcp-chrome-config.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    // Keep FULL_ACCESS_ARGS last so the variadic --grant-permissions is terminal.
    return { playwright: { command: node, args: [cli, "--config", configPath, ...FULL_ACCESS_ARGS] } };
  }

  const args = [cli, "--browser", "chrome"];
  if (CONFIG.browserProfileDir) args.push("--user-data-dir", CONFIG.browserProfileDir);
  if (CONFIG.browserHeadless) args.push("--headless");
  args.push(...FULL_ACCESS_ARGS); // must come last (variadic --grant-permissions)
  return { playwright: { command: node, args } };
}
