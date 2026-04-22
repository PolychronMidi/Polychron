"""R32: Shared project walkers for pipeline/hme scripts.

Available for reuse — currently called opportunistically. Two walkers exist
in the codebase (build-dir-intent-index + build-kb-staleness-index) with
different filter semantics, so full consolidation would require generalizing
to both patterns. Rather than forcing that, provide the helper here and let
each caller adopt incrementally.

walk_project_files: canonical walker with sensible default exclusions.
"""
from __future__ import annotations
import os
from typing import Iterable

DEFAULT_SKIP_DIRS = frozenset({
    ".git", "node_modules", ".venv", "venv", "__pycache__",
    ".pytest_cache", "log", "tmp", "metrics", ".lab",
    "dist", "build", ".cache",
})

# Extensions we generally care about for code-semantic walks. Callers
# wanting everything should pass include_exts=None.
DEFAULT_INCLUDE_EXTS = frozenset({".js", ".py", ".ts", ".md", ".sh", ".json"})


def walk_project_files(
    root: str,
    skip_dirs: frozenset[str] = DEFAULT_SKIP_DIRS,
    include_exts: frozenset[str] | None = DEFAULT_INCLUDE_EXTS,
    skip_hidden: bool = True,
) -> Iterable[str]:
    """Yield absolute file paths under `root` with consistent filters.

    Caller-tunable: skip_dirs (hidden dirs filtered by skip_hidden=True),
    include_exts (None = all), skip_hidden (skip `.xyz` dirs).
    """
    for dirpath, dirs, files in os.walk(root, followlinks=False):
        # In-place pruning tells os.walk not to descend
        dirs[:] = [d for d in dirs
                   if d not in skip_dirs
                   and not (skip_hidden and d.startswith("."))]
        for fname in files:
            if skip_hidden and fname.startswith("."):
                continue
            if include_exts is not None:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in include_exts:
                    continue
            yield os.path.join(dirpath, fname)
