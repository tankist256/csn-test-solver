#!/usr/bin/env python3
"""Run Azure collector jobs through this computer's CSDD connection."""

import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SYNC_SCRIPT = ROOT / "deploy" / "collect-and-sync.sh"
REMOTE = os.environ.get("CSN_AZURE_REMOTE", "tankist256@20.91.139.58")
SSH_KEY = os.environ.get("CSN_AZURE_SSH_KEY", "/home/tankist256/Downloads/csn-solver_key.pem")
REMOTE_SCRIPT = "/home/tankist256/csn-test-solver/deploy/collector-job.py"
SSH = [
    "ssh", "-T", "-F", "/dev/null", "-i", SSH_KEY,
    "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "UserKnownHostsFile=/home/tankist256/.ssh/known_hosts",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
]


def remote_command(action, job_id=None):
    command = f"sudo -n python3 {REMOTE_SCRIPT} {action}"
    if job_id:
        command += f" {job_id}"
    return SSH + [REMOTE, command]


def claim_job():
    result = subprocess.run(remote_command("claim"), capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Azure nav sasniedzama")
    return json.loads(result.stdout)


class EventStream:
    def __init__(self, job_id):
        self.job_id = job_id
        self.process = None

    def open(self):
        self.process = subprocess.Popen(
            remote_command("stream", self.job_id),
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

    def send(self, payload):
        for attempt in range(3):
            if self.process is None or self.process.poll() is not None:
                self.open()
            try:
                self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
                self.process.stdin.flush()
                return
            except (BrokenPipeError, OSError):
                self.process = None
                if attempt == 2:
                    raise
                time.sleep(2)

    def close(self):
        if self.process is not None:
            self.process.stdin.close()
            code = self.process.wait(timeout=20)
            if code:
                raise RuntimeError(f"Azure progresa kanāls beidza darbu ar kodu {code}")


def collect(job):
    job_id = job["job_id"]
    rounds = int(job["rounds"])
    print(f"Sākts uzdevums {job_id[:8]}. Testu skaits: {rounds}.", flush=True)
    stream = EventStream(job_id)
    output = queue.Queue()
    process = subprocess.Popen(
        [str(SYNC_SCRIPT), str(rounds)], cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )

    def read_output():
        for line in process.stdout:
            output.put(line.rstrip("\n"))
        output.put(None)

    threading.Thread(target=read_output, daemon=True).start()
    try:
        while True:
            try:
                line = output.get(timeout=5)
            except queue.Empty:
                stream.send({"type": "heartbeat"})
                continue
            if line is None:
                break
            print(line, flush=True)
            stream.send({"type": "log", "line": line})
        code = process.wait()
        stream.send({"type": "finish", "returncode": code})
        stream.close()
        print(f"Uzdevums {job_id[:8]} beidzās ar kodu {code}", flush=True)
    except Exception:
        process.terminate()
        raise


def main():
    if not Path(SSH_KEY).is_file():
        raise SystemExit(f"SSH atslēga nav atrasta: {SSH_KEY}")
    last_error = None
    while True:
        try:
            job = claim_job()
            last_error = None
            if job:
                collect(job)
            else:
                time.sleep(5)
        except Exception:
            message = "Radās palīgprogrammas savienojuma vai izpildes kļūda."
            if message != last_error:
                print(f"Palīgprogrammas kļūda: {message}", flush=True)
                last_error = message
            time.sleep(10)


if __name__ == "__main__":
    main()
