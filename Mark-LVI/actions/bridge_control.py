"""
actions/bridge_control.py — Start / stop / status the OpenCode <-> JARVIS bridge server.

Lets JARVIS manage the bridge_server.py process so the opencode_bridge plugin
can dispatch coding tasks to OpenCode. Commands are routed to manage_bridge.py,
which keeps a PID file and health-checks the HTTP endpoint.

Threading rules (AGENTS.md):
  * Runs on a worker thread. Never touches Qt widgets directly.
  * All UI output goes through player.write_log / player.show_code_job.
  * run() never raises; slow work (starting uvicorn) is quick here because the
    server is launched detached and readiness is polled briefly.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MANAGE_SCRIPT = BASE_DIR / "manage_bridge.py"
BASE_URL = "http://127.0.0.1:8000"


def _run_manage(command: str, timeout: int = 20) -> str:
    """Run manage_bridge.py <command> and return its stdout."""
    try:
        result = subprocess.run(
            [sys.executable, str(MANAGE_SCRIPT), command],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, cwd=str(BASE_DIR),
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        out = (result.stdout or "").strip()
        if result.returncode != 0:
            err = (result.stderr or "").strip()
            return f"{out} {err}".strip() or f"Command '{command}' failed."
        return out or f"Bridge {command} done."
    except subprocess.TimeoutExpired:
        return f"Bridge {command} timed out after {timeout}s."
    except Exception as e:
        return f"Bridge {command} error: {e}"


def bridge_control(action: str, player=None) -> str:
    """
    action: 'start' | 'stop' | 'status' | 'restart'
    Returns a short spoken string.
    """
    action = (action or "status").strip().lower()
    if action not in ("start", "stop", "status", "restart"):
        return "Sir, I can start, stop, restart, or show the status of the OpenCode bridge."

    if player:
        try:
            player.write_log(f"[BridgeControl] {action}...")
        except Exception:
            pass

    result = _run_manage(action)

    if player:
        try:
            player.write_log(f"[BridgeControl] {result}")
        except Exception:
            pass

    # Return a short sentence for speech.
    if action == "start":
        if "READY" in result or "RUNNING" in result:
            return "OpenCode bridge is running. You can now send coding tasks."
        return f"OpenCode bridge start attempted: {result[:120]}"
    if action == "stop":
        if "stopped" in result.lower() or "not running" in result.lower():
            return "OpenCode bridge stopped."
        return f"OpenCode bridge stop attempted: {result[:120]}"
    if action == "restart":
        return f"OpenCode bridge restarted: {result[:120]}"
    # status
    return result[:200]


# ── Tool declaration (auto-discovered by core/action_loader.py) ──────────────

TOOL = {
    "name": "bridge_control",
    "description": (
        "Start, stop, restart, or check the status of the OpenCode <-> JARVIS "
        "bridge server. The bridge must be running before JARVIS can dispatch "
        "coding tasks to OpenCode. Use 'start' when the user wants to use OpenCode, "
        "'stop' when they are done, and 'status' to check whether it is running."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "action": {
                "type": "STRING",
                "description": "start | stop | restart | status (default: status)",
            },
        },
        "required": [],
    },
    "handler": bridge_control,
}
