#!/usr/bin/env python3
"""Reconcile stale LIFESAVER watermarks after proven recovery."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

OBSERVATION_RE = re.compile(r"\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b")
SELF_TAG_RE = re.compile(
    r"^\[(?:_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|"
    r"hme-proxy|proxy-bridge|proxy-watchdog|hook-watchdog|hook-stop-block|"
    r"hook-runtime-error|proxy-supervisor|"
    r"llamacpp_supervisor|llamacpp_offload_invariant|"
    r"llamacpp_indexing_mode_resume|meta_observer|model_init|"
    r"rag_proxy\.project|startup_chain|worker_client|worker:[^\]]+)\]"
)
CANARY_RE = re.compile(r"\[CANARY-")
TS_RE = re.compile(r"^\[[0-9TZ:.\-]*\]\s*")
RECOVERED_UPSTREAM_RES = (
    re.compile(r"\bUPSTREAM_400_INTERACTIVE\b.*No credentials for provider: anthropic", re.I),
    re.compile(r"\bUPSTREAM_400_INTERACTIVE\b.*thinkingLevel: Extra inputs are not permitted", re.I),
    re.compile(r"\bUPSTREAM_400_INTERACTIVE\b.*adaptive thinking is not supported", re.I),
)
RECOVERED_AUTOCOMMIT_RES = (
    re.compile(r"^\[autocommit(?::proxy)?\]\s+.*git commit failed twice:", re.I),
    re.compile(r"^\[hook-output-validation\]\s+JSON validation failed for Claude PreToolUse hook stdout:", re.I),
    re.compile(r"^\[autocommit(?::proxy)?\]\s+\[onRequest\] git commit failed twice:", re.I),
    re.compile(r"^Fix or unstage the following:", re.I),
    re.compile(r"^\s*- .*\b(?:contains value of|invalid JavaScript syntax|pre-commit validation blocked)", re.I),
)


def _int_file(path: Path) -> int:
    try:
        return max(0, int(path.read_text(encoding="utf-8", errors="ignore").strip() or "0"))
    except (OSError, ValueError):
        return 0


def _write_int(path: Path, value: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{value}\n", encoding="utf-8")


def _line_count(path: Path) -> int:
    try:
        with path.open("rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def _read_since(path: Path, start_line: int) -> list[str]:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    return lines[start_line:]


def _normalize(line: str) -> str:
    return TS_RE.sub("", line).strip()


def _kind(line: str) -> str:
    norm = _normalize(line)
    if not norm:
        return "blank"
    if CANARY_RE.search(norm):
        return "canary"
    if SELF_TAG_RE.search(norm) or OBSERVATION_RE.search(norm):
        return "self_observation"
    if any(rx.search(norm) for rx in RECOVERED_UPSTREAM_RES):
        return "recovered_upstream"
    if any(rx.search(norm) for rx in RECOVERED_AUTOCOMMIT_RES):
        return "recovered_autocommit"
    return "unknown"


def _allowed(kind: str, mode: str) -> bool:
    base = {"blank", "canary", "self_observation"}
    if kind in base:
        return True
    if mode in {"known-recovered", "proxy-restart-success"} and kind == "recovered_upstream":
        return True
    return mode in {"known-recovered", "autocommit-success"} and kind == "recovered_autocommit"


def _state(root: Path) -> dict:
    return {
        "error_log": root / "log" / "hme-errors.log",
        "lastread": root / "tools" / "HME" / "runtime" / "errors-lastread",
        "turnstart": root / "tools" / "HME" / "runtime" / "errors-turnstart",
        "inline": root / "tmp" / "hme-errors.inline-watermark",
        "audit": root / "tools" / "HME" / "runtime" / "crying-wolf-reconciled.json",
    }


def reconcile(root: Path, mode: str, reason: str, dry_run: bool = False) -> dict:
    paths = _state(root)
    total = _line_count(paths["error_log"])
    marks = {k: _int_file(paths[k]) for k in ("lastread", "turnstart", "inline")}
    start = min(marks.values()) if marks else 0
    start = min(start, total)
    pending = _read_since(paths["error_log"], start)
    kinds = [_kind(line) for line in pending]
    unknown = [line for line, kind in zip(pending, kinds) if not _allowed(kind, mode)]
    result = {
        "mode": mode,
        "reason": reason,
        "total": total,
        "start": start,
        "pending": len(pending),
        "advanced": False,
        "unknown": len(unknown),
        "kinds": {k: kinds.count(k) for k in sorted(set(kinds))},
    }
    if total <= start or not pending:
        return result
    if unknown:
        result["sample_unknown"] = [_normalize(x)[:160] for x in unknown[:3]]
        return result
    if not dry_run:
        for key in ("lastread", "turnstart", "inline"):
            _write_int(paths[key], total)
        paths["audit"].parent.mkdir(parents=True, exist_ok=True)
        paths["audit"].write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")
    result["advanced"] = True
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project-root", default=os.environ.get("PROJECT_ROOT") or os.getcwd())
    ap.add_argument("--mode", choices=("self-only", "known-recovered", "proxy-restart-success", "autocommit-success"), default="self-only")
    ap.add_argument("--reason", default="manual")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    result = reconcile(Path(args.project_root), args.mode, args.reason, args.dry_run)
    if not args.quiet and (result["advanced"] or result["unknown"]):
        prefix = "advanced" if result["advanced"] else "skipped"
        print(
            f"[crying_wolf] {prefix}: pending={result['pending']} "
            f"total={result['total']} mode={result['mode']} unknown={result['unknown']}",
            file=sys.stderr,
        )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
