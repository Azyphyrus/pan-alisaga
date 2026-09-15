"""
notes_repo.py
-------------
Note storage and retrieval - the SQLite layer.

A note is a title, free-text content, and an optional inline image stored as a
data: URL in `image_data`. Timestamps are UTC ISO strings.
"""

from datetime import datetime, timezone

from backend.database import get_connection


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class NotesRepository:
    def create(self, title, content, image_data=""):
        """Create a new note. Returns the note ID."""
        now = _now()
        conn = get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO notes (title, content, image_data, created_at, modified_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (title, content, image_data or "", now, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_by_id(self, note_id):
        conn = get_connection()
        try:
            row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_all(self):
        """All notes, newest first."""
        conn = get_connection()
        try:
            rows = conn.execute("SELECT * FROM notes ORDER BY created_at DESC").fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def update(self, note_id, title, content, image_data=""):
        conn = get_connection()
        try:
            cur = conn.execute(
                "UPDATE notes SET title = ?, content = ?, image_data = ?, modified_at = ? WHERE id = ?",
                (title, content, image_data or "", _now(), note_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def delete(self, note_id):
        conn = get_connection()
        try:
            cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def search(self, query):
        conn = get_connection()
        try:
            like = "%" + query + "%"
            rows = conn.execute(
                "SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC",
                (like, like),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()
