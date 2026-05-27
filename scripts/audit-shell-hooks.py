#!/usr/bin/env python3
from __future__ import annotations
import os
import runpy
import sys
from pathlib import Path

ROOT = Path(os.environ["PROJECT_ROOT"])
TARGET = ROOT / 'tools/HME/scripts/audit-shell-hooks.py'
sys.argv = [str(TARGET), *sys.argv[1:]]
runpy.run_path(str(TARGET), run_name="__main__")
