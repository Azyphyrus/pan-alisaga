"""
credentials_repo.py
-------------------
Vault metadata and stored credentials - the SQLite layer.

This layer never sees a plaintext secret or the master password: it stores
and returns ciphertext blobs. Encryption belongs to backend.vault, so there
is exactly one place where crypto happens.

Column layout (see backend.database for the CREATE statements):

    vault:        id=1, salt BLOB, verifier BLOB, iterations INT, timestamps
    credentials:  id, title TEXT (plaintext), username/secret/url/notes/fields
                  BLOB (Fernet ciphertext, NULL when empty), timestamps
"""

import sqlite3
from datetime import datetime

from backend.database import get_connection, ensure_vault_schema

FIELDS = "id, title, username, secret, url, notes, fields, created_at, updated_at"


def _now():
    return datetime.now().isoformat(timespec="seconds")


class VaultRepository:
    """The single row describing how this vault is keyed."""

    def _read(self):
        conn = get_connection()
        try:
            return conn.execute(
                "SELECT salt, verifier, iterations FROM vault WHERE id = 1"
            ).fetchone()
        finally:
            conn.close()

    def get(self):
        try:
            row = self._read()
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                ensure_vault_schema()
                row = self._read()
            else:
                raise
        if row is None:
            return None
        return {
            "salt": bytes(row["salt"]),
            "verifier": bytes(row["verifier"]),
            "iterations": row["iterations"],
        }

    def exists(self):
        return self.get() is not None

    def create(self, salt, verifier, iterations):
        now = _now()
        conn = get_connection()
        try:
            conn.execute(
                "INSERT INTO vault (id, salt, verifier, iterations, created_at, updated_at)"
                " VALUES (1, ?, ?, ?, ?, ?)",
                (salt, verifier, iterations, now, now),
            )
            conn.commit()
        finally:
            conn.close()

    def replace(self, salt, verifier, iterations):
        """Used when the master password changes."""
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE vault SET salt = ?, verifier = ?, iterations = ?, updated_at = ? WHERE id = 1",
                (salt, verifier, iterations, _now()),
            )
            conn.commit()
        finally:
            conn.close()


class CredentialsRepository:
    def all(self):
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT %s FROM credentials ORDER BY title COLLATE NOCASE, id" % FIELDS
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get(self, credential_id):
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT %s FROM credentials WHERE id = ?" % FIELDS, (credential_id,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def create(self, title, username, secret, url, notes, fields):
        now = _now()
        conn = get_connection()
        try:
            cur = conn.execute(
                "INSERT INTO credentials (title, username, secret, url, notes, fields, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (title, username, secret, url, notes, fields, now, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()

    def update(self, credential_id, title, username, secret, url, notes, fields):
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE credentials SET title = ?, username = ?, secret = ?, url = ?, notes = ?,"
                " fields = ?, updated_at = ? WHERE id = ?",
                (title, username, secret, url, notes, fields, _now(), credential_id),
            )
            conn.commit()
        finally:
            conn.close()

    def delete(self, credential_id):
        conn = get_connection()
        try:
            cur = conn.execute("DELETE FROM credentials WHERE id = ?", (credential_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def count(self):
        conn = get_connection()
        try:
            try:
                return conn.execute("SELECT count(*) FROM credentials").fetchone()[0]
            except sqlite3.OperationalError as exc:
                if "no such table" in str(exc).lower():
                    ensure_vault_schema()
                    return 0
                raise
        finally:
            conn.close()
