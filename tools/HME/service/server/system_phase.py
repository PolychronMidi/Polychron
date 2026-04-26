"""HME lifecycle state machine — Layer 0 of the self-coherence stack.

SystemPhase is the single authoritative lifecycle state of the HME system.
All components read and transition through this machine. Transitions are logged
with timestamps and reasons, creating an audit trail the previous boolean flags
completely lacked.

States:
  COLD       — process just started, no engines initialized
  WARMING    — background load / recovery in progress
  READY      — all engines available, tools fully functional
  DEGRADED   — proxy unhealthy or repeated errors; tools may return empty results
  RECOVERING — shim/proxy restart in progress; temporary degradation expected
  FAILED     — unrecoverable startup failure; tools blocked until restart
"""
import threading
import time
import logging
from enum import Enum

logger = logging.getLogger("HME")

class SystemPhase(Enum):
    COLD      = "COLD"
    WARMING   = "WARMING"
    READY     = "READY"
    DEGRADED  = "DEGRADED"
    RECOVERING = "RECOVERING"
    FAILED    = "FAILED"

_phase = SystemPhase.COLD
_phase_lock = threading.Lock()
_phase_history: list[dict] = []
_MAX_HISTORY = 200


def get_phase() -> SystemPhase:
    with _phase_lock:
        return _phase


def set_phase(new_phase: SystemPhase, reason: str = "") -> None:
    """Transition to a new phase. Logs the transition and records it in history."""
    global _phase
    with _phase_lock:
        if _phase == new_phase:
            return
        old = _phase
        _phase = new_phase
        entry = {
            "from": old.value,
            "to": new_phase.value,
            "ts": time.time(),
            "reason": reason or "",
        }
        _phase_history.append(entry)
        if len(_phase_history) > _MAX_HISTORY:
            _phase_history.pop(0)
    logger.info(
        f"HME phase: {old.value} → {new_phase.value}"
        + (f" ({reason})" if reason else "")
    )


def is_ready() -> bool:
    return get_phase() == SystemPhase.READY


def is_operational() -> bool:
    """True if tools should be served (READY or DEGRADED — degraded tools return empty but don't block)."""
    return get_phase() in (SystemPhase.READY, SystemPhase.DEGRADED)


def is_degraded_or_worse() -> bool:
    return get_phase() in (SystemPhase.DEGRADED, SystemPhase.RECOVERING, SystemPhase.FAILED)


def get_phase_history(n: int = 20) -> list[dict]:
    with _phase_lock:
        return list(_phase_history[-n:])


def describe_phase() -> str:
    """Short human-readable description for self-narration."""
    p = get_phase()
    if p == SystemPhase.COLD:
        return "starting up (COLD)"
    if p == SystemPhase.WARMING:
        return "initializing engines (WARMING)"
    if p == SystemPhase.READY:
        return "fully operational (READY)"
    if p == SystemPhase.DEGRADED:
        h = get_phase_history(5)
        if h:
            last = h[-1]
            return f"degraded since {_ago(last['ts'])} ({last.get('reason', 'unknown cause')})"
        return "degraded (cause unknown)"
    if p == SystemPhase.RECOVERING:
        h = get_phase_history(5)
        if h:
            last = h[-1]
            return f"recovering (started {_ago(last['ts'])})"
        return "recovering"
    if p == SystemPhase.FAILED:
        h = get_phase_history(5)
        reason = h[-1].get("reason", "") if h else ""
        return f"failed — restart required" + (f" ({reason})" if reason else "")
    return p.value


def _ago(ts: float) -> str:
    secs = int(time.time() - ts)
    if secs < 60:
        return f"{secs}s ago"
    if secs < 3600:
        return f"{secs // 60}m ago"
    return f"{secs // 3600}h ago"
