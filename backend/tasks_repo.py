"""
tasks_repo.py
-------------
Task and plan storage and retrieval - the SQLite layer.

A plan has a title, description, and custom statuses.
A task has a title, description, status, and can be nested (parent_task_id).
"""

from datetime import datetime, timezone
from backend.database import get_connection


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TasksRepository:
    # ===== PLANS =====
    
    def create_plan(self, title, description, statuses=None):
        """Create a new plan with custom statuses. Returns the plan ID."""
        if statuses is None:
            statuses = ["Not Started", "In Progress", "On Hold", "Completed"]
        
        # Store statuses as a pipe-separated string
        statuses_str = "|".join(statuses)
        now = _now()
        
        conn = get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO plans (title, description, statuses, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (title, description, statuses_str, now, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_plan_by_id(self, plan_id):
        """Get a plan with its statuses parsed."""
        conn = get_connection()
        try:
            row = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
            if row:
                plan = dict(row)
                # Parse statuses from pipe-separated string
                plan['statuses'] = plan['statuses'].split('|') if plan['statuses'] else []
                return plan
            return None
        finally:
            conn.close()

    def get_all_plans(self):
        """All plans, newest first."""
        conn = get_connection()
        try:
            rows = conn.execute("SELECT * FROM plans ORDER BY created_at DESC").fetchall()
            plans = []
            for row in rows:
                plan = dict(row)
                plan['statuses'] = plan['statuses'].split('|') if plan['statuses'] else []
                plans.append(plan)
            return plans
        finally:
            conn.close()

    def update_plan(self, plan_id, title, description, statuses=None):
        """Update plan details and optionally statuses."""
        conn = get_connection()
        try:
            if statuses is not None:
                statuses_str = "|".join(statuses)
                conn.execute(
                    "UPDATE plans SET title = ?, description = ?, statuses = ?, updated_at = ? WHERE id = ?",
                    (title, description, statuses_str, _now(), plan_id),
                )
            else:
                conn.execute(
                    "UPDATE plans SET title = ?, description = ?, updated_at = ? WHERE id = ?",
                    (title, description, _now(), plan_id),
                )
            conn.commit()
            return True
        finally:
            conn.close()

    def delete_plan(self, plan_id):
        """Delete a plan and all its tasks (cascading)."""
        conn = get_connection()
        try:
            # Recursively delete all tasks under this plan
            def delete_tasks_recursive(parent_id):
                children = conn.execute(
                    "SELECT id FROM tasks WHERE parent_task_id = ?", (parent_id,)
                ).fetchall()
                for child in children:
                    delete_tasks_recursive(child['id'])
                conn.execute("DELETE FROM tasks WHERE parent_task_id = ?", (parent_id,))
            
            # Get all top-level tasks for this plan
            top_level = conn.execute(
                "SELECT id FROM tasks WHERE plan_id = ? AND parent_task_id IS NULL", (plan_id,)
            ).fetchall()
            
            for task in top_level:
                delete_tasks_recursive(task['id'])
            
            # Delete all tasks for this plan
            conn.execute("DELETE FROM tasks WHERE plan_id = ?", (plan_id,))
            
            # Delete the plan itself
            conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
            conn.commit()
            return True
        finally:
            conn.close()

    # ===== TASKS =====
    def create_task(
        self,
        plan_id,
        title,
        description,
        parent_task_id=None,
        status=None,
        quick_notes=""
    ):
        """Create a new task. Returns the task ID."""
        now = _now()

        plan = self.get_plan_by_id(plan_id)

        if status is None and plan and plan["statuses"]:
            status = plan["statuses"][0]

        conn = get_connection()

        try:
            cur = conn.execute(
                """
                INSERT INTO tasks (
                    plan_id,
                    parent_task_id,
                    title,
                    description,
                    quick_notes,
                    status,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    plan_id,
                    parent_task_id,
                    title,
                    description or "",
                    quick_notes or "",
                    status,
                    now,
                    now,
                ),
            )

            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def get_task_by_id(self, task_id):
        """Get a single task."""
        conn = get_connection()
        try:
            row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_tasks_by_plan(self, plan_id):
        """Get all top-level tasks for a plan (not subtasks)."""
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE plan_id = ? AND parent_task_id IS NULL ORDER BY created_at ASC",
                (plan_id,)
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_subtasks(self, parent_task_id):
        """Get all subtasks of a task."""
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC",
                (parent_task_id,)
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def update_task(
        self,
        task_id,
        title=None,
        description=None,
        status=None,
        quick_notes=None
    ):
        """Update task fields. None means keep the current value."""
        conn = get_connection()

        try:
            current = self.get_task_by_id(task_id)

            if not current:
                return False

            new_title = (
                title if title is not None
                else current["title"]
            )

            new_description = (
                description if description is not None
                else current["description"]
            )

            new_status = (
                status if status is not None
                else current["status"]
            )

            new_quick_notes = (
                quick_notes if quick_notes is not None
                else current["quick_notes"]
            )

            conn.execute(
                """
                UPDATE tasks
                SET
                    title = ?,
                    description = ?,
                    quick_notes = ?,
                    status = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    new_title,
                    new_description,
                    new_quick_notes,
                    new_status,
                    _now(),
                    task_id,
                ),
            )

            conn.commit()
            return True
        finally:
            conn.close()

    def delete_task(self, task_id):
        """Delete a task and all its subtasks (cascading)."""
        conn = get_connection()
        try:
            # Recursively delete all subtasks
            def delete_subtasks_recursive(parent_id):
                children = conn.execute(
                    "SELECT id FROM tasks WHERE parent_task_id = ?", (parent_id,)
                ).fetchall()
                for child in children:
                    delete_subtasks_recursive(child['id'])
                conn.execute("DELETE FROM tasks WHERE parent_task_id = ?", (parent_id,))
            
            delete_subtasks_recursive(task_id)
            conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            conn.commit()
            return True
        finally:
            conn.close()

    def search_tasks(self, plan_id, query):
        """Search tasks in a plan by title or description."""
        conn = get_connection()
        try:
            like = "%" + query + "%"
            rows = conn.execute(
                "SELECT * FROM tasks WHERE plan_id = ? AND (title LIKE ? OR description LIKE ?) ORDER BY created_at ASC",
                (plan_id, like, like),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()
