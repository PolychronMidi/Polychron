"""HME HTTP — error log and transcript store."""
import json
import logging
import os
import sys
import threading
import time

logger = logging.getLogger("HME.http")

# Populated by worker.py via init_store()
PROJECT_ROOT: str = ""
_ERRORS_PATH: str = ""
_TRANSCRIPT_PATH: str = ""

_error_lock = threading.Lock()
_MAX_ERRORS_MEMORY = 50
_error_log: list[dict] = []

_transcript_lock = threading.Lock()
_MAX_TRANSCRIPT_MEMORY = 500
_transcript_entries: list[dict] = []
_latest_narrative: str = ""


def init_store(project_root: str) -> None:
    """Set paths derived from PROJECT_ROOT. Call once at startup."""
    global PROJECT_ROOT, _ERRORS_PATH, _TRANSCRIPT_PATH
    PROJECT_ROOT = project_root
    _ERRORS_PATH = os.path.join(project_root, "log", "hme-errors.log")
    _TRANSCRIPT_PATH = os.path.join(project_root, "log", "session-transcript.jsonl")
    _load_transcript()


# ── Critical error log ────────────────────────────────────────────────────────

def _log_error(source: str, message: str, detail: str = "") -> None:
    """Append a critical error to the in-memory log and hme-errors.log.
    Transient timeouts go to memory only (not disk) — they're operational, not code defects.

    Transient detection is SOURCE-based, not message-based. The source argument
    is exactly the dimension we want to filter on, and message formats drift
    over time (the "/reindex" URL-path pattern was a bug from when this ran
    inside an HTTP handler; the function is now called from arbitrary places
    where the message has no URL shape at all). Source-based filtering is
    drift-proof because the source argument is supplied by the caller and
    never varies per message.
    """
    global _error_log
    _transient_sources = {"reindex", "enrich", "audit"}
    _transient = (
        (source in _transient_sources and "timeout" in message.lower())
        or "unreachable" in message.lower()
    )
    entry = {
        "ts": int(time.time() * 1000),
        "ts_str": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": source,
        "message": message,
        "detail": detail,
    }
    with _error_lock:
        _error_log.append(entry)
        if len(_error_log) > _MAX_ERRORS_MEMORY:
            _error_log = _error_log[-_MAX_ERRORS_MEMORY:]
    if not _transient:
        try:
            os.makedirs(os.path.dirname(_ERRORS_PATH), exist_ok=True)
            with open(_ERRORS_PATH, "a") as f:
                f.write(f"[{entry['ts_str']}] [{source}] {message}")
                if detail:
                    f.write(f" | {detail}")
                f.write("\n")
        except Exception as e:
            print(f"[HME FAILFAST] Error log disk write failed: {e}", file=sys.stderr, flush=True)


def _get_recent_errors(minutes: int = 60) -> list[dict]:
    cutoff = (time.time() - minutes * 60) * 1000
    with _error_lock:
        return [e for e in _error_log if e["ts"] >= cutoff]


# ── Transcript store ──────────────────────────────────────────────────────────

def _load_transcript() -> None:
    """Load existing transcript from JSONL file into memory."""
    global _transcript_entries
    try:
        if not os.path.exists(_TRANSCRIPT_PATH):
            return
        with open(_TRANSCRIPT_PATH, "r") as f:
            lines = f.readlines()
        recent = lines[-_MAX_TRANSCRIPT_MEMORY:] if len(lines) > _MAX_TRANSCRIPT_MEMORY else lines
        entries = []
        for line in recent:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except Exception:
                    pass
        with _transcript_lock:
            _transcript_entries = entries
    except Exception as e:
        print(f"[HME FAILFAST] Transcript load failed: {e}", file=sys.stderr, flush=True)


def _append_transcript(entries: list[dict]) -> int:
    """Append entries to transcript JSONL and memory. Returns count appended."""
    global _transcript_entries
    os.makedirs(os.path.dirname(_TRANSCRIPT_PATH), exist_ok=True)
    count = 0
    with _transcript_lock:
        with open(_TRANSCRIPT_PATH, "a") as f:
            for entry in entries:
                entry.setdefault("ts", int(time.time() * 1000))
                f.write(json.dumps(entry) + "\n")
                _transcript_entries.append(entry)
                count += 1
        if len(_transcript_entries) > _MAX_TRANSCRIPT_MEMORY:
            _transcript_entries = _transcript_entries[-_MAX_TRANSCRIPT_MEMORY:]
    return count


def _get_transcript(minutes: int = 30, max_entries: int = 50) -> list[dict]:
    """Get recent transcript entries within time window."""
    cutoff = (time.time() - minutes * 60) * 1000  # ms
    with _transcript_lock:
        filtered = [e for e in _transcript_entries if e.get("ts", 0) >= cutoff]
        return filtered[-max_entries:]


def _get_transcript_context(query: str = "", max_chars: int = 3000) -> str:
    """Build a context string from recent transcript for injection into messages."""
    recent = _get_transcript(minutes=60, max_entries=40)
    if not recent:
        return ""
    lines = ["[Session Transcript — recent activity]"]
    chars = len(lines[0])

    # Narratives first (most compact summary)
    for e in recent:
        if e.get("type") == "narrative":
            n = f"[Digest] {e.get('content', '')[:500]}"
            lines.append(n)
            chars += len(n)

    # Then summaries
    for e in recent:
        if e.get("type") == "narrative":
            continue
        ts = e.get("ts", 0)
        ts_str = time.strftime("%H:%M:%S", time.gmtime(ts / 1000)) if ts else "??:??:??"
        summary = e.get("summary", e.get("content", "")[:120])
        line = f"[{ts_str}] {summary}"
        if chars + len(line) > max_chars:
            break
        lines.append(line)
        chars += len(line)

    return "\n".join(lines)
