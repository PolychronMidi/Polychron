"""TODO/devlog compatibility bridge.

Split (2026-05-01) into:
  todo_spec_ingest.py   -- TODO.md -> todo store compatibility actions
  todo_spec_archive.py  -- archive_set + devlog + reset_to_fresh_slate
  todo_spec_phase.py    -- checkbox close compatibility actions

todo.py re-exports from this shim so legacy imports keep working.
"""
from .todo_spec_ingest import (  # noqa: F401
    _NEXT_UP_RE, _SPEC_OPEN_RE,
    _read_section, _read_phase_block, _ingest_from_spec, _promote_to_spec,
    _normalize_for_match, _common_prefix_len,
)
from .todo_spec_archive import (  # noqa: F401
    _ensure_devlog_dir, _slugify, _detect_complete_set, _archive_set,
    _reset_spec_to_fresh_slate, _reset_todo_to_fresh_slate,
)
from .todo_spec_phase import (  # noqa: F401
    _detect_phase_complete, _close_with_spec_update,
)
