"""Small, deterministic question bank for tests that never need live CSDD data."""

import json
import tempfile
from pathlib import Path

from solver.quests import load_question_bank


def make_question_bank(size=120):
    questions = [
        {
            "id": f"fixture-{index:03d}",
            "question": f"Sample traffic question {index}",
            "options": [
                {"id": "a", "text": "Safe answer"},
                {"id": "b", "text": "Other answer"},
            ],
            "correct_id": "a",
            "verified": True,
        }
        for index in range(size)
    ]
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "questions.json"
        path.write_text(json.dumps(questions), encoding="utf-8")
        return load_question_bank(path)
