"""PostgreSQL implementation of the small entity interface used by TableStore.

Progress keeps the same user UUID and insert-only result/quest semantics as the
Azure Tables backend. The JSONB rows make it possible to switch storage without
changing the grading code or the public API.
"""
import re

from azure.core.exceptions import ResourceExistsError, ResourceModifiedError, ResourceNotFoundError
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


class PostgresEngine:
    def __init__(self, url):
        if not url:
            raise ValueError("DATABASE_URL is required for PostgreSQL progress")
        self.pool = ConnectionPool(conninfo=url, min_size=0, max_size=5, open=True,
                                   kwargs={"connect_timeout": 5})
        with self.pool.connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS progress_entities (
                    table_name text NOT NULL,
                    partition_key text NOT NULL,
                    row_key text NOT NULL,
                    data jsonb NOT NULL,
                    version bigint NOT NULL DEFAULT 1,
                    PRIMARY KEY (table_name, partition_key, row_key)
                )
            """)

    def close(self):
        self.pool.close()


class PostgresTable:
    def __init__(self, engine, name):
        self.engine = engine
        self.name = name

    @staticmethod
    def _view(row):
        data, version = row
        return {**data, "etag": str(version)}

    def create_entity(self, entity):
        with self.engine.pool.connection() as conn:
            row = conn.execute("""
                INSERT INTO progress_entities (table_name, partition_key, row_key, data)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT DO NOTHING RETURNING version
            """, (self.name, entity["PartitionKey"], entity["RowKey"], Jsonb(entity))).fetchone()
        if row is None:
            raise ResourceExistsError("entity exists")

    def get_entity(self, partition_key, row_key, **kwargs):
        with self.engine.pool.connection() as conn:
            row = conn.execute("""
                SELECT data, version FROM progress_entities
                WHERE table_name = %s AND partition_key = %s AND row_key = %s
            """, (self.name, partition_key, row_key)).fetchone()
        if row is None:
            raise ResourceNotFoundError("entity missing")
        return self._view(row)

    def update_entity(self, entity, mode=None, **kwargs):
        replace = str(mode).upper().endswith("REPLACE")
        expected = kwargs.get("etag")
        with self.engine.pool.connection() as conn:
            row = conn.execute(f"""
                UPDATE progress_entities
                   SET data = {"%s::jsonb" if replace else "data || %s::jsonb"},
                       version = version + 1
                 WHERE table_name = %s AND partition_key = %s AND row_key = %s
                   AND (%s::bigint IS NULL OR version = %s::bigint)
                RETURNING version
            """, (Jsonb(entity), self.name, entity["PartitionKey"], entity["RowKey"],
                  expected, expected)).fetchone()
            if row is None:
                exists = conn.execute("""
                    SELECT 1 FROM progress_entities
                    WHERE table_name = %s AND partition_key = %s AND row_key = %s
                """, (self.name, entity["PartitionKey"], entity["RowKey"])).fetchone()
                if exists:
                    raise ResourceModifiedError("entity changed")
                raise ResourceNotFoundError("entity missing")

    def _upsert(self, conn, entity, mode=None):
        replace = str(mode).upper().endswith("REPLACE")
        update = "EXCLUDED.data" if replace else "progress_entities.data || EXCLUDED.data"
        conn.execute(f"""
            INSERT INTO progress_entities (table_name, partition_key, row_key, data)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (table_name, partition_key, row_key)
            DO UPDATE SET data = {update}, version = progress_entities.version + 1
        """, (self.name, entity["PartitionKey"], entity["RowKey"], Jsonb(entity)))

    def upsert_entity(self, entity, mode=None, **kwargs):
        with self.engine.pool.connection() as conn:
            self._upsert(conn, entity, mode)

    def delete_entity(self, partition_key, row_key, **kwargs):
        with self.engine.pool.connection() as conn:
            row = conn.execute("""
                DELETE FROM progress_entities
                WHERE table_name = %s AND partition_key = %s AND row_key = %s
                RETURNING 1
            """, (self.name, partition_key, row_key)).fetchone()
        if row is None:
            raise ResourceNotFoundError("entity missing")

    def query_entities(self, query_filter, parameters=None, select=None, **kwargs):
        if parameters:
            partition_key = parameters["pk"]
        else:
            match = re.fullmatch(r"PartitionKey eq '([^']+)'", query_filter)
            if not match:
                raise ValueError("unsupported query")
            partition_key = match.group(1)
        with self.engine.pool.connection() as conn:
            rows = conn.execute("""
                SELECT data, version FROM progress_entities
                WHERE table_name = %s AND partition_key = %s ORDER BY row_key
            """, (self.name, partition_key)).fetchall()
        entities = [self._view(row) for row in rows]
        if select:
            return [{key: item[key] for key in select if key in item} for item in entities]
        return entities

    def submit_transaction(self, operations):
        with self.engine.pool.connection() as conn:
            for action, entity, options in operations:
                if action != "upsert":
                    raise ValueError("unsupported transaction action")
                self._upsert(conn, entity, options.get("mode"))


def progress_store(engine):
    try:
        from .progress_store import TableStore
    except ImportError:
        from progress_store import TableStore
    return TableStore(*(PostgresTable(engine, name) for name in (
        "Users", "Attempts", "AttemptResults", "Answers", "UserQuests", "Leaderboard")))
