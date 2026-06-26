import { CONFIG } from "../config/index.js";

/**
 * Minimal structured logger. Emits single-line JSON-ish records with a level,
 * timestamp, a short scope tag, a message, and optional structured fields.
 * Kept dependency-free so it works the moment the process starts.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(CONFIG.logLevel as Level)] ?? LEVELS.info;

function emit(level: Level, scope: string, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  const base = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (fields && Object.keys(fields).length > 0) {
    sink(base, JSON.stringify(fields));
  } else {
    sink(base);
  }
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Create a logger bound to a scope tag (e.g. "telegram", "claude", "voice"). */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, f) => emit("debug", scope, m, f),
    info: (m, f) => emit("info", scope, m, f),
    warn: (m, f) => emit("warn", scope, m, f),
    error: (m, f) => emit("error", scope, m, f),
  };
}
