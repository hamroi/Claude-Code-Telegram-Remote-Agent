import fs from "node:fs";
import {
  CONFIG,
  DEFAULT_MODE,
  DEFAULT_MODEL_KEY,
} from "../config/index.js";
import { createLogger } from "../utils/logger.js";
import { errorText } from "../utils/errors.js";
import type { ChatState } from "./types.js";

const log = createLogger("sessions");

/**
 * In-memory session store backed by a JSON file. State is kept hot in a Map for
 * fast access and flushed to disk whenever it changes, so model/mode choices and
 * the Claude session id survive a bot restart.
 */
const states = new Map<number, ChatState>();

/** Fields written to disk. `busy` is runtime-only and deliberately excluded. */
const PERSISTED_KEYS = [
  "chatId",
  "modelKey",
  "mode",
  "sessionId",
  "cwd",
  "chromeProfile",
  "browser",
] as const;

function freshState(chatId: number): ChatState {
  return {
    chatId,
    modelKey: DEFAULT_MODEL_KEY,
    mode: DEFAULT_MODE,
    cwd: CONFIG.workdir,
    browser: false,
    busy: false,
  };
}

/** Load persisted sessions from disk into memory. Call once at startup. */
export function loadSessions(): void {
  try {
    if (!fs.existsSync(CONFIG.sessionsFile)) return;
    const raw = fs.readFileSync(CONFIG.sessionsFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChatState>[];
    for (const entry of parsed) {
      if (typeof entry.chatId !== "number") continue;
      states.set(entry.chatId, {
        ...freshState(entry.chatId),
        ...entry,
        busy: false, // never restore a stale "busy" flag
      });
    }
    log.info("sessions loaded", { count: states.size, file: CONFIG.sessionsFile });
  } catch (err) {
    log.warn("failed to load sessions; starting fresh", { error: errorText(err) });
  }
}

/** Persist the current set of sessions to disk (best-effort, non-throwing). */
function persist(): void {
  try {
    const serialisable = [...states.values()].map((s) => {
      const out: Record<string, unknown> = {};
      for (const key of PERSISTED_KEYS) out[key] = s[key];
      return out;
    });
    fs.writeFileSync(CONFIG.sessionsFile, JSON.stringify(serialisable, null, 2));
  } catch (err) {
    log.warn("failed to persist sessions", { error: errorText(err) });
  }
}

/** Get (or lazily create) the state for a chat. */
export function getState(chatId: number): ChatState {
  let state = states.get(chatId);
  if (!state) {
    state = freshState(chatId);
    states.set(chatId, state);
    persist();
  }
  return state;
}

/**
 * Apply a mutation to a chat's state and persist the result. Use this for any
 * change that should survive a restart (model, mode, session id, cwd, profile).
 */
export function updateState(chatId: number, mutate: (state: ChatState) => void): ChatState {
  const state = getState(chatId);
  mutate(state);
  persist();
  return state;
}

/**
 * Start a brand-new Claude session for this chat, keeping model and mode.
 * Clears the resumable session id and any in-flight conversation reference.
 */
export function resetSession(chatId: number): ChatState {
  return updateState(chatId, (s) => {
    s.sessionId = undefined;
  });
}
