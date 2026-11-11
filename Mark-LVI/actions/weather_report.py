import json
import webbrowser
from urllib.request import Request, urlopen
from urllib.parse import quote_plus


# ── Live weather fetch (open-meteo.com, no API key) ──────────────────────────
# Used by the startup briefing. The `weather_action` tool above stays as it is
# (it opens the browser); this helper only returns a one-line summary.

_WMO_DESCRIPTIONS = {
    0:  "clear sky",
    1:  "mainly clear",
    2:  "partly cloudy",
    3:  "overcast",
    45: "fog",
    48: "icy fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    56: "light freezing drizzle",
    57: "freezing drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light rain showers",
    81: "rain showers",
    82: "violent rain showers",
    85: "light snow showers",
    86: "snow showers",
    95: "thunderstorm",
    96: "thunderstorm with light hail",
    99: "thunderstorm with hail",
}


def _get_json(url: str, timeout: float = 6.0) -> dict:
    req = Request(url, headers={"User-Agent": "MarkLVI/1.0 (weather briefing)"})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_weather_sync(city: str) -> str:
    """One-line weather summary for `city` (English, data-only) for the briefing prompt."""
    try:
        geo = _get_json(
            f"https://geocoding-api.open-meteo.com/v1/search?name={quote_plus(city)}&count=1"
        )
        results = geo.get("results") or []
        if not results:
            return f"Weather unavailable: city '{city}' not found"

        lat = results[0]["latitude"]
        lon = results[0]["longitude"]
        name = results[0].get("name", city)
        country = results[0].get("country", "")
        where = f"{name}, {country}" if country else name

        w = _get_json(
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,apparent_temperature,weather_code"
            f"&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1"
        )
        cur = w.get("current", {})
        daily = w.get("daily", {})
        temp = cur.get("temperature_2m")
        feels = cur.get("apparent_temperature")
        desc = _WMO_DESCRIPTIONS.get(cur.get("weather_code"), "unknown conditions")
        hi = (daily.get("temperature_2m_max") or [None])[0]
        lo = (daily.get("temperature_2m_min") or [None])[0]

        parts = [f"Location: {where}. Now {temp}°C, {desc}"]
        if feels is not None:
            parts.append(f"feels like {feels}°C")
        if hi is not None and lo is not None:
            parts.append(f"today's high {hi}°C / low {lo}°C")
        return "; ".join(parts)
    except Exception as e:
        return f"Weather unavailable: {e}"


def weather_action(
    parameters: dict,
    player=None,
    session_memory=None,
) -> str:
    city     = parameters.get("city")
    when     = parameters.get("time", "today")  

    if not city or not isinstance(city, str) or not city.strip():
        msg = "Sir, the city is missing for the weather report."
        _log(msg, player)
        return msg

    city = city.strip()
    when = (when or "today").strip()

    search_query  = f"weather in {city} {when}"
    url           = f"https://www.google.com/search?q={quote_plus(search_query)}"

    try:
        opened = webbrowser.open(url)
        if not opened:
            raise RuntimeError("webbrowser.open returned False")
    except Exception as e:
        msg = f"Sir, I couldn't open the browser for the weather report: {e}"
        _log(msg, player)
        return msg

    msg = f"Showing the weather for {city}, {when}, sir."
    _log(msg, player)

    if session_memory:
        try:
            session_memory.set_last_search(query=search_query, response=msg)
        except Exception:
            pass

    return msg


def _log(message: str, player=None) -> None:
    print(f"[Weather] {message}")
    if player:
        try:
            player.write_log(f"JARVIS: {message}")
        except Exception:
            pass


# ── Tool declaration (auto-discovered by core/action_loader.py) ──────────────
TOOL = {
    "name": "weather_report",
    "description": "Gives the weather report to user",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "city": {
                "type": "STRING",
                "description": "City name"
            }
        },
        "required": [
            "city"
        ]
    },
    "handler": weather_action,
}
