# Google Calendar setup (startup briefing + voice commands)

The briefing reads **today's** events from your primary Google Calendar and
tells you about them when JARVIS starts. JARVIS can only read the calendar —
it cannot create or edit events.

## One-time setup

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → External → fill in the app
   name (e.g. "Mark LVI") and your email. Add your own Google account as a
   **test user** (required while the app stays in "Testing" mode).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   application type **Desktop app**.
5. Download the JSON and save it as:

   ```
   Mark-LVI\config\client_secret.json
   ```

6. Say to JARVIS (or type): **"conectar meu Google Agenda"** — the browser
   opens, you grant read-only access, and the token is cached at
   `config\token_calendar.json`.

Both files are gitignored (`client_secret*.json`, `token*.json`) — they never
get committed.

## Using it

- Every time JARVIS starts, the briefing greets you (Bom dia / Boa tarde /
  Boa noite), tells you the current temperature for your city and what (if
  anything) is on your agenda today. If there is nothing, it says so.
- Ask any time: **"o que tenho na agenda hoje?"**
- **"desconectar meu Google Agenda"** removes the cached token.

## Your city for the weather

JARVIS asks which city you are from the first time it starts without knowing.
Answer once — it saves it to long-term memory (`identity/city`) and never asks
again. You can see and delete it any time in the **Memory** tab
(the trash icon next to the entry).

## If something goes wrong

- "Google Calendar is not connected" → redo step 6.
- Token expired and can't refresh → delete `config\token_calendar.json` and
  ask to connect again.
- The briefing works even with no internet and no calendar configured: it
  just tells you what is missing, once, and never blocks startup.
