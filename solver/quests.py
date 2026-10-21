"""Server-owned timed tests and one-time quest rewards."""
import json
import os
import random
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from .progress_store import ID_RE
except ImportError:
    from progress_store import ID_RE

SIZES = (30, 60, 120)
SECONDS_PER_QUESTION = 60


class ServiceError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class Question:
    id: str
    text: str
    options: tuple
    correct: str
    img: str = ""
    video: str = ""

    def public(self):
        return {"id": self.id, "question": self.text, "options": list(self.options),
                "img": self.img, "video": self.video}


class QuestionBank:
    def __init__(self, questions):
        questions = list(questions)
        self.by_id = {q.id: q for q in questions}
        if len(self.by_id) != len(questions):
            raise ValueError("duplicate question ids")

    def sample(self, size):
        if len(self.by_id) < size:
            raise ServiceError(503, "not_enough_questions")
        return random.sample(list(self.by_id), size)


def load_question_bank(path=None):
    path = Path(path or os.environ.get("CSN_QUESTIONS_FILE") or Path(__file__).with_name("questions.json"))
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("questions.json must contain a list")
    questions = []
    for item in raw:
        if not isinstance(item, dict) or item.get("verified") is not True:
            continue
        qid, correct = item.get("id"), item.get("correct_id")
        options = item.get("options")
        if (not isinstance(qid, str) or not ID_RE.fullmatch(qid) or
                not isinstance(options, list) or not options or
                not all(isinstance(o, dict) and isinstance(o.get("id"), str) for o in options) or
                not isinstance(correct, str) or
                correct not in [o.get("id") for o in options if isinstance(o, dict)]):
            continue
        questions.append(Question(qid, str(item.get("question", "")),
                                  tuple({"id": o["id"], "text": str(o.get("text", ""))} for o in options),
                                  correct, str(item.get("img") or ""), str(item.get("video") or "")))
    return QuestionBank(questions)


@dataclass(frozen=True)
class Quest:
    id: str
    title: str
    description: str
    size: int
    min_correct: int
    reward: int


def load_quests(path=None):
    path = Path(path or Path(__file__).with_name("quests.json"))
    raw = json.loads(path.read_text(encoding="utf-8"))
    quests = []
    seen = set()
    for item in raw:
        q = Quest(item["id"], item["title"], item["description"], item["size"],
                  item["min_correct"], item["reward"])
        if (not ID_RE.fullmatch(q.id) or q.id in seen or q.size not in SIZES or
                not 1 <= q.min_correct <= q.size or not 0 <= q.reward <= 10000):
            raise ValueError(f"invalid quest: {q.id}")
        seen.add(q.id)
        quests.append(q)
    return quests


def parse_time(value):
    return datetime.fromisoformat(value)


class QuestService:
    def __init__(self, store, bank, quests, clock=None):
        self.store = store
        self.bank = bank
        self.quests = list(quests)
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def start_attempt(self, oid, size):
        if type(size) is not int or size not in SIZES:
            raise ServiceError(400, "bad_size")
        ids = self.bank.sample(size)
        attempt_id = uuid.uuid4().hex
        now = self.clock().isoformat()
        self.store.create_attempt(oid, attempt_id, ids,
                                  {qid: self.bank.by_id[qid].correct for qid in ids}, now)
        return self.get_attempt(oid, attempt_id)

    def _finalize(self, oid, attempt):
        answers = attempt["answers"]
        correct = sum(option == attempt["correct_ids"].get(qid) for qid, option in answers.items())
        result, _ = self.store.save_result(oid, attempt["attempt_id"], correct,
                                           len(attempt["question_ids"]), "", answers)
        self._record_result_answers(oid, attempt, result)
        self._evaluate(oid, f"attempt:{attempt['attempt_id']}")
        return result

    def _record_result_answers(self, oid, attempt, result):
        graded = [{"question_id": qid, "category": "", "option": option,
                   "correct": option == attempt["correct_ids"].get(qid)}
                  for qid, option in result["answers"].items()]
        self.store.record_answers(oid, graded)

    def _advance_timeouts(self, oid, attempt):
        started = parse_time(attempt["question_started_at"])
        elapsed = (self.clock() - started).total_seconds()
        skipped = min(len(attempt["question_ids"]) - attempt["cursor"],
                      max(0, int(elapsed // SECONDS_PER_QUESTION)))
        if skipped:
            attempt = self.store.advance_attempt(
                oid, attempt, None, attempt["cursor"] + skipped,
                (started + timedelta(seconds=skipped * SECONDS_PER_QUESTION)).isoformat())
        return attempt

    def get_attempt(self, oid, attempt_id):
        attempt = self.store.get_attempt(oid, attempt_id)
        if attempt is None:
            raise ServiceError(404, "not_found")
        result = self.store.get_result(oid, attempt_id)
        if result:
            self._record_result_answers(oid, attempt, result)
            self._evaluate(oid, f"attempt:{attempt_id}")
            return {"attempt_id": attempt_id, "status": "finished", "result": result}
        attempt = self._advance_timeouts(oid, attempt)
        if attempt["cursor"] >= len(attempt["question_ids"]):
            return {"attempt_id": attempt_id, "status": "finished", "result": self._finalize(oid, attempt)}
        qid = attempt["question_ids"][attempt["cursor"]]
        question = self.bank.by_id.get(qid)
        if question is None:
            raise ServiceError(503, "question_bank_changed")
        deadline = parse_time(attempt["question_started_at"]) + timedelta(seconds=SECONDS_PER_QUESTION)
        return {"attempt_id": attempt_id, "status": "active", "size": len(attempt["question_ids"]),
                "number": attempt["cursor"] + 1, "question": question.public(),
                "deadline": deadline.isoformat(), "server_time": self.clock().isoformat()}

    def answer_attempt(self, oid, attempt_id, question_id, option):
        if not isinstance(question_id, str) or not isinstance(option, str):
            raise ServiceError(400, "bad_answer")
        state = self.get_attempt(oid, attempt_id)
        if state["status"] == "finished":
            return state
        if state["question"]["id"] != question_id:
            raise ServiceError(409, "question_expired")
        valid = {o["id"] for o in state["question"]["options"]}
        if option not in valid:
            raise ServiceError(400, "bad_answer")
        attempt = self.store.get_attempt(oid, attempt_id)
        if attempt["cursor"] >= len(attempt["question_ids"]) or attempt["question_ids"][attempt["cursor"]] != question_id:
            raise ServiceError(409, "question_expired")
        deadline = parse_time(attempt["question_started_at"]) + timedelta(seconds=SECONDS_PER_QUESTION)
        if self.clock() >= deadline:
            raise ServiceError(409, "question_expired")
        self.store.advance_attempt(oid, attempt, (question_id, option),
                                   attempt["cursor"] + 1, self.clock().isoformat())
        return self.get_attempt(oid, attempt_id)

    def list_attempts(self, oid):
        return self.store.list_attempts(oid)

    def _evaluate(self, oid, evidence):
        results = self.store.list_results(oid)
        granted_rows = self.store.list_user_quests(oid)
        granted = {r["quest_id"] for r in granted_rows}
        new = []
        for quest in self.quests:
            if quest.id in granted:
                continue
            if any(r["total"] == quest.size and r["correct"] >= quest.min_correct for r in results):
                if self.store.grant_quest(oid, quest.id, quest.reward, evidence):
                    new.append(quest.id)
        total = sum(r["reward"] for r in self.store.list_user_quests(oid))
        if new or (self.store.get_user(oid) or {}).get("total_points") != total:
            self.store.refresh_totals(oid)
        return new

    def overview(self, oid):
        self._evaluate(oid, "progress:repair")
        results = self.store.list_results(oid)
        granted = {r["quest_id"]: r for r in self.store.list_user_quests(oid)}
        user = self.store.get_user(oid) or {}
        quests = []
        for q in self.quests:
            best = max((r["correct"] for r in results if r["total"] == q.size), default=0)
            row = granted.get(q.id)
            quests.append({"id": q.id, "title": q.title, "description": q.description,
                           "size": q.size, "current": min(best, q.min_correct),
                           "target": q.min_correct, "reward": q.reward,
                           "completed": bool(row), "completed_at": row["completed_at"] if row else None})
        correct_unique = sum(1 for a in self.store.get_answers(oid).values() if a["correct_ever"])
        return {"total_points": user.get("total_points", 0), "correct_unique": correct_unique,
                "quests": quests,
                "attempts": results}
