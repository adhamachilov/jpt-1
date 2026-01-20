# StudyBot (Telegram AI Bot)

## Setup

1. Install dependencies

```bash
npm install
```

2. Create `.env`

```bash
cp .env.example .env
```

Set:

- `TELEGRAM_BOT_TOKEN`
- `ADMIN_IDS` (comma-separated Telegram user IDs)
- `GROQ_API_KEY`
- `DEEPSEEK_API_KEY`

3. Run

```bash
npm start
```

## Deploy to Netlify (Webhook)

Netlify Functions can't reliably run long polling, so the Netlify deployment uses a Telegram webhook.

### 1) Deploy

- Connect this repo to a Netlify site.
- No build command is required.

### 2) Configure environment variables on Netlify

Set these in Netlify:

- `TELEGRAM_BOT_TOKEN`
- `ADMIN_IDS`
- `GROQ_API_KEY`
- `DEEPSEEK_API_KEY`

Optional (recommended):

- `TELEGRAM_WEBHOOK_SECRET` (any random string; Telegram will send it back via header)
- `BLOBS_STORE_NAME` (defaults to `studybot`)
- `GROQ_MODEL`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`
- `LLM_TIMEOUT_MS`, `MAX_OUTPUT_TOKENS`, `MAX_INPUT_CHARS`

### 3) Set the Telegram webhook URL

After deploy, set the webhook to:

- `https://<your-site>.netlify.app/telegram-webhook`

If you set `TELEGRAM_WEBHOOK_SECRET`, set it as Telegram's secret token for the webhook too.

## Commands

- `/start` (everyone)
- `/status` (everyone)
- `/admin` (admin only)
  - `/admin add <user_id>`
  - `/admin remove <user_id>`
  - `/admin list`
  - `/admin stats`
  - `/admin usage`
  - `/admin broadcast <message>`
  - `/admin switch_model`

## Access Control

- Unapproved users can only use `/start` and `/status`.
- Approved users (or admins) can chat normally.
- Approved user IDs are stored in `data/state.json` (configurable via `STORE_PATH`).

On Netlify, state is stored in Netlify Blobs (persisted across deploys).
