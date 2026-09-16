"""
api.py
------
This class is exposed to the frontend as `window.pywebview.api`.
Every public method here becomes callable from JavaScript, e.g.:

    await window.pywebview.api.get_todos()

Keep this layer thin: validate input, call the backend modules, return
plain JSON-serializable data.

Password-manager methods return a JSON *string* carrying an
{ok, data, error} envelope, matching what frontend/js/bridge.js unwraps.
Methods that start with "_" are treated as private by pywebview and are not
exposed to the page.
"""

import json
import logging

from backend import database
from backend import vault as vaultlib
from backend import field_parser
from backend import recurrence
from backend.credentials_repo import CredentialsRepository, VaultRepository
from backend.events_repo import EventsRepository
from backend.notes_repo import NotesRepository
from backend.checklist_repo import ChecklistRepository
from backend.tasks_repo import TasksRepository

tasks_repo = TasksRepository()

log = logging.getLogger(__name__)

# How long a copied password lingers on the clipboard before the page wipes
# it, and how long the vault may sit idle before the page locks it.
CLIPBOARD_CLEAR_SECONDS = 20
VAULT_AUTOLOCK_MINUTES = 15


def _ok(data=None):
    return json.dumps({"ok": True, "data": data})


def _error(message):
    return json.dumps({"ok": False, "error": str(message)})


def _clean_fields(raw):
    """Keep only well formed {label, value, hidden} entries.

    A field needs a label or a value to be worth storing; blank rows left
    behind in the form are dropped rather than saved as empty noise.
    """
    out = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", "")).strip()
        value = str(item.get("value", ""))
        if not label and not value.strip():
            continue
        out.append({"label": label or "Field", "value": value, "hidden": bool(item.get("hidden"))})
    return out


class Api:
    def __init__(self):
        self._meta = VaultRepository()
        self._repo = CredentialsRepository()
        self._vault = vaultlib.Vault()
        self._events = EventsRepository()
        self._notes = NotesRepository()
        self._checklists = ChecklistRepository()

    # --- home demo ------------------------------------------------------
    def greet(self, name):
        name = (name or "stranger").strip() or "stranger"
        return "Hello, %s! Python is talking to the page over pywebview." % name

    # --- todos (original scaffold) --------------------------------------
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

    # --- password vault -------------------------------------------------
    def _require_unlocked(self):
        if not self._vault.unlocked:
            raise vaultlib.VaultLocked("The vault is locked.")

    def _read_fields(self, row):
        blob = row["fields"] if "fields" in row.keys() else None
        if not blob:
            return []
        try:
            return _clean_fields(json.loads(self._vault.decrypt(blob)))
        except (ValueError, TypeError):
            return []

    def vault_status(self):
        try:
            return _ok({
                "exists": self._meta.exists(),
                "unlocked": self._vault.unlocked,
                "count": self._repo.count(),
                "autolockMinutes": VAULT_AUTOLOCK_MINUTES,
            })
        except Exception as exc:  # noqa: BLE001 - report, don't crash the UI
            log.exception("vault status failed")
            return _error(exc)

    def vault_create(self, master):
        """Set up a new vault. Refuses if one already exists."""
        try:
            if self._meta.exists():
                return _error("A vault already exists.")
            if len(master or "") < 8:
                return _error("The master password must be at least 8 characters.")
            salt = vaultlib.new_salt()
            key = vaultlib.derive_key(master, salt, vaultlib.ITERATIONS)
            self._meta.create(salt, vaultlib.make_verifier(key), vaultlib.ITERATIONS)
            self._vault.unlock_with(key)
            return _ok({"unlocked": True})
        except Exception as exc:  # noqa: BLE001
            log.exception("vault create failed")
            return _error(exc)

    def vault_unlock(self, master):
        try:
            meta = self._meta.get()
            if not meta:
                return _error("No vault has been set up yet.")
            key = vaultlib.derive_key(master or "", meta["salt"], meta["iterations"])
            if not vaultlib.check_verifier(key, meta["verifier"]):
                return _error("Incorrect master password.")
            self._vault.unlock_with(key)
            return _ok({"unlocked": True})
        except Exception as exc:  # noqa: BLE001
            log.exception("vault unlock failed")
            return _error(exc)

    def vault_lock(self):
        self._vault.lock()
        return _ok({"unlocked": False})

    def vault_ping(self):
        """Called by the page on activity, to hold off the auto-lock."""
        return _ok({"unlocked": self._vault.unlocked})

    def vault_list(self):
        """Metadata only. Secrets need an explicit reveal."""
        try:
            self._require_unlocked()
            items = []
            for row in self._repo.all():
                items.append({
                    "id": row["id"],
                    "title": row["title"],
                    "username": self._vault.decrypt(row["username"]),
                    "url": self._vault.decrypt(row["url"]),
                    "has_notes": bool(row["notes"]),
                    "field_count": len(self._read_fields(row)),
                    "updated_at": row["updated_at"],
                })
            return _ok(items)
        except vaultlib.VaultLocked as exc:
            return _error(exc)
        except Exception as exc:  # noqa: BLE001
            log.exception("vault list failed")
            return _error(exc)

    def vault_reveal(self, credential_id):
        try:
            self._require_unlocked()
            row = self._repo.get(int(credential_id))
            if row is None:
                return _error("That entry no longer exists.")
            secret = self._vault.decrypt(row["secret"])
            return _ok({
                "id": row["id"],
                "secret": secret,
                "notes": self._vault.decrypt(row["notes"]),
                "fields": self._read_fields(row),
                "strength": vaultlib.strength(secret),
            })
        except vaultlib.VaultLocked as exc:
            return _error(exc)
        except Exception as exc:  # noqa: BLE001
            log.exception("vault reveal failed")
            return _error(exc)

    def vault_copy(self, credential_id):
        """Return the secret so the page can put it on the clipboard and wipe
        it again after a short delay. (The original used the Qt clipboard on
        the Python side; pywebview has no clipboard API, so the copy + timed
        clear happen in the page via navigator.clipboard.)"""
        try:
            self._require_unlocked()
            row = self._repo.get(int(credential_id))
            if row is None:
                return _error("That entry no longer exists.")
            return _ok({"seconds": CLIPBOARD_CLEAR_SECONDS, "secret": self._vault.decrypt(row["secret"])})
        except vaultlib.VaultLocked as exc:
            return _error(exc)
        except Exception as exc:  # noqa: BLE001
            log.exception("vault copy failed")
            return _error(exc)

    def vault_save(self, payload):
        try:
            self._require_unlocked()
            data = json.loads(payload)
            title = (data.get("title") or "").strip()
            if not title:
                return _error("A name is required.")
            secret = data.get("secret")
            entry_id = data.get("id")
            if not entry_id and not secret:
                return _error("A password is required.")

            # On edit, a blank password means "keep the current one".
            if entry_id and not secret:
                existing = self._repo.get(int(entry_id))
                if existing is None:
                    return _error("That entry no longer exists.")
                sealed_secret = existing["secret"]
            else:
                sealed_secret = self._vault.encrypt(secret)

            username = self._vault.encrypt(data.get("username") or "")
            url = self._vault.encrypt(data.get("url") or "")
            notes = self._vault.encrypt(data.get("notes") or "")
            cleaned = _clean_fields(data.get("fields"))
            fields_blob = self._vault.encrypt(json.dumps(cleaned)) if cleaned else None

            if entry_id:
                self._repo.update(int(entry_id), title, username, sealed_secret, url, notes, fields_blob)
                new_id = int(entry_id)
            else:
                new_id = self._repo.create(title, username, sealed_secret, url, notes, fields_blob)
            return _ok({"id": new_id, "fields": cleaned})
        except vaultlib.VaultLocked as exc:
            return _error(exc)
        except Exception as exc:  # noqa: BLE001
            log.exception("vault save failed")
            return _error(exc)

    def vault_remove(self, credential_id):
        try:
            self._require_unlocked()
            self._repo.delete(int(credential_id))
            return _ok({"removed": True})
        except vaultlib.VaultLocked as exc:
            return _error(exc)
        except Exception as exc:  # noqa: BLE001
            log.exception("vault remove failed")
            return _error(exc)

    def vault_generate(self, payload):
        try:
            data = json.loads(payload) if payload else {}
            password = vaultlib.generate_password(
                length=data.get("length", 20),
                use_upper=data.get("use_upper", True),
                use_digits=data.get("use_digits", True),
                use_symbols=data.get("use_symbols", True),
            )
            return _ok({"password": password})
        except Exception as exc:  # noqa: BLE001
            log.exception("vault generate failed")
            return _error(exc)

    def vault_parse_fields(self, text):
        try:
            return _ok(field_parser.parse(text or ""))
        except Exception as exc:  # noqa: BLE001
            log.exception("vault parseFields failed")
            return _error(exc)

    def vault_rate(self, text):
        try:
            return _ok(vaultlib.strength(text or ""))
        except Exception as exc:  # noqa: BLE001
            log.exception("vault rate failed")
            return _error(exc)

    # --- calendar & scheduling ------------------------------------------
    def calendar_list_events(self, start, end):
        try:
            return _ok(self._events.between(start, end))
        except Exception as exc:  # noqa: BLE001
            log.exception("listEvents failed")
            return _error(exc)

    def calendar_repeat_rules(self):
        """The repeat options the form offers, described once in recurrence.py."""
        return _ok({"rules": list(recurrence.RULES)})

    def calendar_upcoming(self, limit=5):
        try:
            return _ok(self._events.upcoming(limit))
        except Exception as exc:  # noqa: BLE001
            log.exception("upcoming failed")
            return _error(exc)

    def calendar_save_event(self, payload):
        """Create when there is no id, update when there is."""
        try:
            data = json.loads(payload)
            title = (data.get("title") or "").strip()
            if not title:
                return _error("Title is required.")
            starts_at = data.get("starts_at")
            if not starts_at:
                return _error("Start time is required.")
            ends_at = data.get("ends_at") or None
            if ends_at and ends_at < starts_at:
                return _error("End time cannot be before the start time.")

            remind = data.get("remind_minutes")
            remind = None if remind in (None, "", "none") else int(remind)

            repeat_rule = data.get("repeat_rule") or "none"
            repeat_until = data.get("repeat_until") or None
            if repeat_until and repeat_until[:10] < starts_at[:10]:
                return _error("The repeat end date is before the event starts.")

            fields = {
                "title": title,
                "description": data.get("description") or "",
                "starts_at": starts_at,
                "ends_at": ends_at,
                "all_day": bool(data.get("all_day")),
                "remind_minutes": remind,
                "repeat_rule": repeat_rule,
                "repeat_until": repeat_until,
            }

            event_id = data.get("id")
            if event_id:
                self._events.update(int(event_id), **fields)
                saved_id = int(event_id)
            else:
                saved_id = self._events.create(**fields)
            return _ok({"id": saved_id})
        except Exception as exc:  # noqa: BLE001
            log.exception("saveEvent failed")
            return _error(exc)

    def calendar_delete_event(self, event_id):
        try:
            self._events.delete(int(event_id))
            return _ok({"deleted": True})
        except Exception as exc:  # noqa: BLE001
            log.exception("deleteEvent failed")
            return _error(exc)

    def calendar_snooze(self, event_id, minutes):
        try:
            self._events.snooze(int(event_id), int(minutes))
            return _ok({"snoozed": True})
        except Exception as exc:  # noqa: BLE001
            log.exception("snooze failed")
            return _error(exc)

    # --- notes ----------------------------------------------------------
    # These mirror the original `backend` bridge: camelCase names and a
    # {"success": ...} JSON envelope (not the vault's {ok,data,error}).
    def createNote(self, title, content, imageData=""):
        try:
            note_id = self._notes.create(title, content, imageData or "")
            return json.dumps({"success": True, "id": note_id})
        except Exception as exc:  # noqa: BLE001
            log.exception("createNote failed")
            return json.dumps({"success": False, "error": str(exc)})

    def updateNote(self, noteId, title, content, imageData=""):
        try:
            ok = self._notes.update(int(noteId), title, content, imageData or "")
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("updateNote failed")
            return json.dumps({"success": False, "error": str(exc)})

    def deleteNote(self, noteId):
        try:
            ok = self._notes.delete(int(noteId))
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("deleteNote failed")
            return json.dumps({"success": False, "error": str(exc)})

    def getAllNotes(self):
        try:
            return json.dumps({"success": True, "notes": self._notes.get_all()})
        except Exception as exc:  # noqa: BLE001
            log.exception("getAllNotes failed")
            return json.dumps({"success": False, "error": str(exc), "notes": []})

    # --- checklists -----------------------------------------------------
    # camelCase names + {"success": ...} envelope, matching the `backend` bridge.
    def createChecklist(self, title, description=""):
        try:
            cid = self._checklists.create_checklist(title, description or "")
            return json.dumps({"success": True, "id": cid})
        except Exception as exc:  # noqa: BLE001
            log.exception("createChecklist failed")
            return json.dumps({"success": False, "error": str(exc)})

    def getAllChecklists(self):
        try:
            return json.dumps({"success": True, "checklists": self._checklists.get_all_checklists()})
        except Exception as exc:  # noqa: BLE001
            log.exception("getAllChecklists failed")
            return json.dumps({"success": False, "error": str(exc), "checklists": []})

    def getChecklist(self, checklistId):
        try:
            checklist = self._checklists.get_checklist_by_id(int(checklistId))
            if not checklist:
                return json.dumps({"success": False, "error": "Checklist not found"})
            checklist["items"] = self._checklists.get_items(int(checklistId))
            checklist["stats"] = self._checklists.get_completion_stats(int(checklistId))
            return json.dumps({"success": True, "checklist": checklist})
        except Exception as exc:  # noqa: BLE001
            log.exception("getChecklist failed")
            return json.dumps({"success": False, "error": str(exc)})

    def updateChecklist(self, checklistId, title, description=""):
        try:
            ok = self._checklists.update_checklist(int(checklistId), title, description or "")
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("updateChecklist failed")
            return json.dumps({"success": False, "error": str(exc)})

    def deleteChecklist(self, checklistId):
        try:
            ok = self._checklists.delete_checklist(int(checklistId))
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("deleteChecklist failed")
            return json.dumps({"success": False, "error": str(exc)})

    def duplicateChecklist(self, checklistId):
        try:
            new_id = self._checklists.duplicate_checklist(int(checklistId))
            if not new_id:
                return json.dumps({"success": False, "error": "Checklist not found"})
            return json.dumps({"success": True, "id": new_id})
        except Exception as exc:  # noqa: BLE001
            log.exception("duplicateChecklist failed")
            return json.dumps({"success": False, "error": str(exc)})

    def createItem(self, checklistId, title, description=""):
        try:
            iid = self._checklists.create_item(int(checklistId), title, description or "")
            return json.dumps({"success": True, "id": iid})
        except Exception as exc:  # noqa: BLE001
            log.exception("createItem failed")
            return json.dumps({"success": False, "error": str(exc)})

    def createItemAt(self, checklistId, title, description="", position=None):
        try:
            iid = self._checklists.create_item(int(checklistId), title, description or "", int(position))
            return json.dumps({"success": True, "id": iid})
        except Exception as exc:  # noqa: BLE001
            log.exception("createItemAt failed")
            return json.dumps({"success": False, "error": str(exc)})

    def updateItem(self, itemId, title, description=""):
        try:
            ok = self._checklists.update_item(int(itemId), title, description or "")
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("updateItem failed")
            return json.dumps({"success": False, "error": str(exc)})

    def toggleItem(self, itemId, completed):
        try:
            ok = self._checklists.toggle_item(int(itemId), bool(completed))
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("toggleItem failed")
            return json.dumps({"success": False, "error": str(exc)})

    def deleteItem(self, itemId):
        try:
            ok = self._checklists.delete_item(int(itemId))
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("deleteItem failed")
            return json.dumps({"success": False, "error": str(exc)})

    def reorderItems(self, checklistId, itemIdJson):
        try:
            ids = json.loads(itemIdJson)
            ok = self._checklists.reorder_items(ids)
            return json.dumps({"success": bool(ok)})
        except Exception as exc:  # noqa: BLE001
            log.exception("reorderItems failed")
            return json.dumps({"success": False, "error": str(exc)})

    def clearCompleted(self, checklistId):
        try:
            deleted = self._checklists.clear_completed(int(checklistId))
            return json.dumps({"success": True, "deleted": deleted})
        except Exception as exc:  # noqa: BLE001
            log.exception("clearCompleted failed")
            return json.dumps({"success": False, "error": str(exc)})

        
    # --- tasks / task plans --------------------------------------------

    def create_plan(self, title, description, statuses=None):
        """Create a new plan. statuses is a list like ['Not Started', 'In Progress', ...]"""
        plan_id = tasks_repo.create_plan(title, description, statuses)
        return {"id": plan_id, "success": True}


    def get_plan(self, plan_id):
        """Get a plan by ID."""
        plan = tasks_repo.get_plan_by_id(plan_id)
        return plan or {}


    def get_all_plans(self):
        """Get all plans."""
        return tasks_repo.get_all_plans()


    def update_plan(self, plan_id, title, description, statuses=None):
        """Update a plan's title, description, and optionally its statuses."""
        tasks_repo.update_plan(plan_id, title, description, statuses)
        return {"success": True}


    def delete_plan(self, plan_id):
        """Delete a plan and all its tasks."""
        tasks_repo.delete_plan(plan_id)
        return {"success": True}


    # ===== TASK ENDPOINTS =====

    def create_task(self, plan_id, title, description, parent_task_id=None):
        """Create a new task (or subtask if parent_task_id is set)."""
        task_id = tasks_repo.create_task(plan_id, title, description, parent_task_id)
        return {"id": task_id, "success": True}


    def get_task(self, task_id):
        """Get a task by ID."""
        task = tasks_repo.get_task_by_id(task_id)
        return task or {}


    def get_plan_tasks(self, plan_id):
        """Get all top-level tasks for a plan."""
        return tasks_repo.get_tasks_by_plan(plan_id)


    def get_task_subtasks(self, task_id):
        """Get all subtasks of a task."""
        return tasks_repo.get_subtasks(task_id)


    def update_task(self, task_id, title=None, description=None, status=None):
        """Update a task. Pass None to leave a field unchanged."""
        tasks_repo.update_task(task_id, title, description, status)
        return {"success": True}


    def delete_task(self, task_id):
        """Delete a task and all its subtasks."""
        tasks_repo.delete_task(task_id)
        return {"success": True}


    def search_tasks(self, plan_id, query):
        """Search tasks in a plan."""
        return tasks_repo.search_tasks(plan_id, query)
