#!/usr/bin/env python3
"""Shim — delegates to verify_coherence package (folder).

Original 2842-line file split into tools/HME/scripts/verify_coherence/
per package structure. This thin wrapper preserves the
`python3 tools/HME/scripts/verify-coherence.py` invocation path that
existing callers (main-pipeline.js, chain-snapshot.py, emit-hci-signal.py,
build-dashboard.py, suggest-verifiers.py, verify-numeric-drift.py) use.

Python identifiers can't contain `-`, so the package itself uses the
underscored form `verify_coherence`. This shim's hyphenated name lives
in the filesystem only.
"""
import os
import sys

# Ensure this directory is on sys.path so `verify_coherence` resolves.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from verify_coherence.__main__ import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
