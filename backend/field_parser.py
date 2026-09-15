"""
field_parser.py
---------------
Turn pasted text into credential fields.

Given something like:

    Host: db.example.com
    Port: 5432
    Username: admin
    Password:hunter2

this produces one field per line, and reports which line looked like the
username and which looked like the password, so the entry's main fields can
be filled from the same paste (those two are left OUT of `fields` to avoid
duplication).

Pure Python, no crypto - safe to unit test on its own.
"""

import re

SEPARATORS = (":", "=")

# Strip list bullets / quote markers from the front of a line.
LEADING_JUNK = re.compile(r"^[\s>\|]*(?:[*\-•]\s+)?")
# Strip markdown bold/italic/code markers wrapping a label.
BOLD_MARKS = re.compile(r"^[*_`]+|[*_`]+$")

PASSWORD_HINTS = ("password", "passwd", "pass", "passphrase")
SECRET_HINTS = ("secret", "token", "api key", "apikey", "private key", "pin", "otp", "credential")
USER_HINTS = ("username", "user name", "user", "login", "email", "e-mail", "account", "userid", "user id")

MAX_LABEL_WORDS = 5
MAX_LABEL_CHARS = 40


def _split_line(line):
    """Return (label, value) or None when the line has no usable separator."""
    idx = None
    for sep in SEPARATORS:
        i = line.find(sep)
        if i > 0:
            idx = i if idx is None else min(idx, i)
    if idx is None:
        return None
    label = BOLD_MARKS.sub("", line[:idx]).strip()
    value = line[idx + 1:].strip()
    if not label or len(label) > MAX_LABEL_CHARS:
        return None
    if len(label.split()) > MAX_LABEL_WORDS:
        return None
    return (label, value)


def _matches(label, hints):
    norm = label.lower().strip().rstrip(":").strip()
    for hint in hints:
        if norm == hint or norm.startswith(hint) or norm.endswith(hint):
            return True
    return False


def is_secret_label(label):
    return _matches(label, SECRET_HINTS)


def is_password_label(label):
    return _matches(label, PASSWORD_HINTS)


def is_username_label(label):
    return _matches(label, USER_HINTS) and not is_secret_label(label)


def parse(text):
    """Parse pasted text.

    Returns {"fields": [{label, value, hidden}], "username": str|None,
             "password": str|None}. The username and password lines are
    reported separately AND left out of `fields`, so they can go into the
    entry's own username and password boxes without being duplicated.
    """
    fields = []
    username = None
    password = None
    for raw in text.splitlines():
        line = LEADING_JUNK.sub("", raw).strip()
        if not line:
            continue
        split = _split_line(line)
        if not split:
            continue
        label, value = split
        if password is None and is_password_label(label):
            password = value
            continue
        if username is None and is_username_label(label):
            username = value
            continue
        fields.append({"label": label, "value": value, "hidden": is_secret_label(label)})
    return {"fields": fields, "username": username, "password": password}
