import { CONFIG } from "./config/index.js";
import { loadSessions } from "./sessions/index.js";
import { disposeAllClaudeSessions } from "./claude/index.js";
import { createBot } from "./telegram/index.js";
import { createLogger } from "./utils/logger.js";
import { errorText } from "./utils/errors.js";

const log = createLogger("main");

// Keep the process alive through transient failures. The Telegram layer has its
// own polling watchdog; here we just make sure a stray rejection never kills it.
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", { reason: errorText(reason) });
});
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { error: errorText(err) });
});

loadSessions();
const bot = createBot();

log.info("bot started", {
  allowedChatId: CONFIG.allowedChatId,
  workdir: CONFIG.workdir,
  voice: CONFIG.elevenLabsKey ? "enabled" : "disabled (no ELEVENLABS_API_KEY)",
  browser: CONFIG.browserEnabled ? "enabled" : "disabled",
});

function shutdown(): void {
  log.info("shutting down");
  disposeAllClaudeSessions();
  void bot.stopPolling().finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
