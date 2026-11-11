"""
bridge_server.py — OpenCode <-> JARVIS Bridge Server (FastAPI).

Run this separately from JARVIS (Mark-LVI). It exposes the REST + WebSocket
endpoints that the opencode_bridge plugin calls.

Endpoints:
  GET  /api/v1/opencode/status
  POST /api/v1/opencode/tasks
  GET  /api/v1/opencode/tasks/{task_id}
  POST /api/v1/opencode/tasks/{task_id}/cancel
  WS   /ws/v1/opencode/events

Usage:
    python bridge_server.py              # start on http://127.0.0.1:8000
    python bridge_server.py --port 8001  # custom port

Authentication:
  - Authorization: Bearer <BRIDGE_SECRET>
  - X-Bridge-Timestamp + X-Bridge-Signature (HMAC-SHA256)

The server simulates coding-task progress by default so the bridge works out of
the box. Replace _run_task_worker() with real OpenCode execution when you have
an agent to connect.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="[BridgeServer] %(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("BridgeServer")

app = FastAPI(title="JARVIS <-> OpenCode Bridge", version="1.0.0")

# ─────────────────────────────────────────────────────────────────────────────
# Configuration (override via CLI flags or environment if you wish)
# ─────────────────────────────────────────────────────────────────────────────

BRIDGE_SECRET = "jarvis_opencode_secret_key_v1"   # Bearer token
HMAC_SECRET = "mark_lvi_secure_hmac_secret"       # HMAC shared secret
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class TaskRequest(BaseModel):
    task_id: str
    instruction: str
    target_dir: str = "./"
    files: List[str] = field(default_factory=list)
    context_memory: Dict[str, Any] = field(default_factory=dict)
    timeout_seconds: int = 120


class TaskResponse(BaseModel):
    task_id: str
    status: str
    summary: str
    modified_files: List[str] = field(default_factory=list)
    execution_time_sec: float = 0.0
    error_message: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# In-memory state
# ─────────────────────────────────────────────────────────────────────────────

_tasks: Dict[str, dict] = {}
_tasks_lock = threading.Lock()

_ws_connections: Dict[str, Set[WebSocket]] = {}
_ws_lock = threading.Lock()

_main_loop: Optional[asyncio.AbstractEventLoop] = None


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def _remove_ws(task_id: str, ws: WebSocket) -> None:
    with _ws_lock:
        conns = _ws_connections.get(task_id)
        if conns:
            conns.discard(ws)
            if not conns:
                _ws_connections.pop(task_id, None)


def _broadcast(task_id: str, event_type: str, payload: dict) -> None:
    """Send an event to all WebSocket subscribers of a task (thread-safe)."""
    with _ws_lock:
        conns = list(_ws_connections.get(task_id, set()))
    if not conns or _main_loop is None:
        return

    message = json.dumps({
        "event_type": event_type,
        "payload": payload,
        "timestamp": time.time(),
    })

    async def _send() -> None:
        dead: List[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _remove_ws(task_id, ws)

    asyncio.run_coroutine_threadsafe(_send(), _main_loop)


# ─────────────────────────────────────────────────────────────────────────────
# Auth helpers
# ─────────────────────────────────────────────────────────────────────────────

def verify_hmac(payload_str: str, timestamp: int, signature: str) -> bool:
    if not HMAC_SECRET:
        return True
    expected = hmac.new(
        HMAC_SECRET.encode("utf-8"),
        f"{timestamp}:{payload_str}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def auth_required(authorization: Optional[str]) -> bool:
    if not authorization:
        return False
    parts = authorization.split()
    return len(parts) == 2 and parts[0].lower() == "bearer" and parts[1] == BRIDGE_SECRET


# ─────────────────────────────────────────────────────────────────────────────
# Task worker (simulated — replace with real OpenCode execution)
# ─────────────────────────────────────────────────────────────────────────────

def _run_task_worker(task_id: str) -> None:
    """Simulate a coding task and stream progress via WebSocket."""
    with _tasks_lock:
        task = _tasks.get(task_id)
        if not task:
            return

    steps = [
        ("Parsing task context", 20),
        ("Analyzing project files", 40),
        ("Applying changes", 70),
        ("Running code checks", 90),
    ]
    start = time.time()

    try:
        for step, pct in steps:
            time.sleep(1.0)  # simulate work
            with _tasks_lock:
                if task_id not in _tasks:
                    return  # cancelled
                t = _tasks[task_id]
                t["status"] = "running"
                t["progress"] = pct
                t["step"] = step
                t.setdefault("logs", []).append(f"Completed: {step}")

            _broadcast(task_id, "code_progress", {
                "task_id": task_id,
                "status": "running",
                "step_description": step,
                "pct_complete": float(pct),
                "logs": [f"Completed: {step}"],
            })

        exec_duration = time.time() - start
        with _tasks_lock:
            t = _tasks[task_id]
            t["status"] = "success"
            t["progress"] = 100.0
            t["summary"] = f"Successfully executed: {t['instruction']}"
            t["execution_time_sec"] = round(exec_duration, 2)
            t["modified_files"] = t.get("files", []) or ["src/main.py"]

        _broadcast(task_id, "task_completed", {
            "task_id": task_id,
            "status": "success",
            "summary": t["summary"],
            "modified_files": t["modified_files"],
            "execution_time_sec": t["execution_time_sec"],
        })
        logger.info(f"Task {task_id} completed in {exec_duration:.2f}s")

    except Exception as e:
        exec_duration = time.time() - start
        with _tasks_lock:
            if task_id in _tasks:
                _tasks[task_id]["status"] = "failure"
                _tasks[task_id]["error_message"] = str(e)
                _tasks[task_id]["execution_time_sec"] = round(exec_duration, 2)

        _broadcast(task_id, "task_completed", {
            "task_id": task_id,
            "status": "failure",
            "summary": "Task failed",
            "error_message": str(e),
        })
        logger.exception(f"Task {task_id} failed")


# ─────────────────────────────────────────────────────────────────────────────
# REST endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/v1/opencode/status")
async def status_endpoint(
    authorization: Optional[str] = None,
):
    if not auth_required(authorization):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    with _tasks_lock:
        active = len(_tasks)
    return JSONResponse({
        "status": "online",
        "agent_ready": True,
        "active_tasks_count": active,
        "version": "1.0.0-Mark-LVI",
    })


@app.post("/api/v1/opencode/tasks")
async def create_task(
    req: TaskRequest,
    authorization: Optional[str] = None,
    x_bridge_timestamp: Optional[str] = None,
    x_bridge_signature: Optional[str] = None,
):
    if not auth_required(authorization):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    payload_str = req.model_dump_json()
    if x_bridge_timestamp and x_bridge_signature:
        try:
            ts = int(x_bridge_timestamp)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid timestamp")
        if not verify_hmac(payload_str, ts, x_bridge_signature):
            raise HTTPException(status_code=401, detail="Invalid signature")

    task_id = req.task_id or f"job_{uuid.uuid4().hex[:8]}"
    now = time.time()

    with _tasks_lock:
        _tasks[task_id] = {
            "task_id": task_id,
            "status": "queued",
            "instruction": req.instruction,
            "target_dir": req.target_dir,
            "files": req.files,
            "context_memory": req.context_memory,
            "timeout_seconds": req.timeout_seconds,
            "progress": 0.0,
            "step": "queued",
            "logs": [f"Task {task_id} queued"],
            "summary": "",
            "modified_files": [],
            "execution_time_sec": 0.0,
            "error_message": None,
            "created_at": now,
        }

    # Start worker thread
    threading.Thread(target=_run_task_worker, args=(task_id,), daemon=True).start()

    _broadcast(task_id, "task_started", {
        "task_id": task_id,
        "instruction": req.instruction,
        "step_description": "Task initialized",
        "pct_complete": 0.0,
    })

    return JSONResponse({"task_id": task_id, "status": "accepted"}, status_code=202)


@app.get("/api/v1/opencode/tasks/{task_id}")
async def get_task(task_id: str, authorization: Optional[str] = None):
    if not auth_required(authorization):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    with _tasks_lock:
        t = _tasks.get(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    out = dict(t)
    out.pop("instruction", None)  # keep instruction out of the status poll? No — include it.
    return JSONResponse(out)


@app.post("/api/v1/opencode/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, authorization: Optional[str] = None):
    if not auth_required(authorization):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    with _tasks_lock:
        if task_id not in _tasks:
            raise HTTPException(status_code=404, detail="Task not found")
        _tasks[task_id]["status"] = "cancelled"
    _broadcast(task_id, "task_completed", {
        "task_id": task_id,
        "status": "cancelled",
        "summary": "Task cancelled by user",
    })
    return JSONResponse({"task_id": task_id, "status": "cancelled"})


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket
# ─────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/v1/opencode/events")
async def events_ws(websocket: WebSocket, task_id: Optional[str] = None):
    await websocket.accept()
    if task_id:
        with _ws_lock:
            _ws_connections.setdefault(task_id, set()).add(websocket)
    try:
        while True:
            # Keep connection open; client may send ping or just stay idle.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if task_id:
            _remove_ws(task_id, websocket)


# ─────────────────────────────────────────────────────────────────────────────
# Startup / shutdown
# ─────────────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def _startup():
    set_main_loop(asyncio.get_running_loop())
    logger.info(f"Bridge server listening on {DEFAULT_HOST}:{DEFAULT_PORT}")


def main() -> None:
    parser = argparse.ArgumentParser(description="JARVIS <-> OpenCode Bridge Server")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Bind host")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Bind port")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
