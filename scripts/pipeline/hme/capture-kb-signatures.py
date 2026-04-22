#!/usr/bin/env python3
"""Phase 3.3 — Capture baseline structural signatures for existing KB entries.

Walks the lance `knowledge` table, guesses a module per entry (by scanning
the title first, then the `tags` field, then the content for a filename-
shaped token), and records the module's current structural signature into
`metrics/kb-signatures.json` keyed by entry id.

This is a one-shot bootstrapping script and an ongoing maintenance tool —
re-run it whenever new KB entries are added to refresh the baseline set.
Subsequent drift checks compare live state against these baselines.

Running it preserves entries already captured. Only entries whose signature
field differs (or is missing) are (re)written. Capturing an entry again
overwrites its baseline — the principle is "baseline = signature at most
recent `learn(add)` event", so the newest capture wins.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")
KB_PATH = os.path.join(PROJECT_ROOT, "tools", "HME", "KB")
OUT_PATH = os.path.join(METRICS_DIR, "kb-signatures.json")

# Import current_signature() from the sibling drift checker — that's the
# single source of truth for signature composition. runpy handles the
# hyphenated filename that regular import can't.
import runpy

_drift_module_ns = runpy.run_path(
    os.path.join(os.path.dirname(__file__), "check-kb-semantic-drift.py")
)
current_signature = _drift_module_ns["current_signature"]


_MODULE_TOKEN_RE = re.compile(r"\b([a-z][a-zA-Z0-9]{3,}(?:[A-Z][a-zA-Z0-9]+)+)\b")


def _load_json(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _load_existing() -> dict:
    data = _load_json(OUT_PATH)
    if isinstance(data, dict) and "entries" in data:
        return data
    return {"meta": {"created": int(time.time())}, "entries": {}}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    data.setdefault("meta", {})
    data["meta"]["updated"] = int(time.time())
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def _extract_candidate_modules(title: str, tags: str, content: str) -> list[str]:
    """Return plausible module stems referenced by this KB entry, ranked
    by evidence strength (title > tags > content)."""
    out: list[str] = []
    seen: set[str] = set()
    for src_text in (title or "", tags or ""):
        for m in _MODULE_TOKEN_RE.finditer(src_text):
            tok = m.group(1)
            if tok not in seen:
                seen.add(tok)
                out.append(tok)
    # Content matches are weaker — only pull a few
    content_limit = 3
    ct = content or ""
    for m in _MODULE_TOKEN_RE.finditer(ct):
        if content_limit <= 0:
            break
        tok = m.group(1)
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
            content_limit -= 1
    return out


def _pick_module(candidates: list[str], dep_nodes: dict) -> str | None:
    """Pick the first candidate whose stem actually exists as a JS file."""
    known_stems: set[str] = set()
    for path in dep_nodes:
        known_stems.add(os.path.splitext(os.path.basename(path))[0])
    for c in candidates:
        if c in known_stems:
            return c
    return None


def main() -> int:
    try:
        import lancedb  # noqa: WPS433
    except ImportError:
        print("capture-kb-signatures: lancedb not available, skipping", file=sys.stderr)
        return 0
    try:
        db = lancedb.connect(KB_PATH)
        tbl = db.open_table("knowledge")
        df = tbl.to_pandas()
    except Exception as _e:  # noqa: BLE001
        print(
            f"capture-kb-signatures: KB read failed ({type(_e).__name__}: {_e})",
            file=sys.stderr,
        )
        return 0

    # Load dep graph once for module-stem disambiguation
    dep_graph = _load_json(
        os.path.join(METRICS_DIR, "dependency-graph.json")
    ) or {"nodes": {}}
    dep_nodes = dep_graph.get("nodes", {}) or {}

    data = _load_existing()
    entries = data.setdefault("entries", {})
    captured = 0
    matched_modules = 0

    for _, row in df.iterrows():
        entry_id = str(row.get("id", ""))
        if not entry_id:
            continue
        title = str(row.get("title", "") or "")
        tags = str(row.get("tags", "") or "")
        content = str(row.get("content", "") or "")
        cand = _extract_candidate_modules(title, tags, content)
        module = _pick_module(cand, dep_nodes)
        if not module:
            # Still record a placeholder so we track coverage but skip signature
            entries[entry_id] = {
                "id": entry_id,
                "title": title[:120],
                "module": None,
                "captured_ts": int(time.time()),
                "signature": None,
            }
            continue
        sig = current_signature(module)
        if not sig.get("found"):
            continue
        entries[entry_id] = {
            "id": entry_id,
            "title": title[:120],
            "module": module,
            "captured_ts": int(time.time()),
            "signature": sig,
        }
        matched_modules += 1
        captured += 1

    _save(data)
    total = len(entries)
    print(
        f"capture-kb-signatures: wrote {total} entry record(s) "
        f"({matched_modules} with module signatures)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
