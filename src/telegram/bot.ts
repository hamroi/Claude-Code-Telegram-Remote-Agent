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
import { extractFileMarkers } from "../utils/files.js";
import { Messenger, ThinkingMessage } from "./messenger.js";
import fs from "node:fs";
import path from "node:path";

/** Telegram bots can only download files up to 20 MB via getFile. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** A downloadable attachment normalized across Telegram's message shapes. */
interface Attachment {
  fileId: string;
  fileName: string;
  kind: "document" | "photo" | "video" | "audio";
  size?: number;
}

/** Pick the relevant attachment from a message, with a sensible default filename. */
function pickAttachment(msg: TgMessage): Attachment | undefined {
  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      fileName: msg.document.file_name || `document_${msg.message_id}`,
      kind: "document",
      size: msg.document.file_size,
    };
  }
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1]; // last entry is highest-res
    return {
      fileId: largest.file_id,
      fileName: `photo_${msg.message_id}.jpg`,
      kind: "photo",
      size: largest.file_size,
    };
  }
  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      fileName: (msg.video as { file_name?: string }).file_name || `video_${msg.message_id}.mp4`,
      kind: "video",
      size: msg.video.file_size,
    };
  }
  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      fileName: msg.audio.file_name || `audio_${msg.message_id}.mp3`,
      kind: "audio",
      size: msg.audio.file_size,
    };
  }
  return undefined;
}

/** Sanitize a filename and avoid overwriting an existing file in `dir`. */
function uniqueDest(dir: string, fileName: string, messageId: number): string {
  const safe = path.basename(fileName).replace(/[\\/:*?"<>|]/g, "_") || `file_${messageId}`;
  const dest = path.join(dir, safe);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(safe);
  return path.join(dir, `${safe.slice(0, safe.length - ext.length)}_${messageId}${ext}`);
}

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

    // Any uploaded file (document / photo / video / audio) is downloaded to the
    // host so Claude can read it; the caption (if any) becomes the instruction.
    if (msg.document || msg.photo || msg.video || msg.audio) {
      void handleFile(msg);
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

  /** Download a Telegram file by id to an absolute destination path. */
  async function downloadTelegramFile(fileId: string, dest: string): Promise<void> {
    const link = await bot.getFileLink(fileId);
    const res = await fetch(link);
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }

  /**
   * Save an uploaded file onto the host, then run the caption (or a default
   * instruction) through Claude with the file's path so it can read/use it.
   */
  async function handleFile(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    const attachment = pickAttachment(msg);
    if (!attachment) return;

    log.info("incoming", {
      chatId,
      kind: attachment.kind,
      fileName: attachment.fileName,
      size: attachment.size,
    });

    if (attachment.size && attachment.size > MAX_DOWNLOAD_BYTES) {
      await messenger.send(
        chatId,
        "⚠️ That file is larger than 20 MB, which is the limit Telegram allows bots to download.",
      );
      return;
    }

    try {
      fs.mkdirSync(CONFIG.downloadsDir, { recursive: true });
      const dest = uniqueDest(CONFIG.downloadsDir, attachment.fileName, msg.message_id);
      await downloadTelegramFile(attachment.fileId, dest);
      log.info("file saved", { chatId, dest });
      await messenger.send(chatId, `📎 Saved: \`${dest}\``, { markdown: true });

      const caption = msg.caption?.trim();
      const instruction =
        caption || "I uploaded a file. Inspect it and tell me what it contains.";
      const prompt = `${instruction}\n\n(The user uploaded a file. It is saved on this machine at: ${dest})`;
      await handlePrompt(chatId, prompt);
    } catch (err) {
      log.error("file failed", { chatId, error: errorText(err) });
      await messenger.send(chatId, `❌ Couldn't save the file: ${errorText(err)}`);
    }
  }

  /** Deliver file paths Claude requested as Telegram documents. */
  async function sendFiles(chatId: number, files: string[]): Promise<void> {
    for (const file of files) {
      try {
        if (!fs.existsSync(file)) {
          log.warn("file not found", { chatId, file });
          await messenger.send(chatId, `⚠️ File not found: ${file}`);
          continue;
        }
        await messenger.sendDocument(chatId, file);
      } catch (err) {
        log.error("send file failed", { chatId, file, error: errorText(err) });
      }
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
      const { text: afterImages, images } = extractImageMarkers(text);
      // Claude can ask us to deliver files via [[file: path]] markers.
      const { text: cleaned, files } = extractFileMarkers(afterImages);

      // End-to-end latency the user actually perceived (Claude + Telegram edits).
      const totalMs = Date.now() - turnStart;
      const body = cleaned || (images.length || files.length ? "📎 Here you go:" : cleaned);
      await thinking.finalize(body, latencyFooter(state.modelKey, totalMs, meta.toolCalls));
      await sendImages(chatId, images);
      await sendFiles(chatId, files);
      log.info("turn complete", { chatId, totalMs, images: images.length, files: files.length });
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
