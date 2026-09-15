"""
events_repo.py
--------------
Calendar events - the SQLite layer.

All times are local wall-clock ISO strings with minute precision
("2026-09-12T15:00"). Repeating events store only the first occurrence; later
ones are generated on read via backend.recurrence.
"""

from datetime import datetime, timedelta

from backend.database import get_connection, ensure_calendar_schema
from backend import recurrence

# Reminders that should already have fired are still worth showing for a short
# grace period (e.g. the app was closed when they were due).
LATE_GRACE_MINUTES = 15

FIELDS = ("id, title, description, starts_at, ends_at, all_day, remind_minutes, "
          "notified_at, snoozed_until, repeat_rule, repeat_until, notified_for, "
          "created_at, updated_at")

# Columns a save is allowed to write.
WRITABLE = ("title", "description", "starts_at", "ends_at", "all_day",
            "remind_minutes", "repeat_rule", "repeat_until")


def now_iso():
    return datetime.now().isoformat(timespec="minutes")


def to_dict(row):
    d = dict(row)
    d["all_day"] = bool(d.get("all_day"))
    d["repeats"] = recurrence.is_recurring(d.get("repeat_rule"))
    d["repeat_text"] = recurrence.describe(d.get("repeat_rule"), d.get("repeat_until"))
    return d


def _duration_minutes(row):
    """How long the stored event lasts, so occurrences keep that length."""
    start = recurrence.parse(row.get("starts_at"))
    end = recurrence.parse(row.get("ends_at"))
    if start is None or end is None:
        return 60
    return int((end - start).total_seconds() // 60)


def _as_occurrence(row, moment):
    """A copy of `row` moved to `moment`, tagged so the UI can tell them apart."""
    d = dict(row)
    d["starts_at"] = moment.isoformat(timespec="minutes")
    if row.get("ends_at"):
        minutes = _duration_minutes(row)
        d["ends_at"] = (moment + timedelta(minutes=minutes)).isoformat(timespec="minutes")
    else:
        d["ends_at"] = None
    d["occurrence_date"] = moment.date().isoformat()
    return d


class EventsRepository:
    def get(self, event_id):
        conn = get_connection()
        try:
            row = conn.execute("SELECT %s FROM events WHERE id = ?" % FIELDS, (event_id,)).fetchone()
            return to_dict(row) if row else None
        finally:
            conn.close()

    def between(self, start, end):
        """Everything happening within [start, end), repeats expanded.

        Non-repeating events are filtered in SQL. Repeating ones must be
        considered whenever they *began* before the window, so they are read
        separately and expanded in Python.
        """
        conn = get_connection()
        try:
            plain = conn.execute(
                "SELECT %s FROM events WHERE (repeat_rule IS NULL OR repeat_rule = 'none') "
                "AND starts_at >= ? AND starts_at < ? ORDER BY starts_at, id" % FIELDS,
                (start, end),
            ).fetchall()
            result = [to_dict(r) for r in plain]

            repeating = conn.execute(
                "SELECT %s FROM events WHERE repeat_rule IS NOT NULL AND repeat_rule != 'none' "
                "AND starts_at < ?" % FIELDS,
                (end,),
            ).fetchall()
            for raw in repeating:
                row = to_dict(raw)
                for moment in recurrence.occurrences(
                    row["starts_at"], row["repeat_rule"], row["repeat_until"], start, end
                ):
                    result.append(_as_occurrence(row, moment))

            result.sort(key=lambda item: (item["starts_at"], item["id"]))
            return result
        finally:
            conn.close()

    def upcoming(self, limit=5, now=None):
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT %s FROM events WHERE starts_at >= ? ORDER BY starts_at, id LIMIT ?" % FIELDS,
                (now or now_iso(), limit),
            ).fetchall()
            return [to_dict(r) for r in rows]
        finally:
            conn.close()

    def due_reminders(self, now=None):
        """Events whose reminder is due and has not fired yet."""
        now = now or now_iso()
        cutoff = (datetime.fromisoformat(now) - timedelta(minutes=LATE_GRACE_MINUTES)).isoformat(timespec="minutes")
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT " + FIELDS + " FROM events "
                "WHERE snoozed_until IS NOT NULL AND snoozed_until <= :now "
                "UNION SELECT " + FIELDS + " FROM events "
                "WHERE remind_minutes IS NOT NULL "
                "  AND notified_at IS NULL "
                "  AND snoozed_until IS NULL "
                "  AND (repeat_rule IS NULL OR repeat_rule = 'none') "
                "  AND starts_at >= :cutoff "
                "  AND datetime(starts_at, '-' || remind_minutes || ' minutes') <= :now "
                "ORDER BY starts_at",
                {"now": now, "cutoff": cutoff},
            ).fetchall()
            result = [to_dict(r) for r in rows]
            result.extend(self._due_repeating(now, cutoff))
            result.sort(key=lambda item: item["starts_at"])
            return result
        finally:
            conn.close()

    def _due_repeating(self, now, cutoff):
        """Reminders for repeating events, one per occurrence.

        The lead time has to be measured against the *next* occurrence, and
        `notified_for` records which occurrence already fired - otherwise a
        daily event would remind once and never again.
        """
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT %s FROM events WHERE remind_minutes IS NOT NULL "
                "  AND snoozed_until IS NULL "
                "  AND repeat_rule IS NOT NULL AND repeat_rule != 'none'" % FIELDS
            ).fetchall()
        finally:
            conn.close()

        out = []
        now_dt = datetime.fromisoformat(now)
        for raw in rows:
            row = to_dict(raw)
            nxt = recurrence.next_occurrence(
                row["starts_at"], row["repeat_rule"], row["repeat_until"], cutoff
            )
            if nxt is None:
                continue
            occurrence_key = nxt.isoformat(timespec="minutes")
            if row.get("notified_for") == occurrence_key:
                continue
            remind_at = nxt - timedelta(minutes=row["remind_minutes"])
            if remind_at <= now_dt:
                out.append(_as_occurrence(row, nxt))
        return out

    def create(self, title, starts_at, ends_at=None, description="", all_day=False,
               remind_minutes=None, repeat_rule=None, repeat_until=None):
        now = datetime.now().isoformat(timespec="seconds")
        conn = get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO events (title, description, starts_at, ends_at, all_day, "
                "remind_minutes, repeat_rule, repeat_until, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (title, description or "", starts_at, ends_at, 1 if all_day else 0,
                 remind_minutes, repeat_rule, repeat_until, now, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def update(self, event_id, **fields):
        data = {k: fields[k] for k in WRITABLE if k in fields}
        if "all_day" in data:
            data["all_day"] = 1 if data["all_day"] else 0
        cols = list(data.keys())
        vals = list(data.values())
        set_clause = ", ".join("%s = ?" % c for c in cols)
        now = datetime.now().isoformat(timespec="seconds")
        # Editing an event resets its reminder so it can fire again.
        sql = ("UPDATE events SET %s, notified_at = NULL, notified_for = NULL, "
               "updated_at = ? WHERE id = ?")
        if set_clause:
            sql = sql % set_clause
        else:
            sql = ("UPDATE events SET notified_at = NULL, notified_for = NULL, "
                   "updated_at = ? WHERE id = ?")
        conn = get_connection()
        try:
            conn.execute(sql, vals + [now, event_id])
            conn.commit()
        finally:
            conn.close()

    def delete(self, event_id):
        conn = get_connection()
        try:
            cur = conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def mark_notified(self, event_id, when=None, occurrence=None):
        """Record that a reminder fired, and clear any snooze it satisfied.

        `occurrence` is the start of the occurrence that fired. For a repeating
        event that is what stops it firing twice for the same day while still
        allowing the next one through.
        """
        when = when or datetime.now().isoformat(timespec="seconds")
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE events SET notified_at = ?, snoozed_until = NULL, "
                "notified_for = COALESCE(?, notified_for) WHERE id = ?",
                (when, occurrence, event_id),
            )
            conn.commit()
        finally:
            conn.close()

    def snooze(self, event_id, minutes):
        """Bring this reminder back in `minutes`."""
        when = (datetime.now() + timedelta(minutes=minutes)).isoformat(timespec="minutes")
        conn = get_connection()
        try:
            conn.execute("UPDATE events SET snoozed_until = ? WHERE id = ?", (when, event_id))
            conn.commit()
        finally:
            conn.close()
