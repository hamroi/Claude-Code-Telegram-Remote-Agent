import type { Mode, ModelKey } from "../config/index.js";

/**
 * Per-chat conversation state. New per-chat settings (voice replies, selected
 * project, etc.) can be added as plain fields here without touching the store
 * logic — only `PERSISTED_KEYS` in store.ts decides what survives a restart.
 */
export interface ChatState {
  /** Telegram chat id this state belongs to. */
  chatId: number;
  /** Selected Claude model (friendly key). */
  modelKey: ModelKey;
  /** Selected permission mode. */
  mode: Mode;
  /** Claude session id to resume; undefined means start a fresh session. */
  sessionId?: string;
  /** Working directory for Claude's tools. A future /project command flips this. */
  cwd: string;
  /** Selected Chrome profile for the optional browser tools (set via /profile). */
  chromeProfile?: { name: string; dir: string };
  /**
   * Whether browser tools attach to this chat's turns. Off by default because
   * spinning up the Playwright MCP server adds latency to every reply — only
   * pay it when the chat actually needs a browser (toggle via /browser).
   */
  browser: boolean;
  /** True while a prompt is being processed, to avoid overlapping turns. Not persisted. */
  busy: boolean;
}
