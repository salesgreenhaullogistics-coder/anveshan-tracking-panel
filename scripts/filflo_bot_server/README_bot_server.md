# Filflo Bot Runner — Command Center bridge

These Filflo bots are **Python/Selenium/Playwright** automations (they drive a real
browser), so they can't be triggered by a URL on their own. `bot_server.py` is a
tiny zero-dependency HTTP server that runs **on the machine where the bots live**
and exposes each bot as an endpoint the Command Center panel can call with one
click — capturing live logs and pass/fail so errors surface for rework.

## Setup (one time, on the bot machine)

1. Copy `bot_server.py` (and optionally `START_BOT_SERVER.bat`) into your
   `Filflo_Bot` folder — the same folder as `filflo_combined_bot_v3.py`.
2. Start it:
   ```
   python bot_server.py
   ```
   or double-click `START_BOT_SERVER.bat`. It listens on `http://127.0.0.1:8765`.
   (No `pip install` needed — standard library only.)
3. In the **Command Center** (panel → LRs → Command Center) click **Add Bot** for
   each bot:
   - **Run URL:** `http://127.0.0.1:8765/run`
   - **Method:** `POST`
   - **Payload:** `{"bot":"filflo_pod"}` — use the id of the bot you want
     (see `BOTS` in `bot_server.py`: `filflo_pod`, `blinkit_appt`,
     `instamart_booking`, `instamart_feeder`, `instamart_gsheet`, `scootsy_dn`,
     `data_feeder`, `pod_feeder`, `push_to_gsheet`, `cleanup_sheet`, `multi_agent`).

The panel runs the bot, polls until it finishes, then shows exit status + the last
lines of its log. Failures show red with the error tail for rework.

## Important notes

- **Same machine:** the easiest setup is to run the panel (`npm run dev`) on the
  same PC as the bots, so `127.0.0.1:8765` is reachable. The deployed
  (vercel) panel cannot reach your localhost.
- **Remote use (hosted vercel.app site):** the hosted site can't reach your
  `127.0.0.1`. Expose the bot server with a **Cloudflare tunnel**:
  1. Start `bot_server.py` (port 8765).
  2. Double-click `START_BOT_TUNNEL.bat` — it downloads `cloudflared.exe`
     (one-time) and prints a `https://….trycloudflare.com` URL.
  3. Paste that URL into the Command Center's **Bot Server** box → it shows
     **Connected**, and Run works from the hosted site.
  Note: the trycloudflare URL changes every time you restart the tunnel — paste
  the current one. (NOTE: localtunnel/`loca.lt` does NOT work here — it's blocked
  from Vercel's servers; use Cloudflare as above.)
- **Editing the bot list / arguments:** edit the `BOTS` map in `bot_server.py`.
  Add command-line args if a bot needs them, e.g.
  `"cmd": [PY, "instamart_booking_runner.py", "--today"]`.
- **Long bots:** booking/Selenium bots can take minutes — that's fine, the panel
  polls for up to 20 minutes. Quick bots return almost immediately.

## Security

- The server binds to `0.0.0.0:8765`; on a shared network, prefer running it
  bound to localhost or behind a tunnel with access control.
- The bot folder contains credentials (`.env`, `client_secret.json`,
  `authorized_user.json`). **Do not commit these or re-share the Drive zip** —
  rotate any keys that may have been exposed.
