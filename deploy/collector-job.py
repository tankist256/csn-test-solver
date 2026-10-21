#!/usr/bin/env python3
"""SSH-only control of the collector queue on the Azure host."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from solver import job_queue  # noqa: E402


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "claim":
        print(json.dumps(job_queue.claim() or {}))
        return 0
    if len(sys.argv) == 3 and sys.argv[1] == "stream":
        job_id = sys.argv[2]
        if len(job_id) != 32 or not all(char in "0123456789abcdef" for char in job_id):
            raise SystemExit("Nederīgs uzdevuma ID")
        for raw in sys.stdin:
            if len(raw) > 12000:
                raise SystemExit("Notikums ir pārāk liels")
            if not job_queue.event(job_id, json.loads(raw)):
                raise SystemExit("Uzdevums ir aizstāts")
        return 0
    raise SystemExit("Lietojums: collector-job.py claim | stream JOB_ID")


if __name__ == "__main__":
    sys.exit(main())
