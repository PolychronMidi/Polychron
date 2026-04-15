"""HME resonance detector — Layer 10 of the self-coherence stack.

Detects cascading failure patterns where multiple components fail in rapid
succession — a failure resonance that's worse than the sum of its parts.

Without detection: shim crash + llama.cpp eviction + MCP restart each spawn
independent recovery threads that pile up, interfere, and amplify the failure.

With detection: when 3+ distinct failure sources occur within _CASCADE_WINDOW
seconds, a CASCADE is declared. During a cascade:
  - Individual restart attempts check is_cascade_active() before proceeding
  - A single orchestrated recovery message is issued (not 3 separate LIFESAVER banners)
  - The cooldown window suppresses spurious restart races

Analogous to feedbackRegistry in the conductor — without registration,
resonance between recovery paths amplifies the failure instead of resolving it.
"""
import threading
import time
import logging

logger = logging.getLogger("HME")

_CASCADE_WINDOW = 10.0    # seconds: failure cluster window
_CASCADE_THRESHOLD = 3    # distinct sources to declare CASCADE
_CASCADE_COOLDOWN = 60.0  # seconds: suppress individual restarts during cascade

_recent_events: list[dict] = []  # [{ts, source}]
_events_lock = threading.Lock()
_cascade_active = False
_cascade_started: float = 0.0
_cascade_sources: set[str] = set()
_cascade_lock = threading.Lock()


def record_failure_event(source: str) -> bool:
    """Record a failure event from a component. Returns True if this triggered a CASCADE."""
    global _cascade_active, _cascade_started, _cascade_sources
    now = time.time()
    with _events_lock:
        _recent_events.append({"ts": now, "source": source})
        cutoff = now - _CASCADE_WINDOW
        while _recent_events and _recent_events[0]["ts"] < cutoff:
            _recent_events.pop(0)
        sources_in_window = {e["source"] for e in _recent_events}

    if len(sources_in_window) >= _CASCADE_THRESHOLD:
        with _cascade_lock:
            if not _cascade_active:
                _cascade_active = True
                _cascade_started = now
                _cascade_sources = set(sources_in_window)
                logger.warning(
                    f"HME CASCADE DETECTED: {len(sources_in_window)} failure sources "
                    f"within {_CASCADE_WINDOW}s: {sorted(sources_in_window)}"
                )
                return True
    return False


def is_cascade_active() -> bool:
    """Return True if a cascade is in progress.

    Called by individual restart handlers to avoid spawning duplicate recovery
    threads during a cascade — let the orchestrated cascade recovery handle it.
    Auto-resolves after _CASCADE_COOLDOWN seconds.
    """
    global _cascade_active
    with _cascade_lock:
        if not _cascade_active:
            return False
        if time.time() - _cascade_started > _CASCADE_COOLDOWN:
            _cascade_active = False
            logger.info("HME CASCADE resolved (cooldown elapsed)")
            return False
        return True


def resolve_cascade(reason: str = "orchestrated recovery") -> None:
    global _cascade_active
    with _cascade_lock:
        if _cascade_active:
            _cascade_active = False
            logger.info(f"HME CASCADE resolved: {reason}")


def get_cascade_info() -> dict | None:
    """Return cascade metadata if active, else None."""
    with _cascade_lock:
        if not _cascade_active:
            return None
        return {
            "active": True,
            "started": _cascade_started,
            "age_s": time.time() - _cascade_started,
            "sources": sorted(_cascade_sources),
        }
