import "dotenv/config";

/**
 * Centralised, validated configuration. Everything the app needs is read from
 * environment variables here and nowhere else, so the rest of the codebase can
 * depend on a single typed `CONFIG` object.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Friendly model name (used by /model) -> exact Claude model id.
 * These ids must match what your API endpoint advertises. If you hit a
 * "model not supported" 400, the error lists the valid ids — update them here.
 */
export const MODELS = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5-20251001",
} as const;

export type ModelKey = keyof typeof MODELS;

/** Permission modes exposed via /mode. All map to valid Claude Agent SDK modes. */
export const MODES = ["plan", "bypassPermissions", "auto"] as const;
export type Mode = (typeof MODES)[number];

export const DEFAULT_MODEL_KEY: ModelKey = "sonnet";
export const DEFAULT_MODE: Mode = "bypassPermissions";

export const CONFIG = {
  /** Telegram bot token from @BotFather. */
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  /** Only this chat id is served; all other chats are ignored silently. */
  allowedChatId: Number(required("TELEGRAM_ALLOWED_CHAT_ID")),
  /** ElevenLabs key — only voice transcription needs it; text chat works without. */
  elevenLabsKey: process.env.ELEVENLABS_API_KEY ?? "",
  /** ElevenLabs Scribe model id. */
  scribeModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
  /** Base working directory for Claude's tools (file ops, shell, etc.). */
  workdir: process.env.CLAUDE_WORKDIR || process.cwd(),
  /** Where per-chat session state is persisted as JSON. */
  sessionsFile:
    process.env.SESSIONS_FILE ||
    `${process.env.CLAUDE_WORKDIR || process.cwd()}/.sessions.json`,
  /** Folder where files sent to the bot are saved so Claude can work with them. */
  downloadsDir:
    process.env.DOWNLOADS_DIR ||
    `${process.env.CLAUDE_WORKDIR || process.cwd()}/telegram-downloads`,
  /** Minimum log level to emit: debug < info < warn < error. */
  logLevel: process.env.LOG_LEVEL || "info",
  /** Enable the optional Playwright browser-automation tools for Claude. */
  browserEnabled: process.env.BROWSER_ENABLED === "true",
  /** Persistent Chrome user-data-dir (keeps logins). Empty = ephemeral profile. */
  browserProfileDir: process.env.BROWSER_PROFILE_DIR || "",
  /** Run the browser headless (no visible window). Default: headed. */
  browserHeadless: process.env.BROWSER_HEADLESS === "true",
} as const;

export function isModelKey(value: string): value is ModelKey {
  return value in MODELS;
}

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}
