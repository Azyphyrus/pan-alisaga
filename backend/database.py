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
