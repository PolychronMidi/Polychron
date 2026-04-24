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

# Append-write bound. Every N appends to a JSONL/log file we check its
# line count and keep only the tail half if it has exceeded the cap.
# The sparse sampling (1/_TRIM_CHECK_EVERY) keeps the hot path cheap —
# O(1) counter increment + rare stat() — while still bounding growth.
_TRIM_CHECK_EVERY = 200
_ERRORS_MAX_LINES = 20_000
_TRANSCRIPT_MAX_LINES = 50_000
_append_counters: dict[str, int] = {}
_trim_lock = threading.Lock()


def _maybe_trim_append(path: str, max_lines: int) -> None:
    """Periodically bound an append-only file. Checks size every
    _TRIM_CHECK_EVERY writes; when line count exceeds max_lines, keeps
    the tail half. Atomic rename — never leaves a partial file behind."""
    with _trim_lock:
        n = _append_counters.get(path, 0) + 1
        _append_counters[path] = n
        if n % _TRIM_CHECK_EVERY != 0:
            return
    try:
        with open(path, "rb") as f:
            # Fast line count via buffered read; avoids loading file fully
            # into memory for very large logs.
            total = sum(buf.count(b"\n") for buf in iter(lambda: f.read(65536), b""))
    except OSError:
        return
    if total <= max_lines:
        return
    keep = max_lines // 2
    tmp_path = path + ".trim.tmp"
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as src, \
             open(tmp_path, "w", encoding="utf-8") as dst:
            # Stream last `keep` lines via a rolling buffer.
            buf: list[str] = []
            for line in src:
                buf.append(line)
                if len(buf) > keep:
                    buf.pop(0)
            dst.writelines(buf)
        os.replace(tmp_path, path)
    except OSError as e:
        print(f"[HME FAILFAST] append trim for {path} failed: {e}",
              file=sys.stderr, flush=True)
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def init_store(project_root: str) -> None:
    """Set paths derived from PROJECT_ROOT. Call once at startup."""
    global PROJECT_ROOT, _ERRORS_PATH, _TRANSCRIPT_PATH
    PROJECT_ROOT = project_root
    _ERRORS_PATH = os.path.join(project_root, "log", "hme-errors.log")
    _TRANSCRIPT_PATH = os.path.join(project_root, "log", "session-transcript.jsonl")
    _load_transcript()


# Critical error log

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
    # source="claude" = the chat panel's claude-CLI watchdog firing because
    # the CLI went silent for its (UI-configured) inactivity window. These
    # are ROUTINE retry signals — slow API responses, large tool_use frames,
    # transient shim back-pressure — NOT code defects. They belong in the
    # in-memory ring for debugging but must NOT hit hme-errors.log, which
    # escalates to LIFESAVER and blocks the NEXT agent turn. Before this
    # filter every slow Anthropic stream caused a CRITICAL alert loop.
    _claude_watchdog = (
        source == "claude"
        and ("no stdout for" in message.lower() or "cli hung" in message.lower())
    )
    _transient = (
        (source in _transient_sources and "timeout" in message.lower())
        or "unreachable" in message.lower()
        or _claude_watchdog
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


# Transcript store

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
        malformed = 0
        for line in recent:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    malformed += 1
        if malformed:
            # Narrow to JSONDecodeError so real bugs (schema errors, etc.)
            # still propagate. JSONL corruption = lost transcript history
            # = lost session continuity. Fire a FAILFAST so the operator
            # knows history is compromised — not a quiet debug line.
            print(f"[HME FAILFAST] transcript load: {malformed} malformed JSONL lines DROPPED — session history partial", file=sys.stderr, flush=True)
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
        # Every entry has "ts" via _append_transcript's setdefault.
        filtered = [e for e in _transcript_entries if e["ts"] >= cutoff]
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
