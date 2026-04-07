"""HME session state — think history, unified session narrative, disk persistence."""
import json
import os
import logging

from server import context as ctx

logger = logging.getLogger("HME")

_think_history: list[dict] = []
_THINK_HISTORY_MAX = 3

_session_narrative: list[dict] = []
_session_narrative_seq: int = 0
_SESSION_NARRATIVE_MAX = 10

_SESSION_STATE_FILE = None
_session_state_loaded = False


def _session_state_path() -> str | None:
    global _SESSION_STATE_FILE
    if _SESSION_STATE_FILE:
        return _SESSION_STATE_FILE
    root = getattr(ctx, "PROJECT_ROOT", "")
    if root:
        _SESSION_STATE_FILE = os.path.join(root, "tools", "HME", "session-state.json")
        return _SESSION_STATE_FILE
    return None


def _load_session_state():
    """Lazy load from disk — no-ops after first successful load."""
    global _session_narrative, _session_narrative_seq, _think_history, _session_state_loaded
    if _session_state_loaded:
        return
    path = _session_state_path()
    if not path:
        return
    _session_state_loaded = True
    if not os.path.exists(path):
        return
    try:
        with open(path) as f:
            data = json.load(f)
        _session_narrative = data.get("narrative", [])[-_SESSION_NARRATIVE_MAX:]
        _session_narrative_seq = data.get("seq", 0)
        _think_history = data.get("think_history", [])[-_THINK_HISTORY_MAX:]
        logger.info(
            f"session state loaded: {len(_session_narrative)} narrative events, "
            f"{len(_think_history)} think exchanges"
        )
    except Exception as e:
        logger.warning(f"session state load failed: {e}")


def _save_session_state():
    path = _session_state_path()
    if not path:
        return
    try:
        with open(path, "w") as f:
            json.dump({
                "narrative": _session_narrative,
                "seq": _session_narrative_seq,
                "think_history": _think_history,
            }, f, indent=2)
    except Exception as e:
        logger.warning(f"session state save failed: {e}")


def store_think_history(about: str, answer: str):
    """Store a think Q&A pair and append a narrative event."""
    _think_history.append({"about": about, "answer": answer[:300]})
    while len(_think_history) > _THINK_HISTORY_MAX:
        _think_history.pop(0)
    narrative_entry = about[:80] + (": " + answer[:60] + "..." if answer else "")
    append_session_narrative("think", narrative_entry)


def get_think_history_context() -> str:
    _load_session_state()
    if not _think_history:
        return ""
    lines = [f"  Q: {h['about'][:80]} → {h['answer'][:150]}" for h in _think_history]
    return "Previous think exchanges this session:\n" + "\n".join(lines) + "\n\n"


def append_session_narrative(event: str, content: str):
    """Append an event to the rolling session narrative and persist to disk."""
    global _session_narrative_seq
    _session_narrative_seq += 1
    _session_narrative.append({
        "seq": _session_narrative_seq,
        "event": event,
        "content": content[:100],
    })
    while len(_session_narrative) > _SESSION_NARRATIVE_MAX:
        _session_narrative.pop(0)
    _save_session_state()


def get_session_narrative() -> str:
    """Return formatted narrative for injection into any model call."""
    _load_session_state()
    if not _session_narrative:
        return ""
    lines = [f"  [{e['seq']}:{e['event']}] {e['content']}" for e in _session_narrative]
    return "Session narrative (this session's work so far):\n" + "\n".join(lines) + "\n\n"


def session_state_counts() -> dict:
    return {"think_history": len(_think_history), "session_narrative": len(_session_narrative)}
