"""
api.py
------
This class is exposed to the frontend as `window.pywebview.api`.
Every public method here becomes callable from JavaScript, e.g.:

    await window.pywebview.api.get_todos()

Keep this layer thin: validate input, call database.py, return
plain JSON-serializable data (dicts, lists, strings, numbers, bools).
"""

from backend import database


class Api:
    def get_todos(self):
        return database.get_todos()

    def add_todo(self, title: str):
        title = (title or "").strip()
        if not title:
            return {"error": "Title cannot be empty"}
        new_id = database.add_todo(title)
        return {"id": new_id, "title": title, "done": 0}

    def toggle_todo(self, todo_id: int):
        database.toggle_todo(todo_id)
        return {"status": "ok"}

    def delete_todo(self, todo_id: int):
        database.delete_todo(todo_id)
        return {"status": "ok"}
