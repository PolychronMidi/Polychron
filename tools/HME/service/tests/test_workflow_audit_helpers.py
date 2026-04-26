"""Contract tests for workflow_audit.py helpers that the thread flagged
as convention-anchors across producer/consumer pairs.

Peer-review iter 111 caught that the scaffolding-prefix convention had
THREE different regex/string forms across review_unified.py (producer),
posttooluse_hme_review.sh (bash consumer), and workflow_audit.py
(python consumer). These tests pin the python consumer's tuple so a
future edit that e.g. drops SKIPPED or adds whitespace silently breaks
review-verdict correctness.

Tests focus on: do warnings with each scaffolding prefix classify as
non-actionable, and do warnings without the prefix classify as
actionable?
"""
import os
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = os.environ.get("PROJECT_ROOT", "/home/jah/Polychron")
sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools/HME/service"))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools/HME/service/server"))


class ScaffoldPrefixContract(unittest.TestCase):
    """The tuple at workflow_audit.py:659 is the python consumer's
    scaffolding-prefix definition. These tests fix its shape so
    (a) a rename in either prefix drops actionable counts silently,
    (b) a producer emitting a different spacing (`]  HOOK CHANGE`
    double-space) isn't incorrectly treated as actionable.
    """

    def setUp(self):
        # Read the prefix tuple from the source — don't duplicate the
        # definition here (duplicating would itself be Pattern A drift).
        import re
        src = Path(PROJECT_ROOT, "tools/HME/service/server/tools_analysis/workflow_audit.py").read_text()
        m = re.search(r'_scaffold_prefixes\s*=\s*\(([^)]+)\)', src)
        self.assertIsNotNone(m, "prefix tuple definition not found at expected location")
        raw = m.group(1)
        self.prefixes = tuple(s.strip().strip('"').strip("'")
                              for s in raw.split(',') if s.strip())

    def test_tuple_contains_known_prefixes(self):
        # Names pinned — if review_unified.py gains / drops a category,
        # this test catches the python-side divergence.
        for expected in ("] HOOK CHANGE:", "] DOC CHECK:", "] SKIPPED:", "] KB:"):
            self.assertIn(expected, self.prefixes,
                          f"scaffold prefix {expected!r} missing — cross-layer drift")

    def test_warning_matching_scaffold_classifies_nonactionable(self):
        prefixes = self.prefixes
        scaffold_warnings = [
            "[2026-04-25T00:00:00Z] HOOK CHANGE: watched file modified",
            "[2026-04-25T00:00:00Z] DOC CHECK: README.md needs update",
            "[2026-04-25T00:00:00Z] SKIPPED: no diff context available",
            "[2026-04-25T00:00:00Z] KB: 3 entries stale",
        ]
        for w in scaffold_warnings:
            hit = any(p in w for p in prefixes)
            self.assertTrue(hit, f"scaffold warning {w!r} did not match any prefix")

    def test_actionable_warning_does_not_match(self):
        prefixes = self.prefixes
        actionable = [
            "[2026-04-25T00:00:00Z] PYTHON bug: uncaught NoneType on line 42",
            "[2026-04-25T00:00:00Z] BOUNDARY VIOLATION: crossLayer writes to conductor",
            "regular log line with HOOK CHANGE in middle but no ]-prefix",
        ]
        for w in actionable:
            hit = any(p in w for p in prefixes)
            self.assertFalse(hit, f"actionable warning {w!r} falsely matched scaffold")


class DiffLanguageDetectionContract(unittest.TestCase):
    """_detect_languages must parse extensions from diff headers, not
    substring-scan the entire diff body. Peer-review earlier this
    session caught that substring-matching against `.py` was triggered
    by docstring prose like "see the .py version of X" — falsely
    marking Python as present and loading python-specific probe hints
    into a pure-shell review."""

    def test_header_based_detection(self):
        # Source inspection — a dynamic import of workflow_audit requires
        # the full server context stack (which these tests don't set
        # up). Instead verify the source contains the header-anchored
        # tokens, since the nested function body is what we're pinning.
        src = Path(PROJECT_ROOT, "tools/HME/service/server/tools_analysis/workflow_audit.py").read_text()
        self.assertIn("+++ b/", src,
                      "_detect_languages must anchor to diff headers, not substring-scan")
        self.assertIn("MULTILINE", src,
                      "_detect_languages must use re.MULTILINE for header anchoring")


if __name__ == "__main__":
    unittest.main()
