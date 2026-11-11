"""
Push-to-talk — hold a key, speak, release.

Why this exists
---------------
Voice activation is hands-free but not always what you want: in a meeting, in
a noisy room, or when you simply do not feel like speaking out loud, a key
you hold is faster and never mishears. It is also the natural way to use the
assistant while another window has focus.

How it works, and what it costs
-------------------------------
Zero new dependencies, best available mechanism per platform:

* **Windows** — `GetAsyncKeyState` polled from one small thread. This is
  deliberately *not* `RegisterHotKey`, which only reports a press: push-to-talk
  needs the release too, and it needs to work while another application has
  focus. Polling two virtual-key codes 30 times a second is a rounding error of
  CPU and needs no message loop.
* **macOS / Linux** — no portable way to read global key state without pulling
  in a new package or asking for accessibility permissions, so the chord is
  bound as an application shortcut instead: it works whenever the assistant's
  window has focus. `scope` reports which of the two you got, so the UI can say
  so honestly rather than pretending.

The class never raises. If the platform hook cannot be installed it simply
reports `scope == "window"` and the Qt shortcut carries it.
"""

from __future__ import annotations

import platform
import threading
import time
from typing import Callable

_OS = platform.system()

DEFAULT_CHORD = ("ctrl", "space")

# The chord for the global mute toggle — Ctrl+Shift+M by default, rebindable
# in ⚙ → ATALHOS (persisted in config).
DEFAULT_MUTE_CHORD = ("ctrl", "shift", "m")
MUTE_CHORD = DEFAULT_MUTE_CHORD

# Modifiers recognized in a chord, in the canonical display order.
MODIFIERS = ("ctrl", "shift", "alt", "win")

# Windows virtual-key codes for every name we accept in a chord.
_VK = {
    # modifiers
    "ctrl": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B,
    # letters (stored uppercase, matched case-insensitively)
    **{chr(c): c for c in range(ord("A"), ord("Z") + 1)},
    # digits (stored as "0".."9")
    **{str(d): ord(str(d)) for d in range(10)},
    # function keys
    **{f"f{n}": 0x70 + n - 1 for n in range(1, 13)},
    # navigation and control
    "space": 0x20, "tab": 0x09, "esc": 0x1B, "enter": 0x0D, "backspace": 0x08,
    "delete": 0x2E, "insert": 0x2D, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22,
    "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
    "capslock": 0x14,
    # punctuation (OEM codes, US layout)
    "minus": 0xBD, "equals": 0xBB, "comma": 0xBC, "period": 0xBE, "slash": 0xBF,
    "semicolon": 0xBA, "quote": 0xDE, "bracketleft": 0xDB, "bracketright": 0xDD,
    "backslash": 0xDC, "grave": 0xC0,
}

# Qt key sequence text for the same names, used by the windowed fallback and
# by the shortcuts panel. Must parse as a single key in QKeySequence.
_QT_NAME = {
    "ctrl": "Ctrl", "shift": "Shift", "alt": "Alt", "win": "Meta",
    **{chr(c): chr(c) for c in range(ord("A"), ord("Z") + 1)},
    **{str(d): str(d) for d in range(10)},
    **{f"f{n}": f"F{n}" for n in range(1, 13)},
    "space": "Space", "tab": "Tab", "esc": "Esc", "enter": "Return",
    "backspace": "Backspace", "delete": "Del", "insert": "Ins",
    "home": "Home", "end": "End", "pageup": "PgUp", "pagedown": "PgDn",
    "up": "Up", "down": "Down", "left": "Left", "right": "Right",
    "capslock": "CapsLock",
    "minus": "Minus", "equals": "Equal", "comma": "Comma", "period": "Period",
    "slash": "Slash", "semicolon": "Semicolon", "quote": "Apostrophe",
    "bracketleft": "BracketLeft", "bracketright": "BracketRight",
    "backslash": "Backslash", "grave": "QuoteLeft",
}
# Match case-insensitively: store the lowercase alias of every letter too.
_VK.update({k.lower(): v for k, v in list(_VK.items()) if k.isalpha()})
_QT_NAME.update({k.lower(): v for k, v in list(_QT_NAME.items()) if k.isalpha()})


def is_modifier(name: str) -> bool:
    return name.lower() in MODIFIERS


def is_known_chord(names) -> bool:
    """True if every name is a recognised key and at least one is not a modifier."""
    names = [n.lower() for n in names]
    if not names:
        return False
    if any(n not in _VK for n in names):
        return False
    return any(n not in MODIFIERS for n in names)


def normalize_chord(names):
    """Canonical form of a chord: modifiers in fixed order, then the key.

    Returns the normalized list, or None if a name is unknown, or there is no
    non-modifier key in the chord, or there is more than one — a chord with two
    real keys is not something the global poller can express cleanly.
    """
    names = [n.lower() for n in names]
    if not names or any(n not in _VK for n in names):
        return None
    mods = [m for m in MODIFIERS if m in names]
    rest = [n for n in names if n not in MODIFIERS]
    if len(rest) != 1:
        return None
    return mods + rest

_POLL_HZ = 30.0
# A key has to be down this long before we call it speech. It stops a stray
# brush of the chord from opening the microphone.
_DEBOUNCE_S = 0.06


def chord_label(chord=DEFAULT_CHORD) -> str:
    """Human-readable name of the chord, for the UI and the logs."""
    return "+".join(_QT_NAME.get(k, k.title()) for k in chord)


def qt_sequence(chord=DEFAULT_CHORD) -> str:
    """The same chord as a QKeySequence string."""
    return "+".join(_QT_NAME.get(k, k.title()) for k in chord)


class PushToTalk:
    """Calls `on_change(held: bool)` whenever the chord is pressed or released.

    Start it once; it is safe to start and stop repeatedly, and safe to stop a
    detector that never started.
    """

    def __init__(self, on_change: Callable[[bool], None], chord=DEFAULT_CHORD):
        self._on_change = on_change
        self._chord = tuple(chord)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._held = False
        self._scope = "window"

    # ── state ───────────────────────────────────────────────────────────────

    @property
    def held(self) -> bool:
        return self._held

    @property
    def scope(self) -> str:
        """'global' once a system-wide hook is running, else 'window'."""
        return self._scope

    @property
    def label(self) -> str:
        return chord_label(self._chord)

    # ── lifecycle ───────────────────────────────────────────────────────────

    def start(self) -> str:
        """Begin watching. Returns the scope actually achieved."""
        self.stop()
        self._stop.clear()
        if _OS == "Windows" and self._can_poll():
            self._scope = "global"
            self._thread = threading.Thread(
                target=self._poll_loop, name="push-to-talk", daemon=True)
            self._thread.start()
        else:
            self._scope = "window"
        return self._scope

    def stop(self) -> None:
        self._stop.set()
        t, self._thread = self._thread, None
        if t is not None and t.is_alive():
            t.join(timeout=1.0)
        self._set_held(False)

    # ── the windowed fallback drives this directly ──────────────────────────

    def set_held(self, held: bool) -> None:
        """Feed a press/release from a Qt shortcut (non-Windows, or no hook)."""
        self._set_held(bool(held))

    # ── internals ───────────────────────────────────────────────────────────

    def _can_poll(self) -> bool:
        try:
            import ctypes
            ctypes.windll.user32.GetAsyncKeyState  # noqa: B018 — presence check
            return all(k in _VK for k in self._chord)
        except Exception:
            return False

    def _set_held(self, held: bool) -> None:
        if held == self._held:
            return
        self._held = held
        try:
            self._on_change(held)
        except Exception:
            pass          # a listener fault must never kill the watcher

    def _poll_loop(self) -> None:
        import ctypes
        user32 = ctypes.windll.user32
        codes = [_VK[k] for k in self._chord]
        period = 1.0 / _POLL_HZ
        down_since = 0.0

        while not self._stop.is_set():
            try:
                # The high bit of the return value is "currently down".
                down = all(user32.GetAsyncKeyState(c) & 0x8000 for c in codes)
            except Exception:
                break     # driver or session teardown — fall back to windowed
            now = time.monotonic()
            if down:
                if down_since == 0.0:
                    down_since = now
                elif now - down_since >= _DEBOUNCE_S:
                    self._set_held(True)
            else:
                down_since = 0.0
                self._set_held(False)
            self._stop.wait(period)

        self._set_held(False)
        self._scope = "window"


# Minimum seconds between accepted toggles — key chatter (or a key bouncing on
# release) must not flip the mute twice.
_TOGGLE_COOLDOWN = 0.4


class ChordToggle:
    """Calls `on_toggle()` once per fresh full press of a chord.

    Edge-detected: holding the chord down does nothing after the first press,
    and the rest of the keys must be released before it can fire again. Same
    delivery guarantee as PushToTalk — global on Windows via GetAsyncKeyState,
    window-scoped elsewhere (the Qt fallback is done by the UI layer).
    Never raises.
    """

    def __init__(self, on_toggle: Callable[[], None], chord=MUTE_CHORD):
        self._on_toggle = on_toggle
        self._chord = tuple(chord)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._scope = "window"

    @property
    def scope(self) -> str:
        """'global' once a system-wide hook is running, else 'window'."""
        return self._scope

    @property
    def label(self) -> str:
        return chord_label(self._chord)

    def start(self) -> str:
        """Begin watching. Returns the scope actually achieved."""
        self.stop()
        self._stop.clear()
        if _OS == "Windows" and self._can_poll():
            self._scope = "global"
            self._thread = threading.Thread(
                target=self._poll_loop, name="mute-toggle", daemon=True)
            self._thread.start()
        else:
            self._scope = "window"
        return self._scope

    def stop(self) -> None:
        self._stop.set()
        t, self._thread = self._thread, None
        if t is not None and t.is_alive():
            t.join(timeout=1.0)

    def _can_poll(self) -> bool:
        try:
            import ctypes
            ctypes.windll.user32.GetAsyncKeyState  # noqa: B018 — presence check
            return all(k in _VK for k in self._chord)
        except Exception:
            return False

    def _poll_loop(self) -> None:
        import ctypes
        user32 = ctypes.windll.user32
        codes = [_VK[k] for k in self._chord]
        period = 1.0 / _POLL_HZ
        was_down = False
        last_fire = 0.0

        while not self._stop.is_set():
            try:
                down = all(user32.GetAsyncKeyState(c) & 0x8000 for c in codes)
            except Exception:
                break         # driver or session teardown — fall back to windowed
            now = time.monotonic()
            if down and not was_down and (now - last_fire) >= _TOGGLE_COOLDOWN:
                last_fire = now
                try:
                    self._on_toggle()
                except Exception:
                    pass      # a listener fault must never kill the watcher
            was_down = down
            self._stop.wait(period)

        self._scope = "window"
