import TelegramBot, { type TelegramBotEvents } from "node-telegram-bot-api";

/** The library doesn't re-export `Message` from its root; derive it from the event map. */
type TgMessage = TelegramBotEvents["message"][0];
import {
  CONFIG,
  MODELS,
  isMode,
  isModelKey,
} from "../config/index.js";
import { getState, updateState } from "../sessions/index.js";
import { runClaude } from "../claude/index.js";
import { transcribeVoice } from "../voice/index.js";
import { resolveCommand } from "../commands/index.js";
import type { Command, CommandContext } from "../commands/index.js";
import { createLogger } from "../utils/logger.js";
import { errorText } from "../utils/errors.js";
import { extractImageMarkers } from "../utils/images.js";
import { Messenger, ThinkingMessage } from "./messenger.js";
import fs from "node:fs";

const log = createLogger("telegram");
const POLLING_WATCHDOG_MS = 15_000;

/**
 * Build and wire the Telegram bot. All business logic lives in the service
 * modules (sessions, claude, voice, commands); this layer is a thin adapter
 * that routes Telegram events into them and enforces access control.
 */
export function createBot(): TelegramBot {
  const bot = new TelegramBot(CONFIG.telegramToken, { polling: true });
  const messenger = new Messenger(bot);

  /** Access control: only the configured chat id is ever served. */
  const allowed = (chatId?: number): boolean => chatId === CONFIG.allowedChatId;

  // ---- Single message entry point ---------------------------------------
  // We handle commands, plain text, and voice from one listener so access
  // control and logging live in exactly one place.
  bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    if (!allowed(chatId)) {
      log.debug("ignored message from unauthorized chat", { chatId });
      return; // silent: no response, no error
    }

    if (msg.voice) {
      void handleVoice(msg);
      return;
    }

    const text = msg.text;
    if (!text) return;

    log.info("incoming", { chatId, kind: "text", preview: text.slice(0, 80) });

    const resolved = resolveCommand(text);
    if (resolved) {
      void runCommand(resolved.command, resolved.arg, chatId);
      return;
    }
    void handlePrompt(chatId, text);
  });

  // ---- Inline keyboard callbacks (model/mode buttons) -------------------
  bot.on("callback_query", (q) => {
    const chatId = q.message?.chat.id;
    if (!allowed(chatId) || !chatId || !q.data) return;
    const messageId = q.message?.message_id;

    if (q.data.startsWith("model:")) {
      const key = q.data.slice(6);
      if (isModelKey(key)) {
        updateState(chatId, (s) => (s.modelKey = key));
        void bot.answerCallbackQuery(q.id, { text: `model: ${key}` });
        if (messageId) void messenger.edit(chatId, messageId, `✅ Model set to ${key} (${MODELS[key]})`);
        log.info("model changed", { chatId, model: key });
      }
    } else if (q.data.startsWith("mode:")) {
      const value = q.data.slice(5);
      if (isMode(value)) {
        updateState(chatId, (s) => (s.mode = value));
        void bot.answerCallbackQuery(q.id, { text: `mode: ${value}` });
        if (messageId) void messenger.edit(chatId, messageId, `✅ Permission mode set to ${value}`);
        log.info("mode changed", { chatId, mode: value });
      }
    }
  });

  // ---- Resilience -------------------------------------------------------
  bot.on("polling_error", (err: any) => {
    log.warn("polling_error", { code: err?.code, message: err?.message });
  });
  bot.on("error", (err: any) => {
    log.error("bot error", { code: err?.code, message: err?.message });
  });

  // Watchdog: restart polling if a transient failure stopped it.
  setInterval(() => {
    if (!bot.isPolling()) {
      log.warn("polling stopped — restarting");
      bot.startPolling().catch((e) => log.error("restart failed", { error: errorText(e) }));
    }
  }, POLLING_WATCHDOG_MS);

  // ---- Handlers ---------------------------------------------------------

  /** Dispatch a parsed command through the decoupled CommandContext. */
  async function runCommand(command: Command, arg: string, chatId: number): Promise<void> {
    const ctx: CommandContext = {
      chatId,
      arg,
      state: getState(chatId),
      reply: async (text, opts) => {
        await messenger.send(chatId, text, opts);
      },
      replyButtons: async (text, buttons) => {
        await messenger.sendButtons(chatId, text, buttons);
      },
      replyPhoto: async (photo, caption) => {
        await messenger.sendPhoto(chatId, photo, caption);
      },
    };
    try {
      log.info("command", { chatId, command: command.name, arg });
      await command.handle(ctx);
    } catch (err) {
      log.error("command failed", { command: command.name, error: errorText(err) });
      await messenger.send(chatId, `❌ Command failed: ${errorText(err)}`);
    }
  }

  /** Download a Telegram voice note, transcribe it, then run it as a prompt. */
  async function handleVoice(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    if (!msg.voice) return;
    log.info("incoming", { chatId, kind: "voice", duration: msg.voice.duration });
    try {
      const link = await bot.getFileLink(msg.voice.file_id);
      const res = await fetch(link);
      const audio = Buffer.from(await res.arrayBuffer());

      const sttStart = Date.now();
      const transcript = await transcribeVoice(audio);
      log.info("voice transcribed", { chatId, ms: Date.now() - sttStart, chars: transcript.length });

      if (!transcript) {
        await messenger.send(chatId, "🗣️ Couldn't make out any speech in that voice note.");
        return;
      }
      await messenger.send(chatId, `📝 _${transcript}_`, { markdown: true });
      await handlePrompt(chatId, transcript);
    } catch (err) {
      log.error("voice failed", { chatId, error: errorText(err) });
      await messenger.send(chatId, `❌ Voice processing failed: ${errorText(err)}`);
    }
  }

  /** Deliver image paths Claude requested, skipping any that don't exist on disk. */
  async function sendImages(chatId: number, images: string[]): Promise<void> {
    for (const file of images) {
      try {
        if (!fs.existsSync(file)) {
          log.warn("image not found", { chatId, file });
          await messenger.send(chatId, `⚠️ Image not found: ${file}`);
          continue;
        }
        await messenger.sendPhoto(chatId, file);
      } catch (err) {
        log.error("send image failed", { chatId, file, error: errorText(err) });
      }
    }
  }

  /**
   * Core flow: send "Thinking...", run Claude (streaming status into that
   * message), then edit it into the final answer. One prompt at a time per chat.
   */
  async function handlePrompt(chatId: number, prompt: string): Promise<void> {
    const state = getState(chatId);
    if (state.busy) {
      await messenger.send(chatId, "⏳ Still working on your previous message…");
      return;
    }
    state.busy = true;

    const turnStart = Date.now();
    const thinking = await ThinkingMessage.start(messenger, chatId);
    try {
      const { text, sessionId, meta } = await runClaude(prompt, state, (status) =>
        thinking.status(status),
      );
      updateState(chatId, (s) => (s.sessionId = sessionId));

      // Claude can ask us to deliver images via [[image: path]] markers.
      const { text: cleaned, images } = extractImageMarkers(text);

      // End-to-end latency the user actually perceived (Claude + Telegram edits).
      const totalMs = Date.now() - turnStart;
      const body = cleaned || (images.length ? "🖼️ Here you go:" : cleaned);
      await thinking.finalize(body, latencyFooter(state.modelKey, totalMs, meta.toolCalls));
      await sendImages(chatId, images);
      log.info("turn complete", { chatId, totalMs, images: images.length });
    } catch (err) {
      log.error("prompt failed", { chatId, error: errorText(err) });
      await thinking.fail(errorText(err));
    } finally {
      state.busy = false;
    }
  }

  return bot;
}

/**
 * A compact one-line footer appended to each answer, e.g.
 *   ⏱ 4.2s · sonnet · 3 tools
 * Gives at-a-glance latency without needing to read the logs.
 */
function latencyFooter(model: string, totalMs: number, toolCalls: number): string {
  const seconds = (totalMs / 1000).toFixed(1);
  const tools = toolCalls > 0 ? ` · ${toolCalls} tool${toolCalls === 1 ? "" : "s"}` : "";
  return `⏱ ${seconds}s · ${model}${tools}`;
}
