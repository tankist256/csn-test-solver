#!/usr/bin/env python3
"""Validate a staged question database and replace the VM copy safely."""

import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HOME = Path("/home/tankist256")
APP_DIR = HOME / "csn-test-solver"
SOLVER_DIR = APP_DIR / "solver"
BACKUP_DIR = HOME / "csn-data-backups"
JS_PREFIX = "window.CSDD_QUESTIONS = "


def validate_stage(stage):
    if stage.parent != HOME or not stage.name.startswith("csn-data-upload."):
        raise ValueError("Unexpected upload directory")
    json_file = stage / "questions.json"
    js_file = stage / "questions.js"
    if any(not path.is_file() or path.is_symlink() for path in (json_file, js_file)):
        raise ValueError("Question files are missing or are symbolic links")

    with json_file.open(encoding="utf-8") as source:
        questions = json.load(source)
    if not isinstance(questions, list) or not questions:
        raise ValueError("Question database is empty or invalid")

    js_text = js_file.read_text(encoding="utf-8").strip()
    if not js_text.startswith(JS_PREFIX) or not js_text.endswith(";"):
        raise ValueError("questions.js has an unexpected format")
    if json.loads(js_text[len(JS_PREFIX):-1]) != questions:
        raise ValueError("questions.js does not match questions.json")

    media_root = (SOLVER_DIR / "media").resolve()
    for question in questions:
        if not isinstance(question, dict) or not question.get("id"):
            raise ValueError("A question is incomplete")
        for kind in ("img", "video"):
            media_path = question.get(kind, "")
            if not isinstance(media_path, str):
                raise ValueError(f"Invalid {kind} path")
            if media_path.startswith("media/"):
                source = (SOLVER_DIR / media_path).resolve()
                if not source.is_relative_to(media_root) or not source.is_file() or source.stat().st_size == 0:
                    raise ValueError(f"Missing media file: {media_path}")
    return len(questions)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: apply-data-sync.py STAGING_DIRECTORY")
    stage = Path(sys.argv[1]).resolve()
    count = validate_stage(stage)

    BACKUP_DIR.mkdir(mode=0o700, exist_ok=True)
    os.chmod(BACKUP_DIR, 0o700)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-")
    backup = Path(tempfile.mkdtemp(prefix=timestamp, dir=BACKUP_DIR))
    for name in ("questions.json", "questions.js"):
        current = SOLVER_DIR / name
        if current.exists():
            shutil.copy2(current, backup / name)

    try:
        for name in ("questions.json", "questions.js"):
            target = SOLVER_DIR / name
            os.replace(stage / name, target)
            os.chmod(target, 0o644)
    except Exception:
        for name in ("questions.json", "questions.js"):
            saved = backup / name
            if saved.exists():
                shutil.copy2(saved, SOLVER_DIR / name)
        raise

    stage.rmdir()
    print(f"Installed {count} questions; previous database: {backup}")


if __name__ == "__main__":
    main()
