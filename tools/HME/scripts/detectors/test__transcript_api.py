"""API-stability tests for _transcript.py.

The architectural review surfaced _transcript.py as the single load-bearing-
but-fragile file in the HME detector chain: imported by 9 detectors plus
the consolidator, with subtly different boundary semantics across helpers
(load_turn_events vs load_full_turn_with_user vs last_assistant_event).
The historical "dual-shape is_assistant" bug silently disabled 5 detectors
for months — a regression that should have been caught by tests.

These tests exercise both real Claude Code transcript shapes AND the
test-fixture shape, so any future refactor that drops one form fails
loudly. Tests focus on contracts, not implementation:

  - is_assistant / is_user accept both type=assistant and role=assistant
  - event_content returns a list across both shapes
  - load_turn_events boundary == "after the last user message"
  - load_full_turn_with_user includes the triggering user message
  - last_assistant_event aligns with load_turn_events boundary semantics
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transcript import (
    is_assistant, is_user, event_content,
    load_turn_events, load_full_turn_with_user,
    iter_tool_uses, last_assistant_event,
)


def _fixture_user(text: str) -> dict:
    return {"type": "user", "message": {"content": [{"type": "text", "text": text}]}}


def _fixture_assistant(text: str = "", tool_use: dict | None = None) -> dict:
    content = []
    if text:
        content.append({"type": "text", "text": text})
    if tool_use:
        content.append({"type": "tool_use", **tool_use})
    return {"type": "assistant", "message": {"content": content}}


def _legacy_user(text: str) -> dict:
    """Test-fixture-shape user event (role at top level, content too)."""
    return {"role": "user", "content": [{"type": "text", "text": text}]}


def _legacy_assistant(text: str = "") -> dict:
    return {"role": "assistant", "content": [{"type": "text", "text": text}]}


def _write_jsonl(events: list[dict]) -> str:
    fd, path = tempfile.mkstemp(suffix=".jsonl",
                                dir=os.environ.get("PROJECT_ROOT", "/tmp"),
                                prefix="ts_api_")
    with os.fdopen(fd, "w") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")
    return path


class IsAssistantContract(unittest.TestCase):
    def test_real_shape(self):
        self.assertTrue(is_assistant(_fixture_assistant("hi")))

    def test_legacy_fixture_shape(self):
        # Historical regression: detectors checked only this shape and
        # got False on every real event. Both forms must work.
        self.assertTrue(is_assistant(_legacy_assistant("hi")))

    def test_user_event_is_not_assistant(self):
        self.assertFalse(is_assistant(_fixture_user("hi")))
        self.assertFalse(is_assistant(_legacy_user("hi")))


class IsUserContract(unittest.TestCase):
    def test_real_shape(self):
        self.assertTrue(is_user(_fixture_user("hi")))

    def test_legacy_fixture_shape(self):
        self.assertTrue(is_user(_legacy_user("hi")))

    def test_assistant_is_not_user(self):
        self.assertFalse(is_user(_fixture_assistant("hi")))


class EventContentContract(unittest.TestCase):
    def test_returns_list_for_real_shape(self):
        ev = _fixture_assistant("body")
        c = event_content(ev)
        self.assertIsInstance(c, list)
        self.assertEqual(c[0]["type"], "text")

    def test_returns_list_for_legacy_shape(self):
        ev = _legacy_assistant("body")
        c = event_content(ev)
        self.assertIsInstance(c, list)
        self.assertEqual(c[0]["type"], "text")

    def test_returns_empty_list_on_no_content(self):
        self.assertEqual(event_content({}), [])
        self.assertEqual(event_content({"type": "user"}), [])


class LoadTurnEventsBoundary(unittest.TestCase):
    """Contract: load_turn_events returns events AFTER the last user message."""

    def test_strips_user_returns_only_assistant_tail(self):
        path = _write_jsonl([
            _fixture_user("first"),
            _fixture_assistant("reply 1"),
            _fixture_user("second"),
            _fixture_assistant("reply 2"),
        ])
        try:
            events = load_turn_events(path)
            self.assertEqual(len(events), 1)
            self.assertTrue(is_assistant(events[0]))
        finally:
            os.unlink(path)

    def test_no_user_returns_all(self):
        path = _write_jsonl([_fixture_assistant("standalone")])
        try:
            events = load_turn_events(path)
            self.assertEqual(len(events), 1)
        finally:
            os.unlink(path)


class LoadFullTurnContract(unittest.TestCase):
    """Contract: load_full_turn_with_user INCLUDES the triggering user."""

    def test_includes_triggering_user(self):
        path = _write_jsonl([
            _fixture_user("old turn"),
            _fixture_assistant("old reply"),
            _fixture_user("current"),
            _fixture_assistant("current reply"),
        ])
        try:
            events = load_full_turn_with_user(path)
            # Should start with the LAST user message
            self.assertEqual(len(events), 2)
            self.assertTrue(is_user(events[0]))
            self.assertTrue(is_assistant(events[1]))
        finally:
            os.unlink(path)


class LastAssistantEventContract(unittest.TestCase):
    """last_assistant_event returns the most recent assistant event.

    Peer-review iter 110 caught that the prior implementation early-
    returned on the first user-after-assistant, returning the OLDEST
    completed assistant in a multi-turn transcript rather than the most
    recent — silently evaluating the wrong turn in stop_work detection.
    These tests pin the fix so a future "cleanup" can't silently
    regress the semantic.
    """

    def test_returns_newest_assistant_across_multiple_turns(self):
        path = _write_jsonl([
            _fixture_user("turn 1 prompt"),
            _fixture_assistant("turn 1 reply"),
            _fixture_user("turn 2 prompt"),
            _fixture_assistant("turn 2 reply"),
        ])
        try:
            ev = last_assistant_event(path)
            self.assertIsNotNone(ev)
            content = ev.get("message", {}).get("content", [])
            text = content[0].get("text", "") if content else ""
            self.assertEqual(text, "turn 2 reply",
                             "must return the MOST RECENT assistant, "
                             "not the first completed turn")
        finally:
            os.unlink(path)

    def test_returns_none_on_empty_transcript(self):
        path = _write_jsonl([])
        try:
            self.assertIsNone(last_assistant_event(path))
        finally:
            os.unlink(path)

    def test_returns_none_when_no_assistant_events(self):
        path = _write_jsonl([_fixture_user("prompt only")])
        try:
            self.assertIsNone(last_assistant_event(path))
        finally:
            os.unlink(path)

    def test_handles_trailing_user_without_response(self):
        # Transcript captured mid-turn: [user, asst, user] (next reply
        # hasn't arrived). Should return asst, not None.
        path = _write_jsonl([
            _fixture_user("prompt 1"),
            _fixture_assistant("reply 1"),
            _fixture_user("prompt 2"),
        ])
        try:
            ev = last_assistant_event(path)
            self.assertIsNotNone(ev)
        finally:
            os.unlink(path)


class IterToolUsesContract(unittest.TestCase):
    def test_yields_name_input_id(self):
        ev = _fixture_assistant("text", tool_use={
            "name": "Edit", "input": {"file_path": "/x"}, "id": "tu1"
        })
        tools = list(iter_tool_uses(ev))
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "Edit")
        self.assertEqual(tools[0]["input"]["file_path"], "/x")
        self.assertEqual(tools[0]["id"], "tu1")


if __name__ == "__main__":
    unittest.main()
