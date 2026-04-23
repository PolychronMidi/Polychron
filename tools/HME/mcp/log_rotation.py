"""Log rotation — keeps log/*.log and log/*.out bounded without a cron.

The selftest probe surfaces log-size ceiling violations as WARN; the
actual trim happens here on a best-effort basis called at worker boot
and periodically via the meta-observer.

Policy (conservative; favours keeping recent history over aggressive trim):

  hme.log                     cap 50 MB → trim to last 40 MB
  hme-worker.out              cap 50 MB → trim to last 40 MB
  hme-llamacpp_daemon.out     cap 50 MB → trim to last 40 MB
  hme-errors.log              cap 10 MB → trim to last 8 MB
  session-transcript.jsonl    cap 100 MB → trim to last 80 MB
  llama-server-*.log          cap 100 MB → trim to last 80 MB

The trim is line-preserving: read the last N bytes, skip to the next
newline, rewrite the file atomically. Archived tail goes to
log/<name>.<ts>.archive.gz for forensic recovery.
"""
from __future__ import annotations

import gzip
import logging
import os
import shutil
import tempfile
import time

logger = logging.getLogger("HME")

_POLICIES: list[tuple[str, int, int]] = [
    # (filename, cap_mb, keep_mb)
    ("hme.log",                    50, 40),
    ("hme-worker.out",             50, 40),
    ("hme-llamacpp_daemon.out",    50, 40),
    ("hme-errors.log",             10, 8),
    ("session-transcript.jsonl",  100, 80),
]


def _rotate_file(path: str, cap_bytes: int, keep_bytes: int) -> tuple[bool, str]:
    """Rotate a single file if it exceeds cap_bytes. Returns (rotated, detail)."""
    try:
        size = os.path.getsize(path)
    except OSError as e:
        return False, f"stat failed: {e}"
    if size <= cap_bytes:
        return False, f"under cap ({size}/{cap_bytes})"

    # Archive the whole current file to a gzipped snapshot before trimming
    # so forensic recovery is possible after a mystery trim.
    ts = time.strftime("%Y%m%d-%H%M%S")
    archive = f"{path}.{ts}.archive.gz"
    try:
        with open(path, "rb") as src, gzip.open(archive, "wb", compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
    except OSError as e:
        return False, f"archive write failed: {e}"

    # Now trim: seek to (size - keep_bytes), advance past the next newline
    # so we don't split a line mid-byte, atomically rewrite.
    try:
        with open(path, "rb") as f:
            f.seek(size - keep_bytes)
            # Read one line to discard partial and align to line boundary.
            f.readline()
            tail = f.read()
    except OSError as e:
        return False, f"read-tail failed: {e}"

    dirname = os.path.dirname(path) or "."
    try:
        fd, tmp_path = tempfile.mkstemp(dir=dirname, prefix=os.path.basename(path) + ".", suffix=".rotate")
        with os.fdopen(fd, "wb") as f:
            f.write(tail)
        os.replace(tmp_path, path)
    except OSError as e:
        try:
            os.unlink(tmp_path)
        except OSError:  # silent-ok: cleanup of failed tmpfile; not a user-visible error
            pass
        return False, f"atomic rewrite failed: {e}"

    return True, f"rotated {size}B → {len(tail)}B (archived {archive})"


def rotate_all(log_dir: str) -> dict:
    """Apply every policy. Returns {filename: outcome_string}."""
    outcomes: dict[str, str] = {}
    for fname, cap_mb, keep_mb in _POLICIES:
        path = os.path.join(log_dir, fname)
        if not os.path.isfile(path):
            outcomes[fname] = "absent"
            continue
        rotated, detail = _rotate_file(path, cap_mb * 1024 * 1024, keep_mb * 1024 * 1024)
        outcomes[fname] = ("ROTATED: " if rotated else "skipped: ") + detail
        if rotated:
            logger.info(f"log_rotation: {fname} — {detail}")
    # Also trim large llama-server-*.log files (pattern, not fixed name).
    try:
        for entry in os.listdir(log_dir):
            if entry.startswith("llama-server-") and entry.endswith(".log"):
                path = os.path.join(log_dir, entry)
                rotated, detail = _rotate_file(path, 100 * 1024 * 1024, 80 * 1024 * 1024)
                if rotated:
                    outcomes[entry] = "ROTATED: " + detail
                    logger.info(f"log_rotation: {entry} — {detail}")
    except OSError as _list_err:
        logger.debug(f"log_rotation: listdir failed for llama-server logs: {_list_err}")
    return outcomes


def rotate_on_boot(project_root: str) -> None:
    """Safe-to-call-always: rotate once at worker/daemon startup. Never raises."""
    try:
        log_dir = os.path.join(project_root, "log")
        if not os.path.isdir(log_dir):
            return
        outcomes = rotate_all(log_dir)
        rotated = [k for k, v in outcomes.items() if v.startswith("ROTATED")]
        if rotated:
            logger.info(f"log_rotation: boot rotated {len(rotated)} files: {rotated}")
    except Exception as e:
        logger.warning(f"log_rotation: boot rotation failed (non-fatal): {e}")
