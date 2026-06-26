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
    return { playwright: { command: node, args: [cli, "--config", configPath] } };
  }

  const args = [cli, "--browser", "chrome"];
  if (CONFIG.browserProfileDir) args.push("--user-data-dir", CONFIG.browserProfileDir);
  if (CONFIG.browserHeadless) args.push("--headless");
  return { playwright: { command: node, args } };
}
