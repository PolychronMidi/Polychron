#!/usr/bin/env python3
"""Run all doc/infra generated-doc maintenance commands."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMMANDS = [
    [sys.executable, str(ROOT / "doc/infra/update_self_coherence.py")],
    [sys.executable, str(ROOT / "doc/infra/update_full_indexes.py")],
]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Update or check generated documentation maintained by doc/infra")
    parser.add_argument("--check", action="store_true")
    ns = parser.parse_args(argv)
    for cmd in COMMANDS:
        actual = cmd + (["--check"] if ns.check else [])
        result = subprocess.run(actual, cwd=ROOT, text=True, capture_output=True, timeout=60)
        if result.returncode != 0:
            sys.stderr.write(result.stderr)
            sys.stdout.write(result.stdout)
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
