#!/usr/bin/env python3
"""Build a per-module KB staleness index.

Runs as a POST_COMPOSITION step in main-pipeline.js. Cross-references three
signals to produce `metrics/kb-staleness.json`:

  1. KB entries (lance table `knowledge`) — each row has a `timestamp`.
  2. Source file mtimes under `src/`.
  3. `metrics/hme-activity.jsonl` — `file_written` events from the Phase 1
     activity bridge (more recent than mtime when the file was modified by
     the Evolver this session).

For every module (one JS file under src/ keyed by stem), computes:
  - last_kb_update_ts: max timestamp of any KB entry mentioning the module
    by title, tags, or content
  - last_file_write_ts: max(file mtime, most-recent file_written event)
  - staleness_delta_s: last_file_write_ts - last_kb_update_ts (can be
    negative if KB is newer than the code — that's FRESH)
  - status: FRESH | STALE | MISSING

Thresholds (tunable via env):
  HME_STALENESS_STALE_DAYS   default 7 — module edited this long after KB
                             entry last touched → STALE
  HME_STALENESS_MISSING      no KB entry at all → MISSING

Output schema (metrics/kb-staleness.json):
  {
    "meta": {timestamp, modules_tracked, by_status},
    "modules": [ {module, file_path, last_kb_update_ts, last_file_write_ts,
                  staleness_delta_s, status, kb_entries_matched}, ... ]
  }

Idempotent, read-only over source and KB. Writes only to metrics/.
"""
from __future__ import annotations

import json
import os
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")
KB_PATH = os.path.join(PROJECT_ROOT, "tools", "HME", "KB")
SRC_DIR = os.path.join(PROJECT_ROOT, "src")
# Tools/HME subtrees ALSO count as project territory — edits to them should
# show up in the coherence score as FRESH/STALE/MISSING too. Previously
# excluded, which made tools/HME/ writes always score touches_with_index_info=0.
HME_DIRS = [
    os.path.join(PROJECT_ROOT, "tools", "HME", "mcp"),
    os.path.join(PROJECT_ROOT, "tools", "HME", "hooks"),
    os.path.join(PROJECT_ROOT, "tools", "HME", "proxy"),
    os.path.join(PROJECT_ROOT, "tools", "HME", "scripts"),
    os.path.join(PROJECT_ROOT, "tools", "HME", "activity"),
]
HME_EXTS = (".js", ".py", ".sh")
ACTIVITY_LOG = os.path.join(METRICS_DIR, "hme-activity.jsonl")
OUT_PATH = os.path.join(METRICS_DIR, "kb-staleness.json")

STALE_DAYS = float(os.environ.get("HME_STALENESS_STALE_DAYS", "7"))
STALE_SECONDS = STALE_DAYS * 86400.0


def walk_src_files() -> dict[str, tuple[str, float]]:
    """Return {module_stem: (rel_path, mtime)} for every .js file under src/
    AND for .js/.py/.sh files under the HME_DIRS tool-infrastructure roots.
    The module stem is the basename without extension, matching the
    watcher's module-naming convention."""
    result: dict[str, tuple[str, float]] = {}
    def _walk_root(dir_path: str, extensions: tuple):
        if not os.path.isdir(dir_path):
            return
        for root, _dirs, files in os.walk(dir_path):
            if "__pycache__" in root:
                continue
            for f in files:
                if not any(f.endswith(e) for e in extensions):
                    continue
                stem = os.path.splitext(f)[0]
                full = os.path.join(root, f)
                rel = os.path.relpath(full, PROJECT_ROOT)
                try:
                    mtime = os.path.getmtime(full)
                except OSError:
                    continue
                # If two files share a stem, prefer src/ over tools/HME/
                # (src is the composition engine; HME is infrastructure).
                existing = result.get(stem)
                if existing is None or (rel.startswith("src/") and not existing[0].startswith("src/")):
                    result[stem] = (rel, mtime)
    _walk_root(SRC_DIR, (".js",))
    for hme_dir in HME_DIRS:
        _walk_root(hme_dir, HME_EXTS)
    return result


def load_activity_writes() -> dict[str, float]:
    """Return {module_stem: latest_ts} from activity bridge file_written events."""
    by_module: dict[str, float] = {}
    if not os.path.exists(ACTIVITY_LOG):
        return by_module
    with open(ACTIVITY_LOG, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("event") != "file_written":
                continue
            module = ev.get("module") or ""
            if not module:
                continue
            ts = ev.get("ts")
            if not isinstance(ts, (int, float)):
                continue
            prev = by_module.get(module)
            if prev is None or ts > prev:
                by_module[module] = float(ts)
    return by_module


def load_kb_entries() -> list[dict]:
    """Load every KB entry. Uses lancedb directly — this script only runs
    inside the pipeline, so the dependency is acceptable."""
    try:
        import lancedb  # noqa: WPS433
    except ImportError:
        print("build-kb-staleness-index: lancedb not available, skipping", file=sys.stderr)
        return []
    try:
        db = lancedb.connect(KB_PATH)
        tbl = db.open_table("knowledge")
        df = tbl.to_pandas()
    except Exception as _err:  # noqa: BLE001
        print(
            f"build-kb-staleness-index: KB read failed ({type(_err).__name__}: {_err})",
            file=sys.stderr,
        )
        return []
    out: list[dict] = []
    for _, row in df.iterrows():
        out.append({
            "id": str(row.get("id", "")),
            "title": str(row.get("title", "")),
            "content": str(row.get("content", "")),
            "tags": str(row.get("tags", "")),
            "timestamp": float(row.get("timestamp", 0) or 0),
        })
    return out


import re as _re

_WORD_BOUNDARY_CACHE: dict[str, _re.Pattern] = {}


def _word_pattern(stem: str) -> _re.Pattern:
    p = _WORD_BOUNDARY_CACHE.get(stem)
    if p is None:
        # Word-boundary match, case-insensitive. Stem can't contain regex
        # metachars because it came from a real filename, but escape anyway.
        p = _re.compile(r"\b" + _re.escape(stem) + r"\b", _re.IGNORECASE)
        _WORD_BOUNDARY_CACHE[stem] = p
    return p


def kb_mentions(entries: list[dict], module_stem: str) -> list[dict]:
    """Return KB entries that mention this module stem. Word-boundary match
    across title / tags / content. Stems shorter than 4 chars are skipped —
    they would over-match common words."""
    if len(module_stem) < 4:
        return []
    pat = _word_pattern(module_stem)
    matched: list[dict] = []
    for e in entries:
        # Title/tags match is strongest signal — always counts.
        if pat.search(e["title"]) or pat.search(e["tags"]):
            matched.append(e)
            continue
        # Content match counts only if the stem is distinctive enough
        # (>= 6 chars). Shorter stems match too much generic prose.
        if len(module_stem) >= 6 and pat.search(e["content"]):
            matched.append(e)
    return matched


def main() -> int:
    now = time.time()
    src_files = walk_src_files()
    if not src_files:
        print("build-kb-staleness-index: no src files found — nothing to audit")
        return 0

    activity_writes = load_activity_writes()
    kb_entries = load_kb_entries()

    modules_out: list[dict] = []
    status_counts = {"FRESH": 0, "STALE": 0, "MISSING": 0}

    for module, (rel_path, mtime) in sorted(src_files.items()):
        activity_ts = activity_writes.get(module, 0.0)
        last_file_write_ts = max(mtime, activity_ts)

        matches = kb_mentions(kb_entries, module)
        if matches:
            last_kb_update_ts = max(m["timestamp"] for m in matches)
        else:
            last_kb_update_ts = 0.0

        if not matches:
            status = "MISSING"
            delta = None
        else:
            delta = last_file_write_ts - last_kb_update_ts
            status = "STALE" if delta > STALE_SECONDS else "FRESH"

        status_counts[status] += 1
        modules_out.append(
            {
                "module": module,
                "file_path": rel_path,
                "last_kb_update_ts": last_kb_update_ts if last_kb_update_ts > 0 else None,
                "last_file_write_ts": last_file_write_ts,
                "staleness_delta_s": delta,
                "staleness_days": round(delta / 86400.0, 2) if delta is not None else None,
                "status": status,
                "kb_entries_matched": len(matches),
            }
        )

    report = {
        "meta": {
            "script": "build-kb-staleness-index.py",
            "timestamp": now,
            "timestamp_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "modules_tracked": len(modules_out),
            "kb_entries_total": len(kb_entries),
            "stale_days_threshold": STALE_DAYS,
            "by_status": status_counts,
        },
        "modules": modules_out,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    pct_stale = (
        round(status_counts["STALE"] * 100.0 / max(len(modules_out), 1), 1)
        if modules_out
        else 0.0
    )
    print(
        f"build-kb-staleness-index: {len(modules_out)} modules tracked, "
        f"{status_counts['FRESH']} fresh, {status_counts['STALE']} stale ({pct_stale}%), "
        f"{status_counts['MISSING']} missing KB coverage"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
