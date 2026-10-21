"""Per-user progress, kept separate from Entra and keyed by the token oid.

Azure Table Storage layout (all user data is partitioned by oid, so one user's
data is always a single-partition query):

  Users          PK="user"   RK=<oid>              name, email, created_at, last_seen,
                                                   total_points, completed, lb_key
  Attempts       PK=<oid>    RK=<attempt_id>       question_ids/correct_ids/answers (json),
                                                   cursor, question_started_at, started_at
  AttemptResults PK=<oid>    RK=<attempt_id>       correct, total, category, answers (json),
                                                   finished_at. Insert-only: grading happens once.
  Answers        PK=<oid>    RK=<question_id>      category, last_answer, last_at, correct_ever
                                                   (only ever written as True, never reset)
  UserQuests     PK=<oid>    RK=<quest_id>         reward, completed_at, evidence.
                                                   Insert-only: the row IS the reward grant.
  Leaderboard    PK="board"  RK=<MAX-score>_<oid>  oid, name, score, completed

Quest progress is computed from AttemptResults. Each quest reward is an
insert-only UserQuests row, so a repeated request cannot award it again.
"""
import json
import os
import re
import threading
from datetime import datetime, timezone

MAX_SCORE = 10**9
ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
LAST_SEEN_REFRESH_SECONDS = 3600
TRANSACTION_LIMIT = 100


class StoreConfigError(Exception):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def board_key(oid, score):
    return f"{MAX_SCORE - min(max(score, 0), MAX_SCORE):010d}_{oid}"


def _age_seconds(iso_value):
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(iso_value)).total_seconds()
    except (TypeError, ValueError):
        return LAST_SEEN_REFRESH_SECONDS + 1


def _merge():
    from azure.data.tables import UpdateMode

    return UpdateMode.MERGE


def _user_view(entity):
    return {
        "oid": entity.get("RowKey") or entity.get("oid"),
        "name": entity.get("name", ""),
        "email": entity.get("email", ""),
        "created_at": entity.get("created_at"),
        "last_seen": entity.get("last_seen"),
        "total_points": int(entity.get("total_points", 0)),
        "completed": int(entity.get("completed", 0)),
    }


class InMemoryTable:
    """Small stand-in for azure.data.tables.TableClient (tests, local runs)."""

    def __init__(self):
        self.rows = {}
        self._lock = threading.RLock()

    def create_entity(self, entity):
        from azure.core.exceptions import ResourceExistsError

        key = (entity["PartitionKey"], entity["RowKey"])
        with self._lock:
            if key in self.rows:
                raise ResourceExistsError("exists")
            self.rows[key] = {**entity, "etag": "1"}

    def get_entity(self, partition_key, row_key, **kwargs):
        from azure.core.exceptions import ResourceNotFoundError

        with self._lock:
            try:
                return dict(self.rows[(partition_key, row_key)])
            except KeyError:
                raise ResourceNotFoundError("missing")

    def update_entity(self, entity, mode=None, **kwargs):
        from azure.core.exceptions import ResourceNotFoundError

        key = (entity["PartitionKey"], entity["RowKey"])
        with self._lock:
            if key not in self.rows:
                raise ResourceNotFoundError("missing")
            if kwargs.get("etag") is not None and kwargs["etag"] != self.rows[key].get("etag"):
                from azure.core.exceptions import ResourceModifiedError
                raise ResourceModifiedError("changed")
            self.rows[key].update(entity)
            self.rows[key]["etag"] = str(int(self.rows[key].get("etag", "0")) + 1)

    def upsert_entity(self, entity, mode=None, **kwargs):
        key = (entity["PartitionKey"], entity["RowKey"])
        with self._lock:
            if str(mode).endswith("REPLACE"):
                self.rows[key] = dict(entity)
            else:
                self.rows.setdefault(key, {}).update(entity)

    def delete_entity(self, partition_key, row_key, **kwargs):
        from azure.core.exceptions import ResourceNotFoundError

        with self._lock:
            if (partition_key, row_key) not in self.rows:
                raise ResourceNotFoundError("missing")
            del self.rows[(partition_key, row_key)]

    def query_entities(self, query_filter, parameters=None, select=None, **kwargs):
        pk = parameters["pk"] if parameters else re.search(r"'(.*)'", query_filter).group(1)
        with self._lock:
            return [{key: value for key, value in row.items() if not select or key in select}
                    for key, row in sorted(self.rows.items()) if key[0] == pk]

    def submit_transaction(self, operations):
        for name, entity, options in operations:
            assert name == "upsert"
            self.upsert_entity(entity, **options)


class TableStore:
    def __init__(self, users, attempts, results, answers, user_quests, board):
        self.users = users
        self.attempts = attempts
        self.results = results
        self.answers = answers
        self.user_quests = user_quests
        self.board = board

    @classmethod
    def in_memory(cls):
        return cls(*(InMemoryTable() for _ in range(6)))

    @classmethod
    def from_env(cls):
        from azure.data.tables import TableServiceClient

        connection_string = os.environ.get("AZURE_TABLES_CONNECTION_STRING", "").strip()
        if connection_string:
            service = TableServiceClient.from_connection_string(connection_string)
        else:
            url = os.environ.get("AZURE_STORAGE_ACCOUNT_URL", "").strip()
            if not url:
                raise StoreConfigError("AZURE_STORAGE_ACCOUNT_URL is not set")
            from azure.identity import DefaultAzureCredential

            service = TableServiceClient(endpoint=url, credential=DefaultAzureCredential())

        def table(env_name, default):
            name = os.environ.get(env_name, default).strip() or default
            try:
                return service.create_table_if_not_exists(name)
            except Exception:
                # The identity may lack permission to create tables; use a pre-created one.
                return service.get_table_client(name)

        return cls(
            table("TABLE_USERS", "Users"),
            table("TABLE_ATTEMPTS", "Attempts"),
            table("TABLE_RESULTS", "AttemptResults"),
            table("TABLE_ANSWERS", "Answers"),
            table("TABLE_USER_QUESTS", "UserQuests"),
            table("TABLE_LEADERBOARD", "Leaderboard"),
        )

    # ---- Users

    def _get_user_entity(self, oid):
        from azure.core.exceptions import ResourceNotFoundError

        try:
            return self.users.get_entity(partition_key="user", row_key=oid)
        except ResourceNotFoundError:
            return None

    def _get_or_create_user(self, oid, email="", name=""):
        from azure.core.exceptions import ResourceExistsError

        entity = self._get_user_entity(oid)
        if entity is not None:
            return entity
        now = utc_now()
        entity = {
            "PartitionKey": "user", "RowKey": oid, "email": email, "name": name,
            "created_at": now, "last_seen": now, "total_points": 0, "completed": 0,
        }
        try:
            self.users.create_entity(entity)
        except ResourceExistsError:
            return self._get_user_entity(oid)
        key = board_key(oid, 0)
        self.board.upsert_entity(
            {"PartitionKey": "board", "RowKey": key, "oid": oid, "name": name,
             "score": 0, "completed": 0}, mode=_merge())
        self.users.update_entity(
            {"PartitionKey": "user", "RowKey": oid, "lb_key": key}, mode=_merge())
        entity["lb_key"] = key
        return entity

    def upsert_user(self, oid, email="", name=""):
        entity = self._get_or_create_user(oid, email, name)
        if not entity.get("lb_key"):
            self.refresh_totals(oid)
            entity = self._get_user_entity(oid)
        changes = {}
        if email and entity.get("email") != email:
            changes["email"] = email
        if name and entity.get("name") != name:
            changes["name"] = name
        if _age_seconds(entity.get("last_seen")) > LAST_SEEN_REFRESH_SECONDS:
            changes["last_seen"] = utc_now()
        if changes:
            self.users.update_entity({"PartitionKey": "user", "RowKey": oid, **changes},
                                     mode=_merge())
            entity = {**entity, **changes}
            if "name" in changes and entity.get("lb_key"):
                self.board.upsert_entity(
                    {"PartitionKey": "board", "RowKey": entity["lb_key"],
                     "oid": oid, "name": entity["name"]}, mode=_merge())
        return _user_view(entity)

    def get_user(self, oid):
        entity = self._get_user_entity(oid)
        return _user_view(entity) if entity is not None else None

    def list_users(self):
        rows = self.users.query_entities("PartitionKey eq 'user'")
        return [_user_view(row) for row in rows]

    # ---- Attempts (a started test) and their single result

    def create_attempt(self, oid, attempt_id, question_ids, correct_ids, started_at):
        self.attempts.create_entity({
            "PartitionKey": oid, "RowKey": attempt_id, "question_ids": json.dumps(question_ids),
            "correct_ids": json.dumps(correct_ids), "answers": "{}",
            "cursor": 0, "question_started_at": started_at, "started_at": started_at,
        })

    def get_attempt(self, oid, attempt_id):
        from azure.core.exceptions import ResourceNotFoundError

        try:
            row = self.attempts.get_entity(partition_key=oid, row_key=attempt_id)
        except ResourceNotFoundError:
            return None
        etag = getattr(row, "metadata", {}).get("etag") or row.get("etag")
        return {"attempt_id": attempt_id, "question_ids": json.loads(row["question_ids"]),
                "correct_ids": json.loads(row["correct_ids"]), "answers": json.loads(row["answers"]),
                "cursor": int(row["cursor"]), "question_started_at": row["question_started_at"],
                "started_at": row["started_at"], "etag": etag}

    def advance_attempt(self, oid, attempt, answer, cursor, question_started_at):
        from azure.core import MatchConditions
        from azure.core.exceptions import ResourceModifiedError
        from azure.data.tables import UpdateMode
        answers = dict(attempt["answers"])
        if answer:
            answers[answer[0]] = answer[1]
        try:
            self.attempts.update_entity(
                {"PartitionKey": oid, "RowKey": attempt["attempt_id"], "cursor": cursor,
                 "answers": json.dumps(answers), "question_started_at": question_started_at},
                mode=UpdateMode.MERGE, etag=attempt["etag"],
                match_condition=MatchConditions.IfNotModified,
            )
        except ResourceModifiedError:
            try:
                from .quests import ServiceError
            except ImportError:
                from quests import ServiceError
            raise ServiceError(409, "attempt_changed")
        return self.get_attempt(oid, attempt["attempt_id"])

    def list_attempts(self, oid):
        rows = self.attempts.query_entities("PartitionKey eq @pk", parameters={"pk": oid})
        return sorted(
            ({"attempt_id": r["RowKey"], "size": len(json.loads(r["question_ids"])),
              "started_at": r["started_at"], "finished": self.get_result(oid, r["RowKey"]) is not None}
             for r in rows), key=lambda r: r["started_at"], reverse=True,
        )

    @staticmethod
    def _result_view(row, with_answers):
        view = {"attempt_id": row["RowKey"], "correct": int(row["correct"]), "total": int(row["total"]),
                "category": row.get("category", ""), "finished_at": row["finished_at"]}
        if with_answers:
            view["answers"] = json.loads(row.get("answers", "{}"))
        return view

    def save_result(self, oid, attempt_id, correct, total, category, answers):
        """Insert-only. Returns (result, created); a repeat returns the stored one."""
        from azure.core.exceptions import ResourceExistsError

        try:
            self.results.create_entity({
                "PartitionKey": oid, "RowKey": attempt_id, "correct": correct, "total": total,
                "category": category, "answers": json.dumps(answers), "finished_at": utc_now(),
            })
            created = True
        except ResourceExistsError:
            created = False
        return self.get_result(oid, attempt_id), created

    def get_result(self, oid, attempt_id):
        from azure.core.exceptions import ResourceNotFoundError

        try:
            row = self.results.get_entity(partition_key=oid, row_key=attempt_id)
        except ResourceNotFoundError:
            return None
        return self._result_view(row, with_answers=True)

    def list_results(self, oid):
        rows = self.results.query_entities("PartitionKey eq @pk", parameters={"pk": oid})
        return sorted((self._result_view(r, with_answers=False) for r in rows),
                      key=lambda r: r["finished_at"])

    # ---- Answers

    def record_answers(self, oid, graded):
        """graded: [{question_id, category, option, correct}]. correct_ever is only
        ever written as True, so concurrent requests cannot reset it."""
        now = utc_now()
        operations = []
        for item in graded:
            entity = {"PartitionKey": oid, "RowKey": item["question_id"],
                      "category": item["category"], "last_answer": item["option"], "last_at": now}
            if item["correct"]:
                entity["correct_ever"] = True
            operations.append(("upsert", entity, {"mode": _merge()}))
        for start in range(0, len(operations), TRANSACTION_LIMIT):
            self.answers.submit_transaction(operations[start:start + TRANSACTION_LIMIT])

    def get_answers(self, oid):
        rows = self.answers.query_entities("PartitionKey eq @pk", parameters={"pk": oid},
                                           select=["RowKey", "category", "correct_ever"])
        return {row["RowKey"]: {"category": row.get("category", ""),
                                "correct_ever": bool(row.get("correct_ever", False))}
                for row in rows}

    # ---- Quest rewards

    def grant_quest(self, oid, quest_id, reward, evidence=""):
        """True only for the one call that creates the row, so a reward is paid once."""
        from azure.core.exceptions import ResourceExistsError

        try:
            self.user_quests.create_entity({
                "PartitionKey": oid, "RowKey": quest_id, "reward": reward,
                "completed_at": utc_now(), "evidence": evidence,
            })
            return True
        except ResourceExistsError:
            return False

    def list_user_quests(self, oid):
        rows = self.user_quests.query_entities("PartitionKey eq @pk", parameters={"pk": oid})
        return sorted(
            ({"quest_id": r["RowKey"], "reward": int(r.get("reward", 0)),
              "completed_at": r.get("completed_at"), "evidence": r.get("evidence", "")} for r in rows),
            key=lambda r: r["completed_at"] or "",
        )

    def refresh_totals(self, oid):
        """Recompute total points from granted rewards and move the leaderboard row."""
        from azure.core.exceptions import ResourceNotFoundError
        from azure.data.tables import UpdateMode

        granted = self.list_user_quests(oid)
        total = min(sum(q["reward"] for q in granted), MAX_SCORE)
        completed = len(granted)

        user = self._get_or_create_user(oid)
        old_key = user.get("lb_key")
        new_key = board_key(oid, total)
        self.board.upsert_entity(
            {"PartitionKey": "board", "RowKey": new_key, "oid": oid, "name": user.get("name", ""),
             "score": total, "completed": completed},
            mode=UpdateMode.REPLACE,
        )
        self.users.update_entity(
            {"PartitionKey": "user", "RowKey": oid, "total_points": total, "completed": completed,
             "lb_key": new_key},
            mode=UpdateMode.MERGE,
        )
        if old_key and old_key != new_key:
            try:
                self.board.delete_entity(partition_key="board", row_key=old_key)
            except ResourceNotFoundError:
                pass
        return total, completed

    # ---- Leaderboard

    def leaderboard(self, limit=50):
        """Top users by score. Points never decrease, so if a stale row from an
        interrupted update survives, the first (highest) row per user is the right one."""
        seen = set()
        result = []
        rows = sorted(self.board.query_entities("PartitionKey eq 'board'"),
                      key=lambda r: (-int(r.get("score", 0)), -int(r.get("completed", 0)),
                                     str(r.get("oid", ""))))
        for row in rows:
            oid = row.get("oid")
            if oid in seen:
                continue
            seen.add(oid)
            result.append({
                "rank": len(result) + 1, "oid": oid, "name": row.get("name", ""),
                "score": int(row.get("score", 0)),
                "completed": int(row.get("completed", 0)),
            })
            if len(result) >= limit:
                break
        return result
