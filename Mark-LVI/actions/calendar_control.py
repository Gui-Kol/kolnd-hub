#calendar_control.py
"""Google Calendar integration for the startup briefing and voice commands.

Read-only access to the user's primary calendar. OAuth Desktop-app credentials
are expected at ``config/client_secret.json`` (from Google Cloud Console,
Desktop app type) and the authorized token is cached at
``config/token_calendar.json``. Both files are gitignored.

The briefing never opens a browser: if there is no token it reports
``connected: False``. The ``authorize`` action (user-initiated, voice command)
is the only path that opens the consent screen.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def _get_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent


BASE_DIR     = _get_base_dir()
CLIENT_SECRET = BASE_DIR / "config" / "client_secret.json"
TOKEN_PATH    = BASE_DIR / "config" / "token_calendar.json"

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]


def _load_credentials():
    """Return valid OAuth credentials, refreshing if needed. None if not authorized."""
    if not TOKEN_PATH.exists():
        return None, "not authorized"
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
        if creds.valid:
            return creds, None
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
            return creds, None
        return None, "token expired and cannot be refreshed"
    except Exception as e:
        return None, str(e)


def is_connected() -> bool:
    creds, _ = _load_credentials()
    return creds is not None


def authorize() -> str:
    """Open the browser consent flow and cache the token. User-initiated only."""
    if not CLIENT_SECRET.exists():
        return (
            f"Google Calendar is not set up yet. Download OAuth desktop-app "
            f"credentials from Google Cloud Console and save them as {CLIENT_SECRET}, "
            f"then try again."
        )
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow

        flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
        creds = flow.run_local_server(port=0, open_browser=True)
        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
        return "Google Calendar connected."
    except Exception as e:
        return f"Could not connect Google Calendar: {e}"


def disconnect() -> str:
    try:
        TOKEN_PATH.unlink()
        return "Google Calendar disconnected."
    except FileNotFoundError:
        return "Google Calendar was not connected."
    except Exception as e:
        return f"Could not disconnect: {e}"


def _format_event(ev: dict) -> str:
    start = ev.get("start", {}) or {}
    title = ev.get("summary") or "(untitled)"
    if "dateTime" in start:
        try:
            dt = datetime.fromisoformat(start["dateTime"])
            when = dt.strftime("%H:%M")
        except ValueError:
            when = start["dateTime"]
        return f"{when} - {title}"
    return f"all day - {title}"


def fetch_today_events() -> dict:
    """Today's events from the primary calendar.

    Returns {"connected": bool, "events": [str], "error": str | None}.
    Safe to call from the briefing: never opens a browser.
    """
    creds, err = _load_credentials()
    if creds is None:
        return {"connected": False, "events": [], "error": err or "not authorized"}

    try:
        from googleapiclient.discovery import build

        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        now = datetime.now().astimezone()
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1) - timedelta(seconds=1)

        resp = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=day_start.isoformat(),
                timeMax=day_end.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=20,
            )
            .execute()
        )
        events = [_format_event(ev) for ev in resp.get("items", [])]
        return {"connected": True, "events": events, "error": None}
    except Exception as e:
        return {"connected": True, "events": [], "error": str(e)}


def calendar_action(parameters: dict, player=None, **_ctx) -> str:
    action = (parameters.get("action") or "today").strip().lower()

    if action == "authorize":
        msg = authorize()
    elif action == "status":
        msg = (
            "Google Calendar is connected."
            if is_connected()
            else "Google Calendar is not connected. Ask me to connect it."
        )
    elif action == "disconnect":
        msg = disconnect()
    elif action == "today":
        data = fetch_today_events()
        if not data["connected"]:
            msg = (
                "Google Calendar is not connected yet. If I asked to, the user can "
                "say 'connect my Google Calendar' and I will open the browser to authorize."
            )
        elif data["error"]:
            msg = f"Google Calendar error: {data['error']}"
        elif not data["events"]:
            msg = "Nothing on the agenda today."
        else:
            msg = "Today's agenda: " + "; ".join(data["events"])
    else:
        msg = f"Unknown calendar action: {action!r}. Use today, authorize, status or disconnect."

    if player:
        try:
            player.write_log(f"JARVIS: {msg}")
        except Exception:
            pass
    return msg


# ── Tool declaration (auto-discovered by core/action_loader.py) ──────────────
TOOL = {
    "name": "calendar_control",
    "description": (
        "Google Calendar access. Actions: 'today' lists today's events on the "
        "primary calendar (use when the user asks about their agenda, schedule, "
        "appointments or what they have today); 'authorize' connects Google Calendar "
        "by opening the browser for consent (use when the user asks to connect it); "
        "'status' reports whether it is connected; 'disconnect' removes the token. "
        "Read-only: cannot create or edit events."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {
                "type": "STRING",
                "description": "today | authorize | status | disconnect (default: today)",
            },
        },
        "required": ["action"],
    },
    "handler": calendar_action,
}
