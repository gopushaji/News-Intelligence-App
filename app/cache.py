"""Tiny persistent key-value cache (SQLite) for triage and deep-read results."""

import json
import os
import sqlite3
import threading
import time


def _default_path():
    if os.environ.get("CACHE_PATH"):
        return os.environ["CACHE_PATH"]
    # Azure App Service persists /home across restarts (same mount ChromaDB uses)
    if os.path.isdir("/home"):
        return "/home/news_cache.db"
    return "news_cache.db"


CACHE_PATH = _default_path()
_lock = threading.Lock()


def _conn():
    conn = sqlite3.connect(CACHE_PATH, timeout=10)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache ("
        "key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at REAL NOT NULL)"
    )
    return conn


def get(key, max_age_seconds=None):
    """Return the cached value for key, or None if absent, expired, or unreadable."""
    try:
        with _lock:
            conn = _conn()
            try:
                row = conn.execute(
                    "SELECT value, created_at FROM cache WHERE key = ?", (key,)
                ).fetchone()
            finally:
                conn.close()
        if not row:
            return None
        value, created_at = row
        if max_age_seconds is not None and time.time() - created_at > max_age_seconds:
            return None
        return json.loads(value)
    except Exception:
        return None


def set(key, value):
    """Store a JSON-serializable value. Cache failures never break the request."""
    try:
        payload = json.dumps(value)
        with _lock:
            conn = _conn()
            try:
                with conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO cache (key, value, created_at) "
                        "VALUES (?, ?, ?)",
                        (key, payload, time.time()),
                    )
            finally:
                conn.close()
    except Exception:
        pass
