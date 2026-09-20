"""PostgreSQL connection and versioned, idempotent SQL migrations."""
import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def connect():
    return psycopg.connect(
        os.getenv("DATABASE_URL", "postgresql://honest_month:local_dev_password@localhost:5432/honest_month"),
        row_factory=dict_row,
    )


@contextmanager
def transaction():
    with connect() as conn:
        yield conn


def migrate():
    directory = Path(__file__).resolve().parent.parent / "migrations"
    with connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY)")
        for path in sorted(directory.glob("*.sql")):
            if not conn.execute("SELECT 1 FROM schema_migrations WHERE version=%s", (path.name,)).fetchone():
                conn.execute(path.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations(version) VALUES (%s)", (path.name,))


def one(conn, query, params=()):
    return conn.execute(query, params).fetchone()


def all_rows(conn, query, params=()):
    return conn.execute(query, params).fetchall()
