import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { MODELS, type Mode, type ModelKey } from "../config/index.js";
import { createLogger } from "../utils/logger.js";
import type { ChatState } from "../sessions/index.js";
import { mcpServers } from "./tools/browser.js";

const log = createLogger("claude");

export interface ClaudeResult {
  /** Final answer text. */
  text: string;
  /** Session id to persist (lets context survive a bot restart via resume). */
  sessionId?: string;
  /** Turn metadata, useful for a latency footer and diagnostics. */
  meta: {
    /** Total wall-clock for the turn in ms. With a warm session this excludes CLI startup. */
    durationMs: number;
    /** Time until Claude's first output in ms, or null if none was produced. */
    firstChunkMs: number | null;
    /** Number of tool calls Claude made this turn. */
    toolCalls: number;
  };
}

/** Progress hook: called with short human-readable status lines as Claude works. */
export type OnStatus = (status: string) => void;

const SYSTEM_APPEND =
  "You are operating directly on a Windows host via the Telegram bridge. You may " +
  "read/create/modify/delete files, run shell / PowerShell / CMD commands, manage " +
  "project folders, install npm packages, and run Node.js apps. Keep replies concise " +
  "and suitable for a chat client. For destructive or irreversible actions, confirm intent first. " +
  "To send an image, screenshot, or chart to the user, save it to a file and include a line " +
  "of the exact form [[image: C:\\full\\path\\to\\file.png]] in your reply — each such line is " +
  "delivered to the user as a photo and removed from the visible text. To screenshot the desktop, " +
  "use PowerShell with System.Windows.Forms/System.Drawing to save a PNG, then emit its [[image: ...]] marker.";

/** Trim a streaming answer to a tail that fits comfortably in a Telegram edit. */
function streamPreview(text: string, max = 3500): string {
  const body = text.length > max ? `…${text.slice(-max)}` : text;
  return `${body} ▌`;
}

/**
 * Identity of the underlying Claude process. cwd / browser / profile are fixed
 * when the process starts and cannot be changed live, so a change in any of them
 * requires a fresh process. Model and mode are NOT part of the key — they are
 * switched in place via setModel / setPermissionMode.
 */
function sessionKey(state: ChatState): string {
  return [state.cwd, state.browser ? "browser" : "no-browser", state.chromeProfile?.dir ?? ""].join("|");
}

/** Minimal push-driven async iterable used to feed user messages into a live query. */
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffer: SDKUserMessage[] = [];
  private readonly waiters: Array<(r: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.buffer.push(message);
  }

  close(): void {
    this.closed = true;
    let waiter: ((r: IteratorResult<SDKUserMessage>) => void) | undefined;
    while ((waiter = this.waiters.shift())) waiter({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        const queued = this.buffer.shift();
        if (queued) return Promise.resolve({ value: queued, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/** State for the single in-flight turn (we process one turn per chat at a time). */
interface ActiveTurn {
  onStatus?: OnStatus;
  texts: string[];
  toolCalls: number;
  firstChunkAt: number;
  startedAt: number;
  resolve: (result: ClaudeResult) => void;
  reject: (error: Error) => void;
}

/**
 * A long-lived Claude process for one chat. Keeping it warm removes the ~1–2s
 * CLI cold start that a fresh `query()` pays on every message, and preserves
 * conversation context natively (no per-turn resume).
 */
class ClaudeSession {
  readonly key: string;
  private readonly query: Query;
  private readonly input = new MessageQueue();
  private active: ActiveTurn | null = null;
  private dead = false;
  private appliedModel: ModelKey;
  private appliedMode: Mode;
  private sessionId?: string;

  constructor(state: ChatState) {
    this.key = sessionKey(state);
    this.appliedModel = state.modelKey;
    this.appliedMode = state.mode;
    this.sessionId = state.sessionId;

    this.query = query({
      prompt: this.input,
      options: {
        model: MODELS[state.modelKey],
        permissionMode: state.mode,
        cwd: state.cwd,
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
        mcpServers: mcpServers(state),
        // Resume prior context after a bot restart when we have an id.
        ...(state.sessionId ? { resume: state.sessionId } : {}),
      },
    });

    void this.consume();
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** Send one prompt and resolve when Claude finishes the turn. */
  async send(state: ChatState, prompt: string, onStatus?: OnStatus): Promise<ClaudeResult> {
    if (this.dead) throw new Error("Claude session is no longer active");
    if (this.active) throw new Error("A turn is already in progress for this chat");

    // Apply model / mode changes in place — keeps the warm process and context.
    if (state.modelKey !== this.appliedModel) {
      await this.query.setModel(MODELS[state.modelKey]);
      this.appliedModel = state.modelKey;
      log.info("model switched live", { chatId: state.chatId, model: state.modelKey });
    }
    if (state.mode !== this.appliedMode) {
      await this.query.setPermissionMode(state.mode);
      this.appliedMode = state.mode;
      log.info("mode switched live", { chatId: state.chatId, mode: state.mode });
    }

    return new Promise<ClaudeResult>((resolve, reject) => {
      this.active = {
        onStatus,
        texts: [],
        toolCalls: 0,
        firstChunkAt: 0,
        startedAt: Date.now(),
        resolve,
        reject,
      };
      this.input.push({
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: prompt },
      });
    });
  }

  /** Tear the process down (e.g. on /new or a settings change that needs a restart). */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.input.close();
    void Promise.resolve(this.query.interrupt?.()).catch(() => {});
  }

  /** Consume the query output stream for the lifetime of the process. */
  private async consume(): Promise<void> {
    try {
      for await (const message of this.query as AsyncIterable<any>) {
        if (message.type === "system" && message.subtype === "init") {
          this.sessionId = message.session_id ?? this.sessionId;
          continue;
        }

        const turn = this.active;
        if (!turn) continue;

        if (message.type === "assistant") {
          if (!turn.firstChunkAt) turn.firstChunkAt = Date.now();
          for (const block of message.message?.content ?? []) {
            if (block.type === "text" && block.text) {
              turn.texts.push(block.text);
              // Live-stream the answer so the user isn't staring at "Thinking...".
              turn.onStatus?.(streamPreview(turn.texts.join("")));
            } else if (block.type === "tool_use") {
              turn.toolCalls++;
              turn.onStatus?.(`🛠️ ${block.name ?? "tool"}`);
            }
          }
        } else if (message.type === "result") {
          this.sessionId = message.session_id ?? this.sessionId;
          this.active = null;
          const text =
            (typeof message.result === "string" && message.result.trim()) ||
            turn.texts.join("\n").trim() ||
            "(No response received from Claude.)";
          const now = Date.now();
          turn.resolve({
            text,
            sessionId: this.sessionId,
            meta: {
              durationMs: now - turn.startedAt,
              firstChunkMs: turn.firstChunkAt ? turn.firstChunkAt - turn.startedAt : null,
              toolCalls: turn.toolCalls,
            },
          });
        }
      }
      // The stream ended. If we didn't ask for it, treat it as a failure.
      if (!this.dead) this.fail(new Error("Claude session ended unexpectedly"));
    } catch (err) {
      if (!this.dead) this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private fail(error: Error): void {
    this.dead = true;
    const turn = this.active;
    this.active = null;
    turn?.reject(error);
  }
}

/** One warm Claude process per chat. */
const sessions = new Map<number, ClaudeSession>();

/**
 * Run one Claude turn for a chat, reusing the chat's warm process when possible.
 * A new process is started only on first use, after a crash, or when a
 * start-time setting (cwd / browser / profile) changed.
 */
export async function runClaude(
  prompt: string,
  state: ChatState,
  onStatus?: OnStatus,
): Promise<ClaudeResult> {
  let session = sessions.get(state.chatId);

  if (session && (session.isDead || session.key !== sessionKey(state))) {
    session.dispose();
    sessions.delete(state.chatId);
    session = undefined;
  }

  if (!session) {
    session = new ClaudeSession(state);
    sessions.set(state.chatId, session);
    log.info("claude session started", {
      chatId: state.chatId,
      model: state.modelKey,
      mode: state.mode,
      resume: state.sessionId ? "resume" : "new",
    });
  } else {
    log.info("claude session reused (warm)", { chatId: state.chatId });
  }

  try {
    return await session.send(state, prompt, onStatus);
  } catch (err) {
    // A failed turn means the process is suspect — drop it so the next message
    // starts a clean one instead of reusing a broken pipe.
    session.dispose();
    sessions.delete(state.chatId);
    throw err;
  }
}

/** End and forget a chat's warm process (used by /new to drop context). */
export function endClaudeSession(chatId: number): void {
  const session = sessions.get(chatId);
  if (!session) return;
  session.dispose();
  sessions.delete(chatId);
  log.info("claude session ended", { chatId });
}

/** Dispose every warm process. Call on shutdown to avoid orphaned children. */
export function disposeAllClaudeSessions(): void {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
}
