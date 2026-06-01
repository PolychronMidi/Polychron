#!/usr/bin/env python3
"""Post-restart routing readiness check."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[3])

for line in (ROOT / ".env").read_text(errors="replace").splitlines() if (ROOT / ".env").exists() else []:
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    os.environ.setdefault(key.strip(), value.strip())
SERVICE = ROOT / "tools" / "HME" / "service"
if str(SERVICE) not in sys.path:
    sys.path.insert(0, str(SERVICE))

from server.route_health import format_routing_ready  # noqa: E402

print(format_routing_ready(ROOT))
