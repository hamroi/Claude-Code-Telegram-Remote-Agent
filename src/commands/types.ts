import type { ChatState } from "../sessions/index.js";

/**
 * Abstraction the command handlers depend on instead of TelegramBot directly.
 * This keeps command logic decoupled from the transport, so commands are easy
 * to unit-test and the Telegram layer stays a thin adapter.
 */
export interface CommandContext {
  chatId: number;
  /** Raw argument string after the command word (trimmed). */
  arg: string;
  /** Current chat state. */
  state: ChatState;
  /** Send a plain (or Markdown) message. */
  reply: (text: string, opts?: { markdown?: boolean }) => Promise<void>;
  /** Send a message with an inline keyboard of {text, data} buttons (one row each). */
  replyButtons: (text: string, buttons: Array<{ text: string; data: string }>) => Promise<void>;
  /** Send a photo from a local file path (or Buffer), with an optional caption. */
  replyPhoto: (photo: string | Buffer, caption?: string) => Promise<void>;
}

export interface Command {
  /** Primary command word without the leading slash, e.g. "model". */
  name: string;
  /** Optional extra trigger words (e.g. "start" and "help"). */
  aliases?: string[];
  /** One-line description for the /help listing. */
  description: string;
  /** Handler implementing the command. */
  handle: (ctx: CommandContext) => Promise<void> | void;
}
