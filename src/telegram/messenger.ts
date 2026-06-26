import type TelegramBot from "node-telegram-bot-api";
import { splitIntoChunks } from "../utils/text.js";
import { createLogger } from "../utils/logger.js";
import { errorText } from "../utils/errors.js";

const log = createLogger("telegram");

/**
 * Thin wrapper over TelegramBot for the sending concerns the app cares about:
 * sending, editing, splitting long replies, and a throttled "live status" edit
 * used while Claude is working. Markdown sends fall back to plain text if
 * Telegram rejects the entities (Claude output can contain unbalanced markup).
 */
export class Messenger {
  constructor(private readonly bot: TelegramBot) {}

  /** Send a message; returns the new message id. */
  async send(
    chatId: number,
    text: string,
    opts?: { markdown?: boolean },
  ): Promise<number> {
    try {
      const sent = await this.bot.sendMessage(chatId, text, {
        parse_mode: opts?.markdown ? "Markdown" : undefined,
      });
      return sent.message_id;
    } catch (err) {
      if (opts?.markdown) {
        const sent = await this.bot.sendMessage(chatId, text);
        return sent.message_id;
      }
      throw err;
    }
  }

  /** Edit an existing message, ignoring "message is not modified" no-ops. */
  async edit(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.bot.editMessageText(text || "…", {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch (err) {
      // Telegram throws if the new text is identical or the message is gone.
      log.debug("edit skipped", { error: errorText(err) });
    }
  }

  /**
   * Send a photo from a local file path (or Buffer). Captions over Telegram's
   * 1024-char limit are trimmed; send long text separately if needed.
   */
  async sendPhoto(
    chatId: number,
    photo: string | Buffer,
    caption?: string,
  ): Promise<void> {
    await this.bot.sendPhoto(chatId, photo, {
      caption: caption ? caption.slice(0, 1024) : undefined,
    });
  }

  /** Send a one-button-per-row inline keyboard. */
  async sendButtons(
    chatId: number,
    text: string,
    buttons: Array<{ text: string; data: string }>,
  ): Promise<void> {
    await this.bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buttons.map((b) => [{ text: b.text, callback_data: b.data }]),
      },
    });
  }

  /**
   * Replace `messageId` with `text`, spilling any overflow beyond Telegram's
   * 4096-char limit into follow-up messages. This is the "edit the Thinking
   * message into the final answer" path.
   */
  async finalize(
    chatId: number,
    messageId: number,
    text: string,
    footer?: string,
  ): Promise<void> {
    const body = footer ? `${text}\n\n${footer}` : text;
    const chunks = splitIntoChunks(body);
    await this.edit(chatId, messageId, chunks[0] || "(empty response)");
    for (let i = 1; i < chunks.length; i++) {
      await this.bot.sendMessage(chatId, chunks[i]);
    }
  }
}

/**
 * A live "Thinking..." message whose text is updated as Claude streams status.
 * Edits are throttled so we don't hit Telegram's rate limits, and the base
 * "Thinking..." prefix is always preserved.
 */
export class ThinkingMessage {
  private lastEdit = 0;
  private lastText = "";

  private constructor(
    private readonly messenger: Messenger,
    private readonly chatId: number,
    readonly messageId: number,
    private readonly minIntervalMs: number,
  ) {}

  static async start(
    messenger: Messenger,
    chatId: number,
    minIntervalMs = 1500,
  ): Promise<ThinkingMessage> {
    const messageId = await messenger.send(chatId, "🤔 Thinking...");
    return new ThinkingMessage(messenger, chatId, messageId, minIntervalMs);
  }

  /** Throttled status update; keeps the "Thinking..." header. */
  status(line: string): void {
    const now = Date.now();
    if (now - this.lastEdit < this.minIntervalMs) return;
    const text = `🤔 Thinking...\n${line}`;
    if (text === this.lastText) return;
    this.lastEdit = now;
    this.lastText = text;
    void this.messenger.edit(this.chatId, this.messageId, text);
  }

  /** Replace this message with the final answer (splitting if needed). */
  finalize(text: string, footer?: string): Promise<void> {
    return this.messenger.finalize(this.chatId, this.messageId, text, footer);
  }

  /** Replace this message with an error notice. */
  fail(message: string): Promise<void> {
    return this.messenger.edit(this.chatId, this.messageId, `❌ ${message}`);
  }
}
