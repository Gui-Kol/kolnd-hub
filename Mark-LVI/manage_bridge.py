"""
manage_bridge.py — Start / stop / status for the OpenCode <-> JARVIS bridge server.

Usage:
    python manage_bridge.py start   # launch bridge_server.py in the background
    python manage_bridge.py stop    # stop the running bridge
    python manage_bridge.py status  # check if bridge is running
    python manage_bridge.py restart # stop then start

The bridge server must be running for the opencode_bridge plugin to dispatch
tasks to OpenCode. This script keeps a PID file (.bridge_pid) next to
bridge_server.py so the JARVIS plugin (or you) can manage it easily.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx

BASE_DIR = Path(__file__).resolve().parent
SERVER_SCRIPT = BASE_DIR / "bridge_server.py"
PID_FILE = BASE_DIR / ".bridge_pid"
LOG_FILE = BASE_DIR / ".bridge.log"
DEFAULT_PORT = 8000
BASE_URL = f"http://127.0.0.1:{DEFAULT_PORT}"


def _is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _read_pid() -> Optional[int]:
    if not PID_FILE.exists():
        return None
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def _write_pid(pid: int) -> None:
    PID_FILE.write_text(str(pid), encoding="utf-8")


def _clear_pid() -> None:
    try:
        PID_FILE.unlink()
    except FileNotFoundError:
        pass


def status() -> None:
    pid = _read_pid()
    if pid and _is_running(pid):
        # Also verify the HTTP endpoint answers.
        try:
            resp = httpx.get(f"{BASE_URL}/api/v1/opencode/status", timeout=3.0)
            if resp.status_code == 200:
                print(f"Bridge server is RUNNING (PID {pid}) on {BASE_URL}")
                return
        except Exception:
            pass
        print(f"Bridge server process exists (PID {pid}) but HTTP endpoint did not answer.")
    else:
        _clear_pid()
        print("Bridge server is NOT running.")


def start() -> None:
    pid = _read_pid()
    if pid and _is_running(pid):
        print(f"Bridge server already running (PID {pid}).")
        return

    if not SERVER_SCRIPT.exists():
        print(f"ERROR: {SERVER_SCRIPT} not found.")
        sys.exit(1)

    log_fh = open(LOG_FILE, "ab", buffering=0)
    proc = subprocess.Popen(
        [sys.executable, str(SERVER_SCRIPT), "--port", str(DEFAULT_PORT)],
        cwd=str(BASE_DIR),
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    _write_pid(proc.pid)
    print(f"Bridge server starting (PID {proc.pid}) on {BASE_URL} ...")

    # Wait for it to become reachable.
    for _ in range(30):
        time.sleep(0.5)
        try:
            resp = httpx.get(f"{BASE_URL}/api/v1/opencode/status", timeout=2.0)
            if resp.status_code == 200:
                print(f"Bridge server is READY on {BASE_URL}")
                return
        except Exception:
            continue
    print("Bridge server started but did not answer in time. Check .bridge.log")


def stop() -> None:
    pid = _read_pid()
    if not pid:
        print("No PID file found — bridge may not be running.")
        return
    if not _is_running(pid):
        _clear_pid()
        print("Bridge server was not running. PID file cleared.")
        return

    try:
        if os.name == "nt":
            # CTRL_BREAK_EVENT works on the process group we created.
            proc = subprocess.Popen([])  # noqa: F841 — just to keep type checkers happy
            os.kill(pid, signal.CTRL_BREAK_EVENT)
        else:
            os.kill(pid, signal.SIGTERM)
    except OSError:
        pass

    # Wait a moment for it to die.
    for _ in range(20):
        time.sleep(0.2)
        if not _is_running(pid):
            break
    else:
        try:
            os.kill(pid, signal.SIGKILL if os.name != "nt" else signal.CTRL_BREAK_EVENT)
        except OSError:
            pass

    _clear_pid()
    print(f"Bridge server (PID {pid}) stopped.")


def restart() -> None:
    stop()
    time.sleep(1.0)
    start()


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the OpenCode <-> JARVIS bridge server")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("start", help="Start the bridge server")
    sub.add_parser("stop", help="Stop the bridge server")
    sub.add_parser("status", help="Show bridge server status")
    sub.add_parser("restart", help="Restart the bridge server")
    args = parser.parse_args()

    if args.command == "start":
        start()
    elif args.command == "stop":
        stop()
    elif args.command == "status":
        status()
    elif args.command == "restart":
        restart()


if __name__ == "__main__":
    main()
