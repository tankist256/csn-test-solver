"""Persistent one-job queue shared by the web server and the home worker."""

import fcntl
import json
import os
import re
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
JOB_PATH = ROOT / ".collector-job.json"
LOCK_PATH = ROOT / ".collector-job.lock"
WORKER_TIMEOUT = 45


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def empty_state():
    return {
        "job_id": None,
        "phase": "idle",
        "running": False,
        "rounds": 0,
        "completed_rounds": 0,
        "message": "Gaida datora palīgprogrammu.",
        "log": [],
        "returncode": None,
        "started_at": None,
        "finished_at": None,
        "worker_seen": 0,
    }


@contextmanager
def locked_state():
    with open(LOCK_PATH, "a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            try:
                state = json.loads(JOB_PATH.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError):
                state = empty_state()
            before = json.dumps(state, sort_keys=True)
            yield state
            if json.dumps(state, sort_keys=True) == before:
                return
            fd, name = tempfile.mkstemp(prefix=".collector-job-", dir=ROOT)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as output:
                    json.dump(state, output, ensure_ascii=False)
                os.chmod(name, 0o600)
                os.replace(name, JOB_PATH)
            finally:
                if os.path.exists(name):
                    os.unlink(name)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def refresh_offline(state):
    online = time.time() - state.get("worker_seen", 0) <= WORKER_TIMEOUT
    if state.get("running") and not online:
        state.update(
            phase="failed",
            running=False,
            returncode=3,
            finished_at=now_iso(),
            message="Datora palīgprogramma pārtrauca savienojumu. Pārbaudiet tās darbību un sāciet ievākšanu vēlreiz.",
        )
    return online


def snapshot():
    with locked_state() as state:
        online = refresh_offline(state)
        public = {key: value for key, value in state.items() if key not in {"job_id", "worker_seen"}}
        public["worker_online"] = online
        if not online and not state["running"] and state["returncode"] is None:
            public["message"] = "Datora palīgprogramma nav savienota. Ieslēdziet to, lai ievāktu jautājumus."
        return public


def enqueue(rounds):
    with locked_state() as state:
        if not refresh_offline(state):
            raise RuntimeError("Palīgprogramma nav savienota. Ieslēdziet palīgprogrammu un mēģiniet vēlreiz.")
        if state.get("running"):
            raise ValueError("Jautājumu ievākšana jau notiek.")
        state.update(
            job_id=uuid.uuid4().hex,
            phase="queued",
            running=True,
            rounds=rounds,
            completed_rounds=0,
            message="Uzdevums nosūtīts datoram. Gaida ievākšanas sākumu…",
            log=[],
            returncode=None,
            started_at=now_iso(),
            finished_at=None,
        )
    return snapshot()


def claim():
    with locked_state() as state:
        refresh_offline(state)
        state["worker_seen"] = time.time()
        if state.get("phase") != "queued":
            return None
        state["phase"] = "running"
        state["message"] = "Datora palīgprogramma sāk ievākt jautājumus."
        return {"job_id": state["job_id"], "rounds": state["rounds"]}


def event(job_id, payload):
    with locked_state() as state:
        if state.get("job_id") != job_id:
            return False
        state["worker_seen"] = time.time()
        kind = payload.get("type")
        if kind == "heartbeat":
            return True
        if kind == "log":
            line = str(payload.get("line", ""))[:2000]
            if line:
                state["log"] = (state.get("log", []) + [line])[-100:]
                match = re.search(r"Kārta (\d+)(?:/\d+)? pabeigta", line)
                if match:
                    state["completed_rounds"] = int(match.group(1))
                    state["message"] = line
                elif line.startswith("[!]") or line.startswith("Azure datubāze atbilst"):
                    state["message"] = line
            return True
        if kind == "finish":
            code = int(payload.get("returncode", 1))
            state.update(
                phase="done" if code == 0 else "failed",
                running=False,
                returncode=code,
                finished_at=now_iso(),
                message=(
                    f"Ievākšana pabeigta. Pabeigto testu skaits: {state['completed_rounds']} no {state['rounds']}. "
                    "Datubāze vietnē ir atjaunināta."
                    if code == 0 else "Jautājumu ievākšana vai datubāzes pārsūtīšana neizdevās. Skatiet žurnālu."
                ),
            )
            return True
        raise ValueError("Nezināms notikuma veids.")
