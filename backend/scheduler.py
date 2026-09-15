"""
scheduler.py
------------
Background reminder poller.

The PyQt build fired reminders from a QTimer and pushed them to the page over
a QWebChannel signal. pywebview has neither, so this runs a small daemon
thread that polls the events table and pushes each due reminder into the page
by evaluating JS (window.__paReminder). The page's bridge turns that into the
`calendar.reminderFired` handlers the UI already listens on.

Marking an event notified is what stops it firing again: `notified_at` for a
one-off, `notified_for` (the occurrence that fired) for a repeating series.
"""

import json
import logging
import threading

from backend.events_repo import EventsRepository

log = logging.getLogger(__name__)


class ReminderScheduler:
    def __init__(self, push, interval=30):
        # push: callable(payload_json_string) -> delivers one reminder to the page.
        self._push = push
        self._interval = interval
        self._repo = EventsRepository()
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="reminders", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        # The first tick waits one interval, by which time the window is up.
        while not self._stop.wait(self._interval):
            try:
                self._tick()
            except Exception:  # noqa: BLE001 - a bad tick must not kill the loop
                log.exception("reminder tick failed")

    def _tick(self):
        for event in self._repo.due_reminders():
            try:
                self._push(json.dumps(event))
            except Exception:  # noqa: BLE001 - page may be mid-navigation
                log.exception("failed to push reminder %s", event.get("id"))
                continue
            occurrence = event.get("starts_at") if event.get("repeats") else None
            self._repo.mark_notified(event["id"], occurrence=occurrence)
