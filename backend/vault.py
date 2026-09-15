"""
vault.py
--------
Master-password vault for the credential store.

Faithful re-implementation of the original pan-alisaga crypto so that
credentials encrypted by the previous (PyQt) build stay readable here.

How it works, and why:

* The master password is never stored. A random 16-byte salt and a
  "verifier" - a known marker string encrypted with the derived key - are
  stored instead. Unlocking derives the key and checks that the verifier
  decrypts; a wrong password produces a different key and the authenticated
  decryption fails.
* The key comes from PBKDF2-HMAC-SHA256 over the master password. The
  iteration count is stored per vault, so it can be raised later without
  stranding existing data.
* Secrets are sealed with Fernet (AES-128-CBC plus an HMAC-SHA256 tag), so
  tampering with the database is detected rather than silently decrypted
  into garbage.
* The derived key exists only in this process's memory. Locking drops it,
  and there is deliberately no recovery path: losing the master password
  means losing the secrets.

Fernet and PBKDF2 come from the `cryptography` library and the standard
library respectively - no hand-rolled crypto.
"""

import base64
import hashlib
import os
import secrets
import string

from cryptography.fernet import Fernet, InvalidToken

# --- parameters (must match the on-disk data) --------------------------------
ITERATIONS = 600000
SALT_BYTES = 16
VERIFIER_PLAINTEXT = b"pan-alisaga-vault-v1"

# Password generator alphabets. Ambiguous glyphs (l, I, O, 0, 1) are left out
# on purpose so generated passwords survive being read off a screen.
LOWER = "abcdefghijkmnopqrstuvwxyz"
UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
DIGITS = "23456789"
SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?"


class VaultLocked(Exception):
    """Raised when a secret is touched while the vault is locked."""


class VaultError(Exception):
    """Wrong master password, or a vault that is not set up."""


# --- key handling ------------------------------------------------------------
def derive_key(password, salt, iterations):
    """PBKDF2 -> 32 bytes -> urlsafe base64, which is what Fernet wants."""
    raw = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
    return base64.urlsafe_b64encode(raw)


def new_salt():
    return os.urandom(SALT_BYTES)


def make_verifier(key):
    return Fernet(key).encrypt(VERIFIER_PLAINTEXT)


def check_verifier(key, verifier):
    try:
        return Fernet(key).decrypt(bytes(verifier)) == VERIFIER_PLAINTEXT
    except (InvalidToken, TypeError, ValueError):
        return False


# --- password generation and rating -----------------------------------------
def generate_password(length=20, use_upper=True, use_digits=True, use_symbols=True):
    """A cryptographically random password containing every class asked for."""
    length = max(8, min(128, int(length)))
    pools = [LOWER]
    if use_upper:
        pools.append(UPPER)
    if use_digits:
        pools.append(DIGITS)
    if use_symbols:
        pools.append(SYMBOLS)
    alphabet = "".join(pools)

    # Guarantee at least one character from each requested class...
    chars = [secrets.choice(pool) for pool in pools]
    # ...then fill the rest from the full alphabet.
    while len(chars) < length:
        chars.append(secrets.choice(alphabet))
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars[:length])


def strength(password):
    """A rough score (0-4) plus a label, for feedback in the UI only."""
    if not password:
        return {"score": 0, "label": "Empty"}

    length = len(password)
    kinds = 0
    if any(c in string.ascii_lowercase for c in password):
        kinds += 1
    if any(c in string.ascii_uppercase for c in password):
        kinds += 1
    if any(c in string.digits for c in password):
        kinds += 1
    if any(not c.isalnum() for c in password):
        kinds += 1

    score = 0
    if length >= 8:
        score += 1
    if length >= 12:
        score += 1
    if length >= 16:
        score += 1
    if kinds >= 3:
        score += 1
    score = min(score, 4)

    labels = ("Very weak", "Weak", "Fair", "Strong", "Very strong")
    return {"score": score, "label": labels[score]}


class Vault:
    """Holds the derived key for the session. Never persists it."""

    def __init__(self):
        self._key = None

    @property
    def unlocked(self):
        return self._key is not None

    def unlock_with(self, key):
        self._key = key

    def lock(self):
        self._key = None

    def encrypt(self, text):
        """Returns bytes, or None for an empty value so NULL stays NULL."""
        if text is None or text == "":
            return None
        if self._key is None:
            raise VaultLocked("The vault is locked.")
        return Fernet(self._key).encrypt(text.encode("utf-8"))

    def decrypt(self, blob):
        if blob is None or blob == "" or (isinstance(blob, (bytes, bytearray)) and len(blob) == 0):
            return ""
        if self._key is None:
            raise VaultLocked("The vault is locked.")
        try:
            return Fernet(self._key).decrypt(bytes(blob)).decode("utf-8")
        except (InvalidToken, TypeError, ValueError):
            return ""
