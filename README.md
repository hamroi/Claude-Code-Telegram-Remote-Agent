# Claude Telegram Agent (Windows Host)

A production-ready Telegram bot that runs locally and uses the **Claude Agent
SDK** as its execution engine. It turns Telegram into a remote interface for
Claude running directly on your Windows machine — send a task by text or voice,
Claude executes it on the local environment (files, shell, npm, …) and replies.

## Features

- 📝 **Text** and 🎙️ **voice** input — voice is transcribed with **ElevenLabs
  Scribe (`scribe_v2`)** before being sent to Claude.
- 🤔 **Single-message UX** — sends `Thinking...` immediately, streams status as
  Claude works, then **edits the same message** into the final answer. Long
  answers spill into follow-up messages only when they exceed Telegram's limit.
- 🧠 **Session memory** — conversations resume across messages; persisted to disk
  so model/mode/session survive a restart.
- `/model` — switch between **sonnet / opus / haiku**.
- `/mode` — switch permission mode: **plan / bypassPermissions / auto**.
- `/new` — start a fresh session (clears context, keeps model & mode).
- 🔒 **Access control** — only `TELEGRAM_ALLOWED_CHAT_ID` is served; everyone
  else is ignored with no response.
- 🧩 **Modular architecture** — each subsystem has its own service layer, so new
  capabilities (git, docker, image input, voice replies, …) drop in cleanly.

## Prerequisites

- **Node.js 20+** (uses global `fetch` / `FormData` / `Blob`).
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather).
- An **ElevenLabs API key** (only needed for voice).
- **Claude access** — either you're logged into Claude Code on this machine, or
  you set `ANTHROPIC_API_KEY`. The Agent SDK uses your local login automatically.

## Installation

```bash
cd claude-telegram-bot
npm install
cp .env.example .env      # then edit .env with your tokens
```

## Environment variables

All configuration is read from environment variables (see `.env.example`).

| Variable                   | Required | Purpose                                                   |
| -------------------------- | -------- | --------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`       | ✅       | Bot token from @BotFather                                  |
| `TELEGRAM_ALLOWED_CHAT_ID` | ✅       | Only this chat id is accepted                              |
| `ELEVENLABS_API_KEY`       | ➖       | Voice → text transcription (text chat works without it)    |
| `ELEVENLABS_STT_MODEL`     | ❌       | Scribe model id (default: `scribe_v2`)                     |
| `CLAUDE_WORKDIR`           | ❌       | Directory Claude's tools operate in (default: launch dir)  |
| `SESSIONS_FILE`            | ❌       | Session persistence path (default: `<workdir>/.sessions.json`) |
| `LOG_LEVEL`                | ❌       | `debug` \| `info` \| `warn` \| `error` (default: `info`)   |
| `ANTHROPIC_API_KEY`        | ❌       | Only if you're not logged into Claude Code                 |
| `BROWSER_ENABLED`          | ❌       | `true` to expose Playwright browser tools (default: off)   |
| `BROWSER_PROFILE_DIR`      | ❌       | Persistent Chrome user-data-dir for browser tools          |
| `BROWSER_HEADLESS`         | ❌       | `true` for a headless browser (default: headed)            |

> **Finding your chat id:** message the bot once and watch the logs, or use
> [@userinfobot](https://t.me/userinfobot).

## Running the bot

```bash
npm start          # run with tsx (no build step)
npm run dev        # auto-restart on file changes
npm run typecheck  # type-check only
npm run build && npm run serve   # compile to dist/ and run plain JS
```

On Windows, open PowerShell or CMD:

```
cd "C:\Users\Rubika Stock\claude-telegram-bot"
npm start
```

### Keep it always on (PM2)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 logs claude-telegram-bot
pm2 save
```

## Available commands

| Command     | What it does                                                  |
| ----------- | ------------------------------------------------------------- |
| `/new`      | Start a new session (clears context, keeps model & mode)      |
| `/model`    | `/model opus` to set, or `/model` for buttons                 |
| `/mode`     | `/mode plan` to set, or `/mode` for buttons                   |
| `/status`   | Show current model, mode, workdir and session state           |
| `/profiles` | List Chrome profiles (when `BROWSER_ENABLED=true`)            |
| `/profile`  | `/profile <name>` to select a Chrome profile, `/profile off`  |
| `/help`     | Show help (`/start` is an alias)                              |

**Permission modes**

- **plan** — Claude plans only; it does not execute tools.
- **bypassPermissions** — tools (file read/write, Bash/PowerShell/CMD, …) run
  without prompts. *(default — best for an unattended remote agent)*
- **auto** — a model classifier decides whether each tool call is allowed.

## Project structure

```
src/
  config/      env loading, model map, permission modes
  telegram/    bot wiring (adapter) + messenger (send/edit/split, Thinking flow)
  claude/      Claude Agent SDK wrapper + optional tools (browser, profiles)
  voice/       ElevenLabs Scribe transcription
  commands/    command registry (/model, /mode, /new, /status, …)
  sessions/    per-chat state + JSON persistence
  utils/       logger, error helpers, text splitting
  index.ts     entry point: load sessions, start bot, wire signals
```

The design keeps **business logic out of the Telegram handlers**: `telegram/`
is a thin adapter that routes events into the service modules. Each subsystem
exposes a small API through its `index.ts` barrel.

## Extending

The seams are deliberate — most additions touch one or two files:

- **Voice replies (text → speech):** add `voice/tts.ts` and a `voiceReply` flag
  in `sessions/types.ts`; in `handlePrompt` (`telegram/bot.ts`), synthesize and
  `bot.sendVoice(...)` when the flag is on.
- **Project switching / multi-project:** add a `/project` command that sets
  `state.cwd`. The Claude wrapper already passes `cwd` per turn.
- **Image input:** add a `photo` branch in the message handler that downloads the
  image and passes structured content to `runClaude`.
- **Git / Docker / more tools:** add another MCP server entry alongside the
  browser one in `claude/tools/`. `mcpServers(state)` is the single seam.

## Notes

- Replies are sent as **plain text** and split automatically at Telegram's
  4096-character limit (Markdown from Claude can contain unbalanced entities).
- One prompt is processed at a time per chat; overlapping messages get a "busy"
  notice.
- Session state persists to `SESSIONS_FILE`; delete it to wipe all sessions.
