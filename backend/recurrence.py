"""
recurrence.py
-------------
Repeating calendar events.

Only the first event is stored. Later occurrences are generated when a date
range is asked for, which keeps one edit able to change the whole series and
avoids writing thousands of rows for "every weekday until December".

Rules kept deliberately small - they cover what a personal calendar needs
without becoming a partial RFC 5545 implementation:

    daily     every day
    weekdays  Monday to Friday
    weekly    the same weekday each week
    monthly   the same day number each month

Two decisions worth knowing:

* A monthly series skips months with no such day. "The 31st" happens in
  January and March but not in February, and quietly moving it to the 28th
  would put the event on a day nobody chose.
* A weekday series that starts on a weekend begins on the following Monday,
  since "every weekday" cannot mean Saturday.

All times are local wall-clock ISO strings, as everywhere else in the app.
"""

from datetime import datetime, timedelta

RULES = [
    {"id": "none", "label": "Does not repeat"},
    {"id": "daily", "label": "Every day"},
    {"id": "weekdays", "label": "Every weekday (Mon-Fri)"},
    {"id": "weekly", "label": "Every week"},
    {"id": "monthly", "label": "Every month"},
]
VALID_RULES = ("daily", "weekdays", "weekly", "monthly")

# A hard cap so a malformed series can never loop forever.
MAX_OCCURRENCES = 1000


def is_recurring(rule):
    return rule in VALID_RULES


def parse(value):
    """ISO date or date-time -> datetime. None for anything unusable."""
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _end_of_day(value):
    """`until` is a date and is inclusive, so the whole of that day counts."""
    if not value:
        return None
    parsed = parse(value)
    if parsed is None:
        return None
    if len(str(value)) <= 10:  # a bare date, "YYYY-MM-DD"
        return parsed.replace(hour=23, minute=59, second=59)
    return parsed


def _add_months(moment, count):
    """Same day number `count` months on, or None if that month is short."""
    month = moment.month - 1 + count
    year = moment.year + month // 12
    month = month % 12 + 1
    try:
        return moment.replace(year=year, month=month)
    except ValueError:
        return None


def _next_weekday(moment):
    while moment.weekday() > 4:
        moment += timedelta(days=1)
    return moment


def _iterate(first, rule):
    """Yield occurrences from `first` onward, without end.

    A generator rather than an nth-occurrence function: stepping forward once
    per occurrence is linear, where recomputing the nth each time is not.
    """
    if rule == "daily":
        moment = first
        while True:
            yield moment
            moment += timedelta(days=1)
    elif rule == "weekly":
        moment = first
        while True:
            yield moment
            moment += timedelta(weeks=1)
    elif rule == "weekdays":
        moment = _next_weekday(first)
        while True:
            yield moment
            moment = _next_weekday(moment + timedelta(days=1))
    elif rule == "monthly":
        index = 0
        while True:
            moment = _add_months(first, index)
            index += 1
            if moment is not None:
                yield moment


def _seed(first, rule, threshold):
    """An occurrence at or shortly before `threshold`, to start iterating from.

    Without this, a daily series begun years ago would exhaust
    MAX_OCCURRENCES long before reaching the window being asked about, and
    would simply vanish from the calendar.
    """
    if threshold is None or threshold <= first:
        return first

    if rule == "daily":
        return first + timedelta(days=max(0, (threshold.date() - first.date()).days))
    if rule == "weekly":
        weeks = max(0, (threshold.date() - first.date()).days // 7)
        return first + timedelta(weeks=weeks)
    if rule == "weekdays":
        base = _next_weekday(first)
        weeks = max(0, (threshold.date() - base.date()).days // 7)
        return base + timedelta(weeks=weeks)
    if rule == "monthly":
        months = (threshold.year - first.year) * 12 + (threshold.month - first.month)
        while months > 0:
            candidate = _add_months(first, months)
            if candidate is not None:
                return candidate
            months -= 1
        return first
    return first


def occurrences(start, rule, until, range_start, range_end):
    """Every occurrence starting inside [range_start, range_end).

    `start`, `range_start` and `range_end` are ISO strings; `until` is an
    inclusive ISO date, or None for open-ended.
    """
    first = parse(start)
    window_start = parse(range_start)
    window_end = parse(range_end)
    if first is None or window_start is None or window_end is None:
        return []

    if not is_recurring(rule):
        if window_start <= first < window_end:
            return [first]
        return []

    limit = _end_of_day(until)
    found = []
    seen = 0
    for moment in _iterate(_seed(first, rule, window_start), rule):
        seen += 1
        if seen > MAX_OCCURRENCES:
            return found
        if moment >= window_end:
            return found
        if limit is not None and moment > limit:
            return found
        if moment >= window_start:
            found.append(moment)
    return found


def next_occurrence(start, rule, until, after):
    """The first occurrence at or after `after`, or None when the series ends.

    Used by the reminder scheduler, which needs to know when a repeating
    event happens next rather than when it first happened.
    """
    first = parse(start)
    threshold = parse(after)
    if first is None or threshold is None:
        return None

    if not is_recurring(rule):
        return first if first >= threshold else None

    limit = _end_of_day(until)
    seen = 0
    for moment in _iterate(_seed(first, rule, threshold), rule):
        seen += 1
        if seen > MAX_OCCURRENCES:
            return None
        if limit is not None and moment > limit:
            return None
        if moment >= threshold:
            return moment
    return None


def describe(rule, until):
    """A short human summary for the UI."""
    if not is_recurring(rule):
        return ""
    labels = {
        "daily": "Every day",
        "weekdays": "Every weekday",
        "weekly": "Every week",
        "monthly": "Every month",
    }
    text = labels.get(rule, "Repeats")
    if until:
        text += " until " + str(until)[:10]
    return text
