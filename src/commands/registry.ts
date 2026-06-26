import {
  MODELS,
  MODES,
  isMode,
  isModelKey,
} from "../config/index.js";
import { resetSession, updateState } from "../sessions/index.js";
import { endClaudeSession } from "../claude/index.js";
import { listProfiles, resolveProfile } from "../claude/tools/profiles.js";
import { captureDesktop } from "../utils/screenshot.js";
import { CONFIG } from "../config/index.js";
import type { Command, CommandContext } from "./types.js";

/** /new — clear the session, keep model + mode. */
const newCmd: Command = {
  name: "new",
  description: "Start a fresh Claude session (keeps model & mode)",
  handle: (ctx) => {
    resetSession(ctx.chatId); // clear the persisted resume id
    endClaudeSession(ctx.chatId); // drop the warm process so its context is gone
    return ctx.reply("🆕 New session started. Previous conversation context cleared.");
  },
};

/** /model [sonnet|opus|haiku] — set directly, or show buttons. */
const modelCmd: Command = {
  name: "model",
  description: "Switch model: /model sonnet | opus | haiku",
  handle: (ctx) => {
    const arg = ctx.arg.toLowerCase();
    if (arg) {
      if (!isModelKey(arg)) {
        return ctx.reply(`Invalid model. Choose one of: ${Object.keys(MODELS).join(", ")}`);
      }
      updateState(ctx.chatId, (s) => (s.modelKey = arg));
      return ctx.reply(`✅ Model set to *${arg}* (${MODELS[arg]})`, { markdown: true });
    }
    return ctx.replyButtons(
      `Current model: *${ctx.state.modelKey}*\nPick one:`,
      Object.keys(MODELS).map((k) => ({ text: k, data: `model:${k}` })),
    );
  },
};

/** /mode [plan|bypassPermissions|auto] — set directly, or show buttons. */
const modeCmd: Command = {
  name: "mode",
  description: "Switch permission mode: /mode plan | bypassPermissions | auto",
  handle: (ctx) => {
    const arg = ctx.arg;
    if (arg) {
      if (!isMode(arg)) {
        return ctx.reply(`Invalid mode. Choose one of: ${MODES.join(", ")}`);
      }
      updateState(ctx.chatId, (s) => (s.mode = arg));
      return ctx.reply(`✅ Permission mode set to *${arg}*`, { markdown: true });
    }
    return ctx.replyButtons(
      `Current mode: *${ctx.state.mode}*\nPick one:`,
      MODES.map((m) => ({ text: m, data: `mode:${m}` })),
    );
  },
};

/** /status — show current settings. */
const statusCmd: Command = {
  name: "status",
  description: "Show current model, mode, workdir and session state",
  handle: (ctx) => {
    const s = ctx.state;
    return ctx.reply(
      [
        `model:   ${s.modelKey} (${MODELS[s.modelKey]})`,
        `mode:    ${s.mode}`,
        `workdir: ${s.cwd}`,
        `browser: ${s.browser ? "on" : "off"}`,
        `profile: ${s.chromeProfile ? `${s.chromeProfile.name} (${s.chromeProfile.dir})` : "—"}`,
        `session: ${s.sessionId ? "resuming" : "new"}`,
      ].join("\n"),
    );
  },
};

/** /screenshot — capture the Windows desktop and send it as a photo. */
const screenshotCmd: Command = {
  name: "screenshot",
  aliases: ["ss", "shot"],
  description: "Capture the desktop and send it as a photo",
  handle: async (ctx) => {
    await ctx.reply("📸 Capturing the screen…");
    const file = await captureDesktop();
    await ctx.replyPhoto(file, "🖥️ Desktop screenshot");
  },
};

/** /browser [on|off] — toggle browser tools for this session (off = faster). */
const browserCmd: Command = {
  name: "browser",
  description: "Toggle browser tools for this session: /browser on | off",
  handle: (ctx) => {
    if (!CONFIG.browserEnabled) {
      return ctx.reply("Browser tools are disabled globally. Set BROWSER_ENABLED=true in .env first.");
    }
    const arg = ctx.arg.toLowerCase();
    if (arg !== "on" && arg !== "off") {
      return ctx.reply(
        `Browser tools are *${ctx.state.browser ? "on" : "off"}* for this session.\n` +
          "Use /browser on or /browser off. (On adds startup time to each reply.)",
        { markdown: true },
      );
    }
    updateState(ctx.chatId, (s) => (s.browser = arg === "on"));
    return ctx.reply(
      arg === "on"
        ? "✅ Browser tools ON for this session. Heads up: this makes each reply a bit slower."
        : "✅ Browser tools OFF. Replies will be faster now.",
    );
  },
};

/** /profiles — list Chrome profiles (optional browser feature). */
const profilesCmd: Command = {
  name: "profiles",
  description: "List available Chrome profiles (browser tools)",
  handle: (ctx) => {
    if (!CONFIG.browserEnabled) {
      return ctx.reply("Browser tools are disabled. Set BROWSER_ENABLED=true to use them.");
    }
    const all = listProfiles();
    if (!all.length) return ctx.reply("No Chrome profiles found.");
    const lines = all.map((p) => `• ${p.name} — ${p.dir}`).join("\n");
    return ctx.reply(`Chrome profiles:\n${lines}\n\nSelect with: /profile <name>`);
  },
};

/** /profile <name> — select a Chrome profile for browser tools. */
const profileCmd: Command = {
  name: "profile",
  description: "Select a Chrome profile: /profile <name> (or /profile off)",
  handle: (ctx) => {
    if (!CONFIG.browserEnabled) {
      return ctx.reply("Browser tools are disabled. Set BROWSER_ENABLED=true to use them.");
    }
    const arg = ctx.arg.trim();
    if (!arg) {
      return ctx.reply(
        ctx.state.chromeProfile
          ? `Current profile: ${ctx.state.chromeProfile.name}. Change with /profile <name>.`
          : "No profile selected. Run /profiles, then /profile <name>.",
      );
    }
    if (arg.toLowerCase() === "off") {
      updateState(ctx.chatId, (s) => (s.chromeProfile = undefined));
      return ctx.reply("✅ Profile cleared (a temporary browser profile will be used).");
    }
    const found = resolveProfile(arg);
    if (!found) return ctx.reply(`Profile "${arg}" not found. See /profiles.`);
    updateState(ctx.chatId, (s) => (s.chromeProfile = { name: found.name, dir: found.dir }));
    return ctx.reply(
      `✅ Profile: ${found.name} (${found.dir})\n⚠️ Close all Chrome windows first so Playwright can open it.`,
    );
  },
};

// Registered last so /help can introspect the full list.
const commands: Command[] = [
  newCmd,
  modelCmd,
  modeCmd,
  statusCmd,
  screenshotCmd,
  browserCmd,
  profilesCmd,
  profileCmd,
];

const helpCmd: Command = {
  name: "help",
  aliases: ["start"],
  description: "Show this help",
  handle: (ctx) => {
    const lines = [
      "🤖 *Claude Telegram Agent*",
      "",
      "Send a text or voice message and I'll run it through Claude on this machine.",
      "",
      "*Commands:*",
      ...[...commands, helpCmd].map((c) => `/${c.name} — ${c.description}`),
    ];
    return ctx.reply(lines.join("\n"), { markdown: true });
  },
};

commands.push(helpCmd);

/** Lookup table: every trigger word (name + aliases) -> command. */
const byTrigger = new Map<string, Command>();
for (const cmd of commands) {
  byTrigger.set(cmd.name, cmd);
  for (const alias of cmd.aliases ?? []) byTrigger.set(alias, cmd);
}

/** Resolve a "/word ..." message to its command, if any. */
export function resolveCommand(text: string): { command: Command; arg: string } | undefined {
  const match = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(text.trim());
  if (!match) return undefined;
  const command = byTrigger.get(match[1].toLowerCase());
  if (!command) return undefined;
  return { command, arg: match[2].trim() };
}

export type { Command, CommandContext };
