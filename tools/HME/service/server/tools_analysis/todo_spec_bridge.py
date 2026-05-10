"""Spec/TODO/devlog bridge -- re-exports from the three sub-modules.

Split (2026-05-01) into:
  todo_spec_ingest.py   -- A. spec <-> todo store sync (ingest_from_spec, promote_to_spec)
  todo_spec_archive.py  -- B. archive_set + devlog + reset_to_fresh_slate
  todo_spec_phase.py    -- C. phase detection + close_with_spec_update

todo.py re-exports from this shim, so external callers
(`from server.tools_analysis.todo import _close_with_spec_update`) continue to work.
"""
from .todo_spec_ingest import (  # noqa: F401
    _NEXT_UP_RE, _SPEC_OPEN_RE,
    _read_section, _read_phase_block, _ingest_from_spec, _promote_to_spec,
    _normalize_for_match, _common_prefix_len,
)
from .todo_spec_archive import (  # noqa: F401
    _JUST_SHIPPED_LIMIT,
    _ensure_devlog_dir, _slugify, _detect_complete_set, _archive_set,
    _reset_spec_to_fresh_slate, _reset_todo_to_fresh_slate,
    _archive_just_shipped_overflow, _trim_just_shipped,
    _phase_blocks,
)
from .todo_spec_phase import (  # noqa: F401
    _detect_phase_complete, _close_with_spec_update,
)
