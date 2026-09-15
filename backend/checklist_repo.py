"""
checklist_repo.py
-----------------
Checklist and checklist-item storage - the SQLite layer.

A checklist has a title/description; its items carry a 1-based `position` for
ordering and a `completed` flag. Timestamps are UTC ISO strings.
"""

from datetime import datetime, timezone

from backend.database import get_connection


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ChecklistRepository:
    # --- checklists -----------------------------------------------------
    def create_checklist(self, title, description=""):
        """Create a new checklist. Returns the checklist ID."""
        now = _now()
        conn = get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO checklists (title, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (title, description, now, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_checklist_by_id(self, checklist_id):
        conn = get_connection()
        try:
            row = conn.execute("SELECT * FROM checklists WHERE id = ?", (checklist_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_all_checklists(self):
        """All checklists, newest first."""
        conn = get_connection()
        try:
            rows = conn.execute("SELECT * FROM checklists ORDER BY created_at DESC").fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def update_checklist(self, checklist_id, title, description=""):
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE checklists SET title = ?, description = ?, updated_at = ? WHERE id = ?",
                (title, description, _now(), checklist_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def delete_checklist(self, checklist_id):
        """Delete a checklist and all its items."""
        conn = get_connection()
        try:
            conn.execute("DELETE FROM checklist_items WHERE checklist_id = ?", (checklist_id,))
            cur = conn.execute("DELETE FROM checklists WHERE id = ?", (checklist_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def duplicate_checklist(self, checklist_id):
        """Create a copy of a checklist with all its items."""
        original = self.get_checklist_by_id(checklist_id)
        if not original:
            return None
        new_id = self.create_checklist(original["title"] + " (Copy)", original["description"])
        conn = get_connection()
        try:
            items = conn.execute(
                "SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY position",
                (checklist_id,),
            ).fetchall()
        finally:
            conn.close()
        for item in items:
            self.create_item(new_id, item["title"], item["description"], item["position"])
        return new_id

    # --- items ----------------------------------------------------------
    def create_item(self, checklist_id, title, description="", position=None):
        """Add an item to a checklist.

        position=None appends at the end. Otherwise the new row takes that
        1-based position and every row at/after it shifts down one, so the
        caller can insert between two existing rows.
        """
        now = _now()
        conn = get_connection()
        try:
            if position is None:
                row = conn.execute(
                    "SELECT MAX(position) as max_pos FROM checklist_items WHERE checklist_id = ?",
                    (checklist_id,),
                ).fetchone()
                pos = (row["max_pos"] or 0) + 1
            else:
                pos = int(position)
                conn.execute(
                    "UPDATE checklist_items SET position = position + 1, updated_at = ? "
                    "WHERE checklist_id = ? AND position >= ?",
                    (now, checklist_id, pos),
                )
            cur = conn.execute(
                "INSERT INTO checklist_items (checklist_id, title, description, position, completed, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (checklist_id, title, description, pos, 0, now, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_items(self, checklist_id):
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY position",
                (checklist_id,),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def update_item(self, item_id, title, description=""):
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE checklist_items SET title = ?, description = ?, updated_at = ? WHERE id = ?",
                (title, description, _now(), item_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def toggle_item(self, item_id, completed):
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE checklist_items SET completed = ?, updated_at = ? WHERE id = ?",
                (1 if completed else 0, _now(), item_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def delete_item(self, item_id):
        conn = get_connection()
        try:
            cur = conn.execute("DELETE FROM checklist_items WHERE id = ?", (item_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def reorder_items(self, item_ids):
        """Reorder items. item_ids is a list in the desired order."""
        now = _now()
        conn = get_connection()
        try:
            for index, item_id in enumerate(item_ids):
                conn.execute(
                    "UPDATE checklist_items SET position = ?, updated_at = ? WHERE id = ?",
                    (index + 1, now, item_id),
                )
            conn.commit()
            return True
        finally:
            conn.close()

    def clear_completed(self, checklist_id):
        """Delete all completed items from a checklist. Returns rows removed."""
        conn = get_connection()
        try:
            cur = conn.execute(
                "DELETE FROM checklist_items WHERE checklist_id = ? AND completed = 1",
                (checklist_id,),
            )
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()

    def get_completion_stats(self, checklist_id):
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT COUNT(*) as total, "
                "SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed "
                "FROM checklist_items WHERE checklist_id = ?",
                (checklist_id,),
            ).fetchone()
            total = row["total"] or 0
            completed = row["completed"] or 0
            percentage = int(completed / total * 100) if total else 0
            return {"total": total, "completed": completed, "percentage": percentage}
        finally:
            conn.close()
