#!/usr/bin/env python3
"""Tests for tools/HME/scripts/opencode_todo_sync.py."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path

_REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(_REPO / "tools" / "HME" / "scripts"))
sys.path.insert(0, str(_REPO / "tools" / "HME" / "service"))
os.environ.setdefault("PROJECT_ROOT", str(_REPO))
from opencode_todo_sync import sync_latest_opencode_todos  # noqa: E402


def _make_opencode_db(path: Path, todowrite_calls: list[dict]) -> None:
    """Build a minimal opencode.db with the schema the sync queries."""
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE part (
            id TEXT PRIMARY KEY,
            message_id TEXT,
            session_id TEXT,
            time_created INTEGER,
            time_updated INTEGER,
            data TEXT
        )
    """)
    for i, call in enumerate(todowrite_calls):
        conn.execute(
            "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                f"prt_{i}",
                call.get("message_id", f"msg_{i}"),
                call["session_id"],
                call["time_created"],
                call.get("time_updated", call["time_created"]),
                json.dumps({
                    "type": "tool",
                    "tool": "todowrite",
                    "callID": f"call_{i}",
                    "state": {
                        "status": "completed",
                        "input": {"todos": call["todos"]},
                        "output": "ok",
                    },
                }),
            ),
        )
    conn.commit()
    conn.close()


def _sandbox_env(tmp: Path) -> dict:
    return {
        "PROJECT_ROOT": str(tmp),
        "HME_TRANSCRIPT_CACHE_DIR": str(tmp / "cache"),
    }


class OpenCodeTodoSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="hme-opencode-sync-"))
        (self.tmp / "doc" / "templates").mkdir(parents=True, exist_ok=True)
        (self.tmp / "tools" / "HME" / "runtime").mkdir(parents=True, exist_ok=True)
        self._prev_env = {k: os.environ.get(k) for k in _sandbox_env(self.tmp)}
        os.environ.update(_sandbox_env(self.tmp))
        for mod in list(sys.modules):
            if mod.startswith("server.tools_analysis") or mod in ("opencode_todo_sync", "paths"):
                del sys.modules[mod]
        self.db_path = self.tmp / "opencode.db"

    def tearDown(self) -> None:
        for k, v in self._prev_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _todo_md_path(self) -> str:
        return str(self.tmp / "doc" / "templates" / "TODO.md")

    def _todo_md_text(self) -> str:
        return (self.tmp / "doc" / "templates" / "TODO.md").read_text(encoding="utf-8")

    def _sync(self):
        return sync_latest_opencode_todos(db_path=self.db_path, todo_md_path=self._todo_md_path())

    def test_first_sync_imports_all_items(self) -> None:
        _make_opencode_db(self.db_path, [{
            "session_id": "ses_alpha",
            "time_created": 1000,
            "todos": [
                {"content": "alpha-task-1", "status": "pending"},
                {"content": "alpha-task-2", "status": "in_progress"},
            ],
        }])
        result = self._sync()
        self.assertTrue(result["ok"])
        self.assertEqual(result["sessions"], 1)
        self.assertEqual(result["added"], 2)
        md = self._todo_md_text()
        self.assertIn("alpha-task-1", md)
        self.assertIn("alpha-task-2", md)
        self.assertIn("source: opencode", md)
        self.assertIn("opencode_todo_synced_ts:", md)

    def test_idempotent_second_run(self) -> None:
        _make_opencode_db(self.db_path, [{
            "session_id": "ses_beta",
            "time_created": 2000,
            "todos": [{"content": "beta-task", "status": "pending"}],
        }])
        first = self._sync()
        self.assertEqual(first["added"], 1)
        second = self._sync()
        self.assertEqual(second["added"], 0)
        self.assertEqual(second["sessions"], 0)

    def test_latest_call_per_session_wins(self) -> None:
        _make_opencode_db(self.db_path, [
            {"session_id": "ses_gamma", "time_created": 3000,
             "todos": [{"content": "gamma-task", "status": "pending"}]},
            {"session_id": "ses_gamma", "time_created": 4000,
             "todos": [{"content": "gamma-task", "status": "completed"}]},
        ])
        result = self._sync()
        self.assertEqual(result["sessions"], 1)
        md = self._todo_md_text()
        self.assertRegex(md, r"-\s+\[x\]\s+\[E3\]\s+gamma-task\s+#\d+")

    def test_status_update_on_existing_opencode_entry(self) -> None:
        _make_opencode_db(self.db_path, [{
            "session_id": "ses_delta", "time_created": 5000,
            "todos": [{"content": "delta-task", "status": "pending"}],
        }])
        self._sync()
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("prt_after", "msg_after", "ses_delta", 6000, 6000, json.dumps({
                "type": "tool", "tool": "todowrite", "callID": "call_after",
                "state": {"status": "completed",
                          "input": {"todos": [{"content": "delta-task", "status": "completed"}]},
                          "output": "ok"},
            })),
        )
        conn.commit()
        conn.close()
        result = self._sync()
        self.assertEqual(result.get("updated"), 1)
        md = self._todo_md_text()
        self.assertRegex(md, r"-\s+\[x\]\s+\[E3\]\s+delta-task\s+#\d+")

    def test_missing_db_returns_clean_error(self) -> None:
        result = sync_latest_opencode_todos(db_path=self.tmp / "does-not-exist.db")
        self.assertFalse(result["ok"])
        self.assertIn("opencode.db not present", result["message"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
