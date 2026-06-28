# Claude Code Telegram Remote Agent

🌐 Language: **English** · [فارسی](README.fa.md)

Control **Claude Code** on your Windows PC from anywhere using **Telegram**.

Send a message (text **or** voice) to your Telegram bot, and Claude runs it
directly on your machine — reading and writing files, running PowerShell/CMD
commands, installing npm packages, taking screenshots, and more — then replies
right in the chat. It's powered by the official
[**Claude Agent SDK**](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk).

---

## ✨ What it can do

- 📝 **Text** and 🎙️ **voice** messages — voice is transcribed by **ElevenLabs Scribe**.
- ⚡ **Fast** — keeps a warm Claude process per chat, so replies don't pay a cold start every time.
- 💬 **Live replies** — you watch the answer appear as Claude writes it.
- 🖥️ **Screenshots & images** — `/screenshot` sends your **full** desktop (DPI-aware, all monitors); Claude can send any image it creates.
- 📎 **Files both ways** — send a file *to* the bot and Claude reads it; Claude can send any file *back* (documents, logs, archives, …).
- 🌐 **Browser automation** (optional) — Claude can drive a real Chrome browser with full control (forms, tabs, uploads, clipboard, …).
- 🧠 **Memory** — conversations continue across messages and survive a restart.
- 🔒 **Private** — only *your* Telegram chat is accepted; everyone else is ignored.
- 🛠️ **Full machine access** — files, shell (PowerShell/CMD), npm, Node.js, multiple projects.

---

## 🚀 Setup guide (for beginners)

Follow these steps in order. It takes about 10 minutes. Commands go into a
terminal — on Windows use **PowerShell** (press `Win`, type *PowerShell*, Enter).

### Step 1 — Install Node.js

This bot runs on Node.js version **20 or newer**.

1. Go to <https://nodejs.org> and download the **LTS** version.
2. Run the installer, clicking **Next** through all the steps.
3. Close and reopen PowerShell, then check it worked:

   ```bash
   node -v
   ```

   You should see something like `v20.x.x` or higher. ✅

### Step 2 — Get the project files

If you have **Git** installed:

```bash
git clone https://github.com/hamroi/Claude-Code-Telegram-Remote-Agent.git
cd Claude-Code-Telegram-Remote-Agent
```

No Git? Open the repo page, click the green **Code → Download ZIP** button,
unzip it, then `cd` into the folder in PowerShell.

### Step 3 — Install the dependencies

Inside the project folder, run:

```bash
npm install
```

This downloads the libraries the bot needs. Wait for it to finish.

### Step 4 — Create your Telegram bot

1. Open Telegram and search for **[@BotFather](https://t.me/BotFather)** (the official one, with a blue checkmark).
2. Send `/newbot`.
3. Choose a **name** (anything) and a **username** (must end in `bot`, e.g. `my_claude_agent_bot`).
4. BotFather replies with a **token** that looks like `8701832864:AAG-xxxxxxxxxxxxxxxxxxxx`.
5. **Copy that token** — you'll paste it in Step 7.

### Step 5 — Find your Telegram chat ID

The bot only talks to **you**, identified by your numeric chat ID.

1. In Telegram, open **[@userinfobot](https://t.me/userinfobot)** and press **Start**.
2. It replies with your **Id**, a number like `6474033526`.
3. **Copy that number** — it's your `TELEGRAM_ALLOWED_CHAT_ID`.

### Step 6 — (Optional) Get an ElevenLabs key for voice

Only needed if you want to send **voice messages**. Text works without it.

1. Sign up at <https://elevenlabs.io>.
2. Open your profile → **API Keys** → create a key and copy it.

### Step 7 — Create your `.env` file

The project ships with a template called `.env.example`. Make a copy named `.env`:

```bash
copy .env.example .env
```

Now open `.env` in a text editor (Notepad works) and fill in your values:

```ini
TELEGRAM_BOT_TOKEN=8701832864:AAG-xxxxxxxxxxxxxxxxxxxx   # from Step 4
TELEGRAM_ALLOWED_CHAT_ID=6474033526                       # from Step 5
ELEVENLABS_API_KEY=                                        # from Step 6 (leave empty if no voice)
```

> 🔐 **Keep `.env` secret.** It holds your private keys. It is already in
> `.gitignore`, so it will **never** be uploaded to GitHub.

### Step 8 — Install Claude Code and log in

Claude Code is the engine this bot drives. You install it **once** on your PC and
log in; the bot then reuses that login automatically. *(Already have Claude Code
installed and logged in? Skip to Step 9.)*

> 💳 **Account needed:** Claude Code requires a paid **Claude Pro / Max / Team /
> Enterprise** plan, or an **Anthropic Console** (pay-as-you-go) account. The free
> Claude.ai plan does not include Claude Code.

**8.1 — Install it**

The simplest method (uses the Node.js from Step 1):

```bash
npm install -g @anthropic-ai/claude-code
```

> Alternatives if you prefer not to use npm — run **one** of these in PowerShell:
> - Native installer (recommended by Anthropic): `irm https://claude.ai/install.ps1 | iex`
> - WinGet: `winget install Anthropic.ClaudeCode`

**8.2 — Verify the install**

```bash
claude --version
```

You should see a version number (e.g. `2.1.x`). If it says *command not found*,
close and reopen PowerShell and try again.

**8.3 — Log in**

Run Claude Code once and follow the prompts:

```bash
claude
```

It opens your browser to sign in. Log in with your Claude (Pro/Max) account or
your Anthropic Console account. When it's done, return to the terminal and type
`/exit` to quit. ✅ The bot will now use this login automatically — no API key needed.

> 🔑 **Prefer an API key instead of logging in?** Skip 8.3 and add this to your
> `.env` instead:
>
> ```ini
> ANTHROPIC_API_KEY=sk-ant-...
> ```
>
> Get a key from <https://console.anthropic.com> → **API Keys**.

📚 Full Claude Code install docs: <https://code.claude.com/docs/en/setup>

### Step 9 — Start the bot

```bash
npm start
```

You should see `bot started` in the terminal. Leave this window **open** —
closing it stops the bot.

### Step 10 — Try it!

Open your bot in Telegram and send a message like:

> What's my computer's name and current time?

Claude will run it on your machine and reply. 🎉
Send a 🎙️ voice note to test transcription, `/screenshot` to get a picture of
your desktop, or attach a 📎 file with a caption like *"summarize this"*.

---

## ⚙️ Environment variables

All settings live in `.env` (template: `.env.example`).

| Variable                   | Required | Purpose                                                        |
| -------------------------- | :------: | -------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`       |    ✅    | Bot token from @BotFather                                       |
| `TELEGRAM_ALLOWED_CHAT_ID` |    ✅    | Only this chat id is served                                     |
| `ELEVENLABS_API_KEY`       |    ➖    | Voice → text (text chat works without it)                       |
| `ELEVENLABS_STT_MODEL`     |    ❌    | Scribe model id (default: `scribe_v2`)                          |
| `CLAUDE_WORKDIR`           |    ❌    | Folder Claude's tools operate in (default: where you launch it) |
| `SESSIONS_FILE`            |    ❌    | Session save file (default: `<workdir>/.sessions.json`)         |
| `DOWNLOADS_DIR`            |    ❌    | Where files you send the bot are saved (default: `<workdir>/telegram-downloads`) |
| `LOG_LEVEL`                |    ❌    | `debug` \| `info` \| `warn` \| `error` (default: `info`)        |
| `ANTHROPIC_API_KEY`        |    ❌    | Only if you're not logged into Claude Code                      |
| `BROWSER_ENABLED`          |    ❌    | `true` to give Claude browser tools (default: off)              |
| `BROWSER_PROFILE_DIR`      |    ❌    | Persistent Chrome profile dir for browser tools                 |
| `BROWSER_HEADLESS`         |    ❌    | `true` for an invisible browser (default: visible)              |

✅ required · ➖ needed for voice only · ❌ optional

---

## 💬 Commands

| Command       | What it does                                                        |
| ------------- | ------------------------------------------------------------------ |
| `/new`        | Start a fresh conversation (clears context; keeps model & mode)     |
| `/model`      | Switch model — `/model haiku` (fast) · `sonnet` · `opus` (smartest) |
| `/mode`       | Switch permission mode — `plan` · `bypassPermissions` · `auto`      |
| `/screenshot` | Capture the desktop and send it as a photo (aliases `/ss`, `/shot`) |
| `/browser`    | Turn browser tools on/off for this chat — `/browser on` \| `off`    |
| `/profiles`   | List Chrome profiles (when browser tools are enabled)               |
| `/profile`    | Pick a Chrome profile — `/profile <name>` or `/profile off`         |
| `/status`     | Show current model, mode, working folder and session state          |
| `/help`       | Show the command list (`/start` does the same)                      |

### Choosing a model (speed vs. smarts)

- `haiku` — fastest, great for quick questions.
- `sonnet` — balanced (default).
- `opus` — most capable, slowest.

### Permission modes

- **plan** — Claude only plans; it does **not** touch your machine.
- **bypassPermissions** — tools (files, PowerShell/CMD, npm, …) run without asking. *(default — best for a remote agent)*
- **auto** — Claude decides per action whether it's safe to run.

> ⚠️ In `bypassPermissions`, Claude executes commands on your PC without
> confirmation. That's the point of a remote agent — but only ever share the bot
> with yourself (`TELEGRAM_ALLOWED_CHAT_ID` enforces this).

---

## ▶️ Running options

```bash
npm start          # normal run
npm run dev        # auto-restart when you edit the code
npm run typecheck  # check types without running
npm run build && npm run serve   # compile to dist/ and run plain JS
```

### Keep it running 24/7 (optional, with PM2)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 logs claude-telegram-bot      # view output
pm2 save                          # restart automatically after reboot
```

---

## 🧩 Sending & receiving files

**Claude → you.** Claude delivers images and files by writing a marker line in its reply:

```
[[image: C:\path\to\picture.png]]     ← sent as a Telegram photo (shown inline)
[[file:  C:\path\to\report.pdf]]      ← sent as a Telegram document
```

The bot detects these, delivers each file, and strips the marker from the text.
So you can ask *"take a screenshot and send it"*, *"make a chart and send the
picture"*, or *"zip the logs and send me the file"* and it just works.

**You → Claude.** Send any file (document, photo, video, audio) to the bot and
it's saved on your PC under `telegram-downloads/` (configurable via
`DOWNLOADS_DIR`). The file's path is handed to Claude, and your **caption**
becomes the instruction — e.g. attach a PDF with the caption *"summarize this"*.

---

## 📁 Project structure

```
scripts/
  screenshot.ps1   DPI-aware full-screen capture (all monitors)
src/
  config/      reads .env, model list, permission modes
  telegram/    bot wiring (thin adapter) + message sending/editing + file uploads
  claude/      Claude Agent SDK wrapper (warm sessions) + optional browser tools
  voice/       ElevenLabs Scribe transcription
  commands/    command registry (/model, /mode, /new, /screenshot, …)
  sessions/    per-chat state saved to disk
  utils/       logger, screenshots, image/file markers, text splitting
  index.ts     entry point
```

The Telegram layer stays a thin adapter — all real logic lives in the service
modules, so new features (git, docker, image input, voice replies, …) slot in
without rewrites.

---

## 🩹 Troubleshooting

**The bot doesn't reply to my messages.**
- Make sure `npm start` is still running in the terminal.
- Check that `TELEGRAM_ALLOWED_CHAT_ID` in `.env` exactly matches your ID from @userinfobot. Any mismatch is ignored silently by design.

**Error: "model ... not supported".**
- Your Claude endpoint advertises different model ids. The error message lists
  the valid ones — open `src/config/index.ts` and update the `MODELS` map to match.

**Voice messages do nothing.**
- You need `ELEVENLABS_API_KEY` set in `.env`. Without it, only text works.

**The screenshot is black.**
- Desktop capture needs an **active, logged-in screen**. If the bot runs as a
  background service or over a disconnected Remote Desktop session, the screen
  can come out black. Run it in a normal logged-in session.

**Browser tools don't work, or commands run only partway.**
- Set `BROWSER_ENABLED=true` in `.env`, then enable per chat with `/browser on`.
- Make sure you're in **`/mode bypassPermissions`** — in `plan`/`auto` Claude won't
  run the browser actions to completion.
- To use a real Chrome profile, **close all Chrome windows first**, then `/profile <name>`.
- After changing any of the above, send `/new` so a fresh browser session picks them up.

**Replies feel slow.**
- The first message after starting is slower (one-time warm-up). Use `/model haiku`
  for the fastest responses. Remaining latency is mostly your Claude endpoint's network round-trip.

---

## 🔐 Security notes

- This bot can run **any command** on your computer. Only ever point it at your
  own private Telegram chat (enforced by `TELEGRAM_ALLOWED_CHAT_ID`).
- Never commit your `.env`. It's gitignored already — keep it that way.
- One prompt runs at a time per chat; extra messages get a "busy" notice.
