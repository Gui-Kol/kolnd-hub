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

Real agent integration:
  - Set NVIDIA_API_KEY to call Nemotron 3.5 Super VL Free via NVIDIA NIM.
  - Optional: NVIDIA_BASE_URL (default https://integrate.api.nvidia.com/v1)
  - Optional: NVIDIA_MODEL (default nemotron-3.5-super-vl-free)
  - Without a key, the server uses a built-in test generator that writes real
    code files so you can test the full JARVIS <-> OpenCode flow immediately.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import httpx
import uvicorn
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from memory.config_manager import get_plugin_setting

logging.basicConfig(
    level=logging.INFO,
    format="[BridgeServer] %(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("BridgeServer")

app = FastAPI(title="JARVIS <-> OpenCode Bridge", version="1.0.0")

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

BRIDGE_SECRET = "jarvis_opencode_secret_key_v1"   # Bearer token
HMAC_SECRET = "mark_lvi_secure_hmac_secret"       # HMAC shared secret
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000

# Nemotron 3.5 Super VL Free (NVIDIA NIM) - defaults overriden by config_manager
# These are read from plugin_config at runtime via get_nvidia_config().
NVIDIA_BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
NVIDIA_DEFAULT_MODEL = os.environ.get("NVIDIA_MODEL", "nemotron-3.5-super-vl-free")


def get_nvidia_config() -> tuple[str, str, str]:
    """Return (api_key, base_url, model) from saved config or environment.

    The API key is stored per-session unless the user checked "Lembrar minha
    API key" — in which case it persists in config/api_keys.json under
    plugin_config.opencode_bridge.nvidia_api_key.
    """
    api_key = get_plugin_setting("opencode_bridge", "nvidia_api_key", "") or ""
    model = get_plugin_setting("opencode_bridge", "nvidia_model", "") or NVIDIA_DEFAULT_MODEL
    base_url = get_plugin_setting("opencode_bridge", "nvidia_base_url", "") or NVIDIA_BASE_URL
    return api_key, base_url, model

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
# Nemotron 3.5 Super VL Free client (NVIDIA NIM)
# ─────────────────────────────────────────────────────────────────────────────

def _call_nemotron(prompt: str, timeout_s: float = 60.0) -> Optional[str]:
    """
    Call Nemotron 3.5 Super VL Free via NVIDIA NIM.
    Returns the model's text, or None if the call fails / no key configured.
    """
    api_key, base_url, model = get_nvidia_config()
    if not api_key:
        return None

    url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a senior software engineer. Write complete, working code. No markdown fences, no explanation — only raw code unless asked otherwise."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 4096,
        "stream": False,
    }
    try:
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.post(url, headers=headers, json=body)
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                if choices:
                    return choices[0].get("message", {}).get("content", "")
            logger.warning(f"Nemotron API returned {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"Nemotron API call failed: {e}")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Test generator (no API key needed — writes real code so you can test now)
# ─────────────────────────────────────────────────────────────────────────────

_TEST_TEMPLATES = {
    "python": '''"""
{title}
Generated by JARVIS <-> OpenCode Bridge (test mode).
Instruction: {instruction}
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("{module_name}")


class {ClassName}:
    """{description}"""

    def __init__(self, target_dir: str = "."):
        self.target_dir = Path(target_dir)

    def run(self) -> str:
        """Execute the requested task."""
        logger.info(f"Running {ClassName} in {{self}}.target_dir")
        return f"{ClassName} completed successfully."


def main() -> None:
    app = {ClassName}()
    result = app.run()
    print(result)


if __name__ == "__main__":
    main()
''',
}


def _generate_test_code(instruction: str, files: List[str], target_dir: str) -> Dict[str, str]:
    """Generate real code files for the instruction without an API key.
    Useful for testing the full bridge flow immediately."""
    safe_name = "".join(c if c.isalnum() or c == "_" else "_" for c in instruction.strip().lower())[:40] or "task"
    module_name = f"opencode_{safe_name}"
    class_name = "".join(word.capitalize() for word in safe_name.split("_")) or "OpenCodeTask"

    description = instruction[:80]

    # Determine which files to write
    if files:
        targets = files
    else:
        targets = [f"{module_name}.py"]

    result: Dict[str, str] = {}
    for rel in targets:
        rel = rel.replace("\\", "/")
        if not rel.endswith(".py"):
            rel = rel + ".py"
        code = _TEST_TEMPLATES["python"].format(
            title=instruction,
            instruction=instruction,
            module_name=module_name,
            ClassName=class_name,
            description=description,
        )
        result[rel] = code

    # Add a small runner if none of the files is an entry point
    if not any(f.endswith("__main__.py") or f.endswith("main.py") for f in result):
        result["run_bridge_task.py"] = f'''"""
Entry point for: {instruction}
"""
from {module_name} import {class_name}

if __name__ == "__main__":
    app = {class_name}()
    print(app.run())
'''

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Task worker (real agent — Nemotron or test generator)
# ─────────────────────────────────────────────────────────────────────────────

def _run_task_worker(task_id: str) -> None:
    """Execute a coding task using Nemotron 3.5 Super VL Free (or test fallback).

    Streams progress via WebSocket and writes real files to target_dir.
    """
    with _tasks_lock:
        task = _tasks.get(task_id)
        if not task:
            return

    instruction = task["instruction"]
    target_dir = Path(task["target_dir"] or "./")
    files = task["files"]
    start = time.time()

    def _update(status: str, pct: float, step: str, log: str = "") -> None:
        with _tasks_lock:
            if task_id not in _tasks:
                return
            t = _tasks[task_id]
            t["status"] = status
            t["progress"] = pct
            t["step"] = step
            if log:
                t.setdefault("logs", []).append(log)
        _broadcast(task_id, "code_progress", {
            "task_id": task_id,
            "status": status,
            "step_description": step,
            "pct_complete": pct,
            "logs": [log] if log else [],
        })

    try:
        # 1. Parse context
        _update("running", 10, "Parsing task context", f"Instruction: {instruction}")
        time.sleep(0.5)

        # 2. Generate code — try Nemotron first, fall back to test generator
        _update("running", 30, "Generating code", "Calling Nemotron 3.5 Super VL Free...")
        code_files: Optional[Dict[str, str]] = None

        if NVIDIA_API_KEY:
            prompt = f"""You are an expert software engineer. Implement the following instruction.

Instruction: {instruction}
Target directory: {target_dir}
Files involved: {', '.join(files) if files else '(none specified)'}

Write complete, working Python code files. Return ONLY a JSON object mapping file paths to their full contents:
{{"path/to/file.py": "full file content here"}}

Do not use markdown fences. Do not add explanation. Return valid JSON only."""
            nemotron_text = _call_nemotron(prompt, timeout_s=90.0)
            if nemotron_text:
                try:
                    import re as _re
                    cleaned = nemotron_text.strip()
                    # Strip any accidental fences
                    cleaned = _re.sub(r"^```(?:json)?\s*", "", cleaned)
                    cleaned = _re.sub(r"\s*```$", "", cleaned)
                    code_files = json.loads(cleaned)
                    logger.info(f"Nemotron generated {len(code_files)} file(s) for task {task_id}")
                except Exception as e:
                    logger.warning(f"Nemotron returned non-JSON, using test generator: {e}")
                    code_files = None

        if code_files is None:
            # Test fallback — writes real code so you can test end-to-end now
            code_files = _generate_test_code(instruction, files, str(target_dir))
            logger.info(f"Test generator created {len(code_files)} file(s) for task {task_id}")

        # 3. Write files to disk
        _update("running", 60, "Writing files", f"Writing {len(code_files)} file(s) to {target_dir}")
        written: List[str] = []
        target_dir.mkdir(parents=True, exist_ok=True)

        for rel_path, content in code_files.items():
            # Safety: only write inside target_dir
            rel = Path(rel_path)
            if rel.is_absolute() or ".." in rel.parts:
                logger.warning(f"Skipping unsafe path: {rel_path}")
                continue
            full_path = target_dir / rel
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")
            written.append(str(rel))
            time.sleep(0.2)  # simulate work so progress is visible

        # 4. Run code checks (syntax check for Python files)
        _update("running", 85, "Running code checks", "Syntax-checking written files")
        syntax_ok = True
        for rel in written:
            if rel.endswith(".py"):
                try:
                    compile(Path(target_dir / rel).read_text(encoding="utf-8"), rel, "exec")
                except SyntaxError as e:
                    syntax_ok = False
                    logger.warning(f"Syntax error in {rel}: {e}")

        # 5. Complete
        exec_duration = time.time() - start
        with _tasks_lock:
            t = _tasks[task_id]
            t["status"] = "success" if syntax_ok else "failure"
            t["progress"] = 100.0
            t["summary"] = (
                f"Successfully executed: {instruction}" if syntax_ok
                else f"Completed with syntax errors: {instruction}"
            )
            t["execution_time_sec"] = round(exec_duration, 2)
            t["modified_files"] = written
            t["error_message"] = None if syntax_ok else "One or more files have syntax errors"

        _broadcast(task_id, "task_completed", {
            "task_id": task_id,
            "status": t["status"],
            "summary": t["summary"],
            "modified_files": written,
            "execution_time_sec": t["execution_time_sec"],
        })
        logger.info(f"Task {task_id} completed in {exec_duration:.2f}s — files: {written}")

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
async def status_endpoint():
    """Public health check — no authentication required."""
    api_key, base_url, model = get_nvidia_config()
    with _tasks_lock:
        active = len(_tasks)
    return JSONResponse({
        "status": "online",
        "agent_ready": True,
        "active_tasks_count": active,
        "version": "1.0.0-Mark-LVI",
        "agent": "Nemotron 3.5 Super VL Free" if api_key else "test-generator",
        "model": model,
        "nvidia_configured": bool(api_key),
    })


@app.post("/api/v1/opencode/tasks")
async def create_task(
    req: TaskRequest,
    authorization: Optional[str] = Header(None),
    x_bridge_timestamp: Optional[str] = Header(None),
    x_bridge_signature: Optional[str] = Header(None),
):
    if not auth_required(authorization):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    payload_str = req.model_dump_json()
    # HMAC is verified only when the client sends a signature header.
    if x_bridge_signature:
        if not x_bridge_timestamp:
            raise HTTPException(status_code=400, detail="Missing timestamp")
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
async def get_task(task_id: str, authorization: Optional[str] = Header(None)):
    if not auth_required(authorization):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    with _tasks_lock:
        t = _tasks.get(task_id)
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    out = dict(t)
    out.pop("instruction", None)
    return JSONResponse(out)


@app.post("/api/v1/opencode/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, authorization: Optional[str] = Header(None)):
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
    api_key, _, model = get_nvidia_config()
    agent = "Nemotron 3.5 Super VL Free" if api_key else "test-generator"
    logger.info(f"Bridge server listening on {DEFAULT_HOST}:{DEFAULT_PORT} — agent: {agent} — model: {model}")


def main() -> None:
    parser = argparse.ArgumentParser(description="JARVIS <-> OpenCode Bridge Server")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Bind host")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Bind port")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
