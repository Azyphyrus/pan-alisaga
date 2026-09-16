"""
database.py
------------
All SQLite access lives here. sqlite3 is part of the Python standard
library, so no extra installation is needed for the database itself.

Keeping DB code in its own module (separate from api.py) means:
- api.py stays focused on "what the frontend is allowed to call"
- database.py stays focused on "how data is stored/queried"
"""

import sqlite3
import os

# Store the DB file inside /data so it's easy to find, back up, or .gitignore
DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "app.db")


def get_connection():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # lets us access columns by name
    return conn


def init_db():
    """Create tables if they don't exist yet. Call this once on app startup."""
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()
    ensure_vault_schema()
    ensure_calendar_schema()
    ensure_notes_schema()
    ensure_checklist_schema()
    ensure_tasks_schema()


def ensure_checklist_schema():
    """Create the checklist tables if missing. No-op on the migrated DB."""
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS checklists (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS checklist_items (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                checklist_id INTEGER NOT NULL,
                title        TEXT NOT NULL,
                description  TEXT NOT NULL DEFAULT '',
                position     INTEGER NOT NULL,
                completed    INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                FOREIGN KEY (checklist_id) REFERENCES checklists(id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist_id ON checklist_items (checklist_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_checklist_items_position ON checklist_items (position)")
        conn.commit()
    finally:
        conn.close()


def ensure_notes_schema():
    """Create the notes table if it is missing. No-op on the migrated DB."""
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                content     TEXT NOT NULL,
                image_data  TEXT,
                created_at  TEXT NOT NULL,
                modified_at TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()


def ensure_calendar_schema():
    """Create the calendar events table if it is missing.

    Times are local wall-clock ISO strings. Safe to call repeatedly; a
    database migrated from the previous build already has this table with all
    columns, so this is a no-op there.
    """
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                title          TEXT NOT NULL,
                description    TEXT NOT NULL DEFAULT '',
                starts_at      TEXT NOT NULL,
                ends_at        TEXT,
                all_day        INTEGER NOT NULL DEFAULT 0,
                remind_minutes INTEGER,
                notified_at    TEXT,
                snoozed_until  TEXT,
                repeat_rule    TEXT,
                repeat_until   TEXT,
                notified_for   TEXT,
                created_at     TEXT NOT NULL,
                updated_at     TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events (starts_at)")

        # Older databases predate some columns; add any that are missing.
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(events)")}
        for col in ("snoozed_until", "repeat_rule", "repeat_until", "notified_for"):
            if col not in existing:
                conn.execute("ALTER TABLE events ADD COLUMN %s TEXT" % col)

        conn.commit()
    finally:
        conn.close()


def ensure_vault_schema():
    """Create the password-manager tables if they are missing.

    The vault holds one row (id = 1) describing how the master key is
    derived; credentials store title in plaintext and every secret column as
    Fernet ciphertext (NULL when empty). Safe to call repeatedly - it only
    creates what is absent, so a database migrated from the previous build is
    left exactly as it is.
    """
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS vault (
                id         INTEGER PRIMARY KEY CHECK (id = 1),
                salt       BLOB NOT NULL,
                verifier   BLOB NOT NULL,
                iterations INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS credentials (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL,
                username   BLOB,
                secret     BLOB NOT NULL,
                url        BLOB,
                notes      BLOB,
                fields     BLOB,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_credentials_title ON credentials (title)")

        # A database created before custom fields existed won't have the
        # `fields` column; add it so both old and new data work here.
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(credentials)")}
        if "fields" not in existing:
            conn.execute("ALTER TABLE credentials ADD COLUMN fields BLOB")

        conn.commit()
    finally:
        conn.close()


def ensure_tasks_schema():
    """Create the plans and tasks tables if they are missing.
    
    Plans have custom statuses stored as pipe-separated strings.
    Tasks can be nested up to any depth via parent_task_id.
    """
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plans (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                statuses    TEXT NOT NULL DEFAULT 'Not Started|In Progress|On Hold|Completed',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id         INTEGER NOT NULL,
                parent_task_id  INTEGER,
                title           TEXT NOT NULL,
                description     TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL DEFAULT 'Not Started',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                FOREIGN KEY (plan_id) REFERENCES plans(id),
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
            )
        """)
        
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON tasks (plan_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks (parent_task_id)")
        
        conn.commit()
    finally:
        conn.close()


def add_todo(title: str):
    conn = get_connection()
    cur = conn.execute("INSERT INTO todos (title) VALUES (?)", (title,))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def get_todos():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM todos ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


def toggle_todo(todo_id: int):
    conn = get_connection()
    conn.execute("UPDATE todos SET done = NOT done WHERE id = ?", (todo_id,))
    conn.commit()
    conn.close()


def delete_todo(todo_id: int):
    conn = get_connection()
    conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
    conn.commit()
    conn.close()
