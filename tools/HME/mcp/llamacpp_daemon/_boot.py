"""Boot-time constants, version resolution, training-lock helper.

Extracted from the original llamacpp_daemon.py to keep module-level setup
isolated from behavioral code. Imported by every other module in the
package.
"""
from __future__ import annotations

import json
import logging
import os
import sys

# Central .env loader — fail-fast semantics. The path insert is historical:
# hme_env.py lives in tools/HME/mcp/, so any entry into the package needs
# that directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from hme_env import ENV  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("HME.llamacpp")
logger.setLevel(logging.INFO)

PID_FILE = "/tmp/hme-llamacpp-daemon.pid"
TRAINING_LOCK = ENV.require("HME_TRAINING_LOCK")

_DEFAULT_WALL_TIMEOUT = 45  # hard wall-clock cap for /generate proxy
_HEALTH_INTERVAL = 60       # self-health-tick interval (s)


def _load_daemon_version() -> str:
    """Single source of truth: tools/HME/config/versions.json. Daemon,
    worker, proxy, and cli all read from here. Runtime drift between
    components is caught by selftest's version-consistency probe."""
    _p = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "..", "..", "config", "versions.json")
    try:
        with open(_p) as _f:
            return json.load(_f).get("daemon", "unknown")
    except Exception as _ver_err:
        print(f"daemon: versions.json read failed: {type(_ver_err).__name__}: {_ver_err}",
              file=sys.stderr)
        return "unknown"


DAEMON_VERSION = _load_daemon_version()

# Rotate logs at daemon boot so daemon.out doesn't grow without bound.
try:
    from log_rotation import rotate_on_boot as _rotate_logs
    _rotate_logs(
        os.environ.get("PROJECT_ROOT", "")
        or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    )  # env-ok: boot fallback
except Exception as _rot_err:
    print(f"daemon: log rotation at boot failed (non-fatal): {_rot_err}", file=sys.stderr)


def _training_locked() -> bool:
    """Skip all auto-spawn/restart when the training lock is held."""
    return os.path.exists(TRAINING_LOCK)
