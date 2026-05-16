#!/usr/bin/env python3
"""Prompt-free OmniRoute request visibility helpers."""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _base() -> Path:
    return Path.home() / ".omniroute" / "call_logs"


def _date_dirs(days: int = 2) -> list[Path]:
    base = _base()
    if not base.exists():
        return []
    dirs = [p for p in base.iterdir() if p.is_dir()]
    return sorted(dirs, key=lambda p: p.name, reverse=True)[:days]


def _summary(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(errors="replace"))
    summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    request = data.get("requestBody") if isinstance(data.get("requestBody"), dict) else {}
    response = data.get("responseBody") if isinstance(data.get("responseBody"), dict) else {}
    usage = summary.get("tokens") if isinstance(summary.get("tokens"), dict) else response.get("usage", {})
    return {
        "artifact": str(path),
        "timestamp": summary.get("timestamp") or path.name.split("_")[0].replace("T", "T").replace("-", ":", 2),
        "method": summary.get("method") or "POST",
        "path": summary.get("path") or "",
        "status": summary.get("status"),
        "source_format": summary.get("sourceFormat") or "",
        "target_format": summary.get("targetFormat") or "",
        "requested_model": summary.get("requestedModel") or request.get("model") or "",
        "model": summary.get("model") or "",
        "provider": summary.get("provider") or "",
        "duration_ms": summary.get("duration"),
        "tokens_in": usage.get("in") or usage.get("prompt_tokens") or 0,
        "tokens_out": usage.get("out") or usage.get("completion_tokens") or 0,
        "cache_read": usage.get("cacheRead") or 0,
        "streamed": bool(response.get("_streamed")),
        "error": bool(data.get("error")),
    }


def recent_requests(limit: int = 8, model_contains: str = "") -> list[dict[str, Any]]:
    files: list[Path] = []
    for directory in _date_dirs():
        files.extend(directory.glob("*.json"))
    rows = []
    for path in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            row = _summary(path)
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            continue
        haystack = f"{row.get('requested_model','')} {row.get('model','')}".lower()
        if model_contains and model_contains.lower() not in haystack:
            continue
        rows.append(row)
        if len(rows) >= limit:
            break
    return rows


def recent_injection_advisories(project_root: Path, minutes: int = 10) -> list[str]:
    log = project_root / "log" / "omniroute.out"
    if not log.exists():
        return []
    threshold = time.time() - minutes * 60
    out: list[str] = []
    for line in log.read_text(errors="replace").splitlines()[-400:]:
        if "InjectionGuard" not in line and "Prompt injection detected" not in line:
            continue
        try:
            marker = line.split('"time":"', 1)[1].split('"', 1)[0]
            ts = datetime.fromisoformat(marker.replace("Z", "+00:00")).timestamp()
            if ts < threshold:
                continue
        except (IndexError, ValueError):
            pass
        out.append(line[:240])
    return out


def format_rows(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "  recent: none"
    lines = []
    for row in rows:
        lines.append(
            "  {timestamp} {status} {source_format}->{target_format} {requested_model} provider={provider} in={tokens_in} out={tokens_out}".format(**row)
        )
    return "\n".join(lines)


if __name__ == "__main__":
    print(format_rows(recent_requests()))
