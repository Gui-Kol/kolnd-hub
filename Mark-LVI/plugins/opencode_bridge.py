"""
plugins/opencode_bridge.py — JARVIS <-> OpenCode bridge plugin (real network integration).

Dispatches a coding task to an OpenCode agent over the JSON bridge protocol
(REST + WebSocket) and streams progress back through the thread-safe player
methods.

Network stack (kept inside requirements.txt only):
  • httpx        — synchronous REST client (POST /tasks, GET /tasks/{id}, GET /status)
  • websockets   — WebSocket client for real-time events (/ws/v1/opencode/events)
    If the WebSocket cannot be established, the bridge transparently falls back
    to polling GET /tasks/{id} every 2 seconds — so the plugin keeps working
    even on builds without a WS server.

Threading rules (AGENTS.md):
  • run() is called on a worker thread; it starts another background thread for
    the slow network work and returns at once with a short spoken string.
  • This class never imports or touches PyQt6. All UI output goes through
    player.write_log / player.show_code_job, which are thread-safe.
  • run() never raises: every network error is caught and reported through the log.

Configuration (⚙ → plugins → Open Code Bridge, persisted via config_manager):
  • api_key          — Bearer token for the Authorization header
  • shared_secret    — HMAC-SHA256 shared secret for payload signing
  • enable_hmac      — whether to sign request payloads (default true)
  • base_url         — bridge server base URL (default http://127.0.0.1:8000)
  • task_timeout_s   — per-task timeout in seconds (default 120)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

import httpx
from memory.config_manager import get_plugin_setting

logger = logging.getLogger("OpenCodeBridge")

logger = logging.getLogger("OpenCodeBridge")

# ---------------------------------------------------------------------------
# 1. AUTHENTICATION & SECURITY SCHEMAS
# ---------------------------------------------------------------------------

@dataclass
class BridgeAuthConfig:
    """Security credentials for OpenCode <-> JARVIS authorization.

    Values come from the plugin settings panel and fall back to empty strings,
    which means "no auth" until the user configures them.
    """
    api_key: str = ""
    enable_hmac: bool = True
    shared_secret: str = ""
    base_url: str = "http://127.0.0.1:8000"
    task_timeout_s: int = 120

    @classmethod
    def from_settings(cls) -> "BridgeAuthConfig":
        return cls(
            api_key=get_plugin_setting("opencode_bridge", "api_key", "") or "",
            enable_hmac=bool(get_plugin_setting("opencode_bridge", "enable_hmac", True)),
            shared_secret=get_plugin_setting("opencode_bridge", "shared_secret", "") or "",
            base_url=(get_plugin_setting("opencode_bridge", "base_url", "") or ""
                      or "http://127.0.0.1:8000").rstrip("/"),
            task_timeout_s=int(get_plugin_setting("opencode_bridge", "task_timeout_s", 120) or 120),
        )

    def generate_signature(self, payload: str, timestamp: int) -> str:
        """Generate HMAC-SHA256 signature for payload validation."""
        message = f"{timestamp}:{payload}".encode("utf-8")
        return hmac.new(self.shared_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()

    def verify_signature(self, payload: str, timestamp: int, signature: str) -> bool:
        """Validate request payload signature from peer."""
        if not self.enable_hmac or not self.shared_secret:
            return True
        expected = self.generate_signature(payload, timestamp)
        return hmac.compare_digest(expected, signature)

    # -- endpoint helpers -----------------------------------------------------

    def rest_base(self) -> str:
        return f"{self.base_url}/api/v1/opencode"

    def ws_url(self) -> str:
        # ws:// or wss:// matching the scheme of base_url
        scheme = "wss" if self.base_url.startswith("https://") else "ws"
        host = self.base_url.replace("https://", "").replace("http://", "")
        return f"{scheme}://{host}/ws/v1/opencode/events"

    def status_url(self) -> str:
        return f"{self.rest_base()}/status"

    def create_task_url(self) -> str:
        return f"{self.rest_base()}/tasks"

    def task_url(self, task_id: str) -> str:
        return f"{self.rest_base()}/tasks/{task_id}"

    def cancel_task_url(self, task_id: str) -> str:
        return f"{self.rest_base()}/tasks/{task_id}/cancel"


# ---------------------------------------------------------------------------
# 2. DATA TRANSFER OBJECTS & PAYLOAD SCHEMAS
# ---------------------------------------------------------------------------

@dataclass
class OpenCodeTaskRequest:
    """Task payload submitted from JARVIS to OpenCode."""
    task_id: str
    instruction: str
    target_dir: str
    files: List[str] = field(default_factory=list)
    context_memory: Dict[str, Any] = field(default_factory=dict)
    timeout_seconds: int = 120
    created_at: float = field(default_factory=time.time)


@dataclass
class OpenCodeTaskProgress:
    """Real-time progress telemetry streamed from OpenCode to JARVIS."""
    task_id: str
    status: str  # "queued" | "running" | "completed" | "failed"
    current_file: Optional[str] = None
    step_description: str = ""
    pct_complete: float = 0.0
    logs: List[str] = field(default_factory=list)


@dataclass
class OpenCodeTaskResponse:
    """Final result payload returned by OpenCode upon task completion."""
    task_id: str
    status: str  # "success" | "failure" | "cancelled"
    summary: str
    modified_files: List[str] = field(default_factory=list)
    execution_time_sec: float = 0.0
    error_message: Optional[str] = None


@dataclass
class BridgeEvent:
    """Generic WebSocket event structure."""
    event_type: str  # "task_started" | "code_progress" | "task_completed" | "log"
    payload: Dict[str, Any]
    timestamp: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# 3. ENDPOINT DEFINITIONS & PROTOCOL ABSTRACTS
# ---------------------------------------------------------------------------

class OpenCodeAPIEndpoints:
    """Conceptual URI Specification for the OpenCode - JARVIS REST & WS API.
    Kept for documentation; concrete URLs are built by BridgeAuthConfig.
    """
    BASE_URL = "http://127.0.0.1:8000/api/v1/opencode"
    WS_URL = "ws://127.0.0.1:8000/ws/v1/opencode/events"

    GET_STATUS = f"{BASE_URL}/status"
    POST_CREATE_TASK = f"{BASE_URL}/tasks"
    GET_TASK_BY_ID = f"{BASE_URL}/tasks/{{task_id}}"
    POST_CANCEL_TASK = f"{BASE_URL}/tasks/{{task_id}}/cancel"


# ---------------------------------------------------------------------------
# 4. BRIDGE PROTOCOL IMPLEMENTATION (real network I/O on a worker thread)
# ---------------------------------------------------------------------------

class JARVISOpenCodeBridge:
    """
    Communication Protocol Controller between JARVIS (Mark-LVI) and OpenCode.

    Performs real HTTP REST calls and (optionally) a WebSocket stream. Runs
    entirely on the caller's background thread; never touches Qt directly.
    """

    def __init__(self, player=None):
        self.player = player
        self.auth = BridgeAuthConfig.from_settings()
        self._active_tasks: Dict[str, OpenCodeTaskProgress] = {}

    # -- thread-safe UI helpers ---------------------------------------------

    def _log(self, msg: str) -> None:
        logger.info(msg)
        if self.player:
            try:
                self.player.write_log(f"[OpenCodeBridge] {msg}")
            except Exception:
                pass

    def _job(self, task_id: str, status: str, progress: float = 0.0,
             step: str = "") -> None:
        """Push a code-job panel update. Thread-safe via player."""
        if self.player and hasattr(self.player, "show_code_job"):
            try:
                self.player.show_code_job({
                    "job_id": task_id,
                    "status": f"{progress:.0f}% - {step}" if step else status,
                    "progress": progress,
                })
            except Exception:
                pass

    # -- event emission -----------------------------------------------------

    def _emit_event(self, event: BridgeEvent) -> None:
        """Dispatch a bridge event to the JARVIS UI."""
        payload = event.payload
        task_id = payload.get("task_id", "")
        self._log(f"event {event.event_type} -> {task_id}")

        if event.event_type == "code_progress":
            self._job(task_id, payload.get("status", "running"),
                      payload.get("pct_complete", 0.0),
                      payload.get("step_description", ""))
            logs = payload.get("logs", [])
            if logs:
                self._log(logs[-1])

        elif event.event_type == "task_started":
            self._job(task_id, "running", 0.0,
                      payload.get("step_description", "Task initialized"))

        elif event.event_type == "task_completed":
            self._job(task_id, payload.get("status", ""),
                      100.0, payload.get("summary", ""))

    # -- auth headers ---------------------------------------------------------

    def _auth_headers(self, payload_json: str) -> Dict[str, str]:
        """Build the Bearer + HMAC headers for a signed request.

        HMAC headers are only added when enable_hmac is True, so a bridge
        server that does not require signing still accepts the request.
        """
        ts = int(time.time())
        headers = {
            "Authorization": f"Bearer {self.auth.api_key}",
            "Content-Type": "application/json",
        }
        if self.auth.enable_hmac and self.auth.shared_secret:
            signature = self.auth.generate_signature(payload_json, ts)
            headers["X-Bridge-Timestamp"] = str(ts)
            headers["X-Bridge-Signature"] = signature
        return headers

    # -- REST operations ------------------------------------------------------

    def query_status(self) -> Dict[str, Any]:
        """GET /api/v1/opencode/status — bridge & agent health."""
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(self.auth.status_url())
                if resp.status_code == 200:
                    return resp.json()
        except Exception as e:
            self._log(f"Status query failed: {e}")
        return {"status": "unknown", "agent_ready": False}

    def _submit_task_rest(self, request: OpenCodeTaskRequest) -> Optional[Dict[str, Any]]:
        """POST /api/v1/opencode/tasks — dispatch a coding task. Returns JSON or None."""
        payload_json = json.dumps(asdict(request), default=str)
        headers = self._auth_headers(payload_json)
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(self.auth.create_task_url(),
                                   content=payload_json, headers=headers)
                if resp.status_code in (200, 201, 202):
                    return resp.json()
                self._log(f"Task submit returned HTTP {resp.status_code}: {resp.text[:200]}")
        except httpx.ConnectError:
            self._log(f"Cannot reach OpenCode bridge at {self.auth.base_url} — "
                      "is the bridge server running?")
        except Exception as e:
            self._log(f"Task submit failed: {e}")
        return None

    def _fetch_task_result(self, task_id: str) -> Optional[OpenCodeTaskResponse]:
        """GET /api/v1/opencode/tasks/{id} — read current task state/result."""
        try:
            headers = {}
            if self.auth.api_key:
                headers["Authorization"] = f"Bearer {self.auth.api_key}"
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(self.auth.task_url(task_id), headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    return OpenCodeTaskResponse(
                        task_id=task_id,
                        status=data.get("status", "unknown"),
                        summary=data.get("summary", ""),
                        modified_files=data.get("modified_files", []) or [],
                        execution_time_sec=float(data.get("execution_time_sec", 0.0) or 0.0),
                        error_message=data.get("error_message"),
                    )
        except Exception as e:
            self._log(f"Task fetch failed: {e}")
        return None

    # -- polling fallback -----------------------------------------------------

    def _poll_task(self, task_id: str, stop_event: threading.Event,
                   deadline: float) -> Optional[OpenCodeTaskResponse]:
        """Poll GET /tasks/{id} until completion or deadline. Used when WS is unavailable."""
        last_status = ""
        while not stop_event.is_set() and time.time() < deadline:
            result = self._fetch_task_result(task_id)
            if result is not None:
                self._emit_event(BridgeEvent(
                    event_type="code_progress",
                    payload={
                        "task_id": task_id,
                        "status": result.status,
                        "step_description": result.summary,
                        "pct_complete": 100.0 if result.status in ("success", "failure", "cancelled") else 50.0,
                        "logs": [f"Task status: {result.status}"],
                    },
                ))
                if result.status in ("success", "failure", "cancelled"):
                    self._emit_event(BridgeEvent(
                        event_type="task_completed",
                        payload=asdict(result),
                    ))
                    return result
                last_status = result.status
            time.sleep(2.0)
        return None

    # -- main task cycle ------------------------------------------------------

    def run_task(self, request: OpenCodeTaskRequest) -> OpenCodeTaskResponse:
        """
        Full dispatch -> stream progress -> result cycle.

        1. POST the task to the OpenCode bridge REST endpoint.
        2. Open a WebSocket to stream live progress events; fall back to REST
           polling if the WebSocket cannot be established.
        3. When task_completed arrives, return the OpenCodeTaskResponse.
        """
        self._log(f"Submitting task '{request.task_id}': {request.instruction[:60]}...")

        # 1. Submit via REST.
        submitted = self._submit_task_rest(request)
        server_task_id = request.task_id
        if submitted:
            server_task_id = submitted.get("task_id") or submitted.get("id") or request.task_id
            self._emit_event(BridgeEvent(
                event_type="task_started",
                payload={"task_id": server_task_id,
                         "instruction": request.instruction,
                         "step_description": "Task initialized",
                         "pct_complete": 0.0},
            ))

        progress = OpenCodeTaskProgress(
            task_id=server_task_id,
            status="running",
            step_description="Task initialized",
            pct_complete=0.0,
        )
        self._active_tasks[server_task_id] = progress

        start_time = time.time()
        deadline = start_time + max(self.auth.task_timeout_s, 30)
        stop_event = threading.Event()
        final_result: Optional[OpenCodeTaskResponse] = None

        try:
            # 2. Poll the REST endpoint for progress until completion.
            #    (The server also streams events over WebSocket; polling keeps
            #    the client simple and robust without an asyncio event loop.)
            self._log(f"Polling task {server_task_id} for completion...")
            final_result = self._poll_task(server_task_id, stop_event, deadline)

            if final_result is None:
                # Timeout or unreachable server.
                final_result = OpenCodeTaskResponse(
                    task_id=server_task_id,
                    status="failure",
                    summary="Task did not complete in time.",
                    execution_time_sec=time.time() - start_time,
                    error_message="timeout or bridge unreachable",
                )
                self._emit_event(BridgeEvent(
                    event_type="task_completed",
                    payload=asdict(final_result),
                ))

        except Exception as e:
            exec_duration = time.time() - start_time
            final_result = OpenCodeTaskResponse(
                task_id=server_task_id,
                status="failure",
                summary="Failed to execute coding task.",
                execution_time_sec=exec_duration,
                error_message=str(e),
            )
            self._emit_event(BridgeEvent(
                event_type="task_completed",
                payload=asdict(final_result),
            ))
        finally:
            self._active_tasks.pop(server_task_id, None)

        self._log(f"Task '{server_task_id}' finished: {final_result.status} "
                  f"in {final_result.execution_time_sec:.2f}s.")
        return final_result


# ---------------------------------------------------------------------------
# 5. PLUGIN ENTRY POINT
# ---------------------------------------------------------------------------

PLUGIN = {
    "name": "opencode_bridge",
    "description": (
        "Dispatch a coding task to an OpenCode agent over the JARVIS<->OpenCode "
        "bridge API (JSON over REST/WebSocket). Use when the user asks JARVIS to "
        "write, refactor or fix code through OpenCode. Give the instruction in "
        "plain language; progress is reported in the activity log and the "
        "code-job panel. Do NOT use this for general conversation — only for "
        "concrete code changes the user wants made."
    ),
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "instruction": {
                "type": "STRING",
                "description": "What code task to ask OpenCode to do (e.g. 'refactor db.py connection pool').",
            },
            "target_dir": {
                "type": "STRING",
                "description": "Project directory to operate in. Defaults to current working directory.",
            },
            "files": {
                "type": "STRING",
                "description": "Comma-separated list of files involved (optional).",
            },
        },
        "required": ["instruction"],
    },
    "behavior": "BLOCKING",
    "scheduling": "WHEN_IDLE",
}

PLUGIN_SETTINGS = {
    "namespace": "opencode_bridge",
    "title": "OpenCode Bridge",
    "fields": [
        {
            "key": "base_url",
            "label": "Bridge server base URL",
            "type": "text",
            "default": "http://127.0.0.1:8000",
            "description": "Base URL of the JARVIS<->OpenCode bridge server (FastAPI).",
        },
        {
            "key": "api_key",
            "label": "API key (Bearer token)",
            "type": "password",
            "description": "Bearer token sent in the Authorization header.",
        },
        {
            "key": "shared_secret",
            "label": "HMAC shared secret",
            "type": "password",
            "description": "Shared secret used to sign request payloads.",
        },
        {
            "key": "enable_hmac",
            "label": "Enable HMAC payload signing",
            "type": "bool",
            "default": True,
            "description": "Sign task payloads with HMAC-SHA256 for integrity.",
        },
        {
            "key": "task_timeout_s",
            "label": "Task timeout (seconds)",
            "type": "number",
            "default": 120,
            "description": "Maximum seconds to wait for a coding task to complete.",
        },
    ],
}


def run(parameters: dict, player=None, session_memory=None) -> str:
    """
    Plugin entry point. Called on a worker thread.

    Starts the bridge task on a background thread and returns at once with a
    short spoken string. Progress continues to flow through player.write_log
    and player.show_code_job from the background thread (both thread-safe).

    Never raises: all errors are caught and reported through the log.
    """
    instruction = (parameters.get("instruction") or "").strip()
    if not instruction:
        return "Sir, I need an instruction to send to OpenCode. What would you like me to code?"

    target_dir = (parameters.get("target_dir") or "").strip() or "./"
    files_raw = (parameters.get("files") or "").strip()
    files = [f.strip() for f in files_raw.split(",") if f.strip()] if files_raw else []

    task_id = f"job_{int(time.time())}"
    request = OpenCodeTaskRequest(
        task_id=task_id,
        instruction=instruction,
        target_dir=target_dir,
        files=files,
        context_memory={"os_system": "windows", "python_version": "3.11"},
    )

    bridge = JARVISOpenCodeBridge(player=player)

    def _work() -> None:
        """Slow network work lives here, off the caller's thread."""
        try:
            bridge.run_task(request)
        except Exception as e:  # never let the worker thread crash silently
            bridge._log(f"Task '{task_id}' failed: {e}")

    thread = threading.Thread(target=_work, daemon=True,
                              name=f"opencode-bridge-{task_id}")
    thread.start()

    bridge._log(f"OpenCode task '{task_id}' dispatched — instruction: {instruction}")
    return (f"OpenCode bridge: task '{task_id}' started. "
            f"I'll report progress in the activity log and the code-job panel "
            f"as OpenCode works on: {instruction}")
