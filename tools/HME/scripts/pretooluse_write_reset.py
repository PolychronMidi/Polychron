#!/usr/bin/env python3
"""Single Python startup combining both --reset side-effects fired by
pretooluse_write hook (vow_bounded_reads + spiralling_petulance).

Each separate `python3 <script> --reset[-edit]` cost ~500ms of cold-start
import, doubling the pretooluse_write hot-path latency. Merging into one
process drops one full interpreter spin. Both calls are silent-best-effort
already; failures here MUST NOT block the write.
"""
from __future__ import annotations

import os
import sys
import importlib.util
from pathlib import Path

_ROOT = Path(os.environ["PROJECT_ROOT"])
_SCRIPTS = _ROOT / "tools" / "HME" / "scripts"


def _call(module_path: Path, fn_or_main: str = "main", argv: list[str] | None = None) -> None:
    """Invoke a script's main() or argparse-style entrypoint in-process."""
    try:
        spec = importlib.util.spec_from_file_location(module_path.stem, str(module_path))
        if spec is None or spec.loader is None:
            return
        mod = importlib.util.module_from_spec(spec)
        saved_argv = sys.argv
        sys.argv = [str(module_path)] + (argv or [])
        try:
            spec.loader.exec_module(mod)
            if hasattr(mod, fn_or_main):
                getattr(mod, fn_or_main)()
        finally:
            sys.argv = saved_argv
    except Exception:
        # silent-ok: hot-path reset, must not block write.
        pass


def main() -> int:
    _call(_SCRIPTS / "vow_bounded_reads.py", argv=["--reset"])
    _call(_SCRIPTS / "detectors" / "spiralling_petulance.py", argv=["--reset-edit"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
