# Filflo Bot — Local Secrets Setup

The Command Center panel (`anveshan-tracking.vercel.app`) ships every bot
script in this folder, but **credentials must be placed locally on the
machine that actually runs `bot_server.py`** — they're never committed
to GitHub (see `.gitignore` at repo root).

Below are the four files ops/dev must create after pulling the repo.

---

## 1. `.env` — Filflo / Gmail / Slack credentials

Copy `.env.example` → `.env` and fill in real values:

```bash
cd scripts/filflo_bot_server
cp .env.example .env
notepad .env   # (or your editor of choice)
```

Required keys (see `.env.example` for the full list):

| Key | Purpose |
|---|---|
| `FILFLO_LOGIN_EMAIL` | Filflo portal login user (e.g. `nandlal@anveshan.farm`) |
| `FILFLO_LOGIN_PASSWORD` | Filflo portal password |
| `FILFLO_GMAIL_APP_PASSWORD` | Gmail app password used for alert emails |
| `SCOOTSY_GMAIL_APP_PASSWORD` | (optional) Scootsy alerts |
| `SLACK_BOT_TOKEN` | (optional) Slack notification bridge |

---

## 2. `client_secret.json` — Google OAuth client

Get this from Google Cloud Console → APIs & Services → Credentials →
download the OAuth 2.0 Client ID JSON for the `filflo-bot` project.

Place at: `scripts/filflo_bot_server/client_secret.json`

---

## 3. `authorized_user.json` — Google OAuth refresh token

First time `push_to_gsheet.py` (or any sheet-touching script) runs, it
opens a browser to authorise the bot user account. On success it writes
`authorized_user.json` here. Subsequent runs reuse the refresh token.

**Manual placement (preferred for headless servers):** ask whoever set
up the previous instance for their copy of this file and drop it here.

---

## 4. `config.json` — bot config (login email + portal URLs)

Copy from the existing production bot machine or recreate:

```json
{
  "login_email": "prashant@anveshan.farm",
  "partnersbiz_base": "https://www.partnersbiz.com",
  "schedule_url": "https://www.partnersbiz.com/app/appointments/schedule/{po_number}",
  "excel_file": "Data.xlsx"
}
```

---

## Verifying setup

After all four files are in place:

```bash
cd scripts/filflo_bot_server
pip install -r requirements.txt
python bot_server.py
```

Should print:

```
============================================================
  FILFLO COMMAND CENTER is running  (11 bots)
  Open this in your browser:  http://127.0.0.1:8765
  (Keep this window open. Press Ctrl+C to stop.)
============================================================
```

Then either open `http://127.0.0.1:8765` directly, or run
`START_BOT_TUNNEL.bat` from the repo root to expose it via
Cloudflare so the hosted panel can reach it.

---

## What lives where

| File | In repo? | Created where? |
|---|---|---|
| `bot_server.py` | ✅ | committed |
| `filflo_combined_bot_v3.py`, `*.py` scripts | ✅ | committed |
| `requirements.txt`, `.env.example`, `README.md` | ✅ | committed |
| `.env` | ❌ gitignored | created locally per machine |
| `authorized_user.json` | ❌ gitignored | created by first OAuth flow |
| `client_secret.json` | ❌ gitignored | downloaded from Google Cloud |
| `config.json` | ❌ gitignored | copied from prior install |
| `__pycache__/`, `.chrome-headless-profile/` | ❌ gitignored | runtime |
| `Data.xlsx`, `Order-wise.csv`, `POD_FILES/`, `google_sheet_backups/` | ❌ gitignored | data |
