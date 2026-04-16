#!/usr/bin/env python3
"""Phase 3.3 — KB semantic drift verifier.

For every module that has a baseline signature in `metrics/kb-signatures.json`,
re-derives the current structural signature from the live repo (callers from
dependency graph, bias registrations from the bounds manifest, L0 channel
I/O from the source, firewall ports from the feedback graph) and diffs.
Modules whose signature has meaningfully diverged get flagged as SEMANTIC_DRIFT
in `metrics/hme-semantic-drift.json`.

Distinct from staleness: staleness says "the file was edited after the KB
entry was written". Drift says "even if the KB entry is recent, the module's
structural relationships have shifted enough that the description is likely
wrong". You can have a semantically wrong entry written yesterday if the
describer didn't know about a new caller path.

Runs as a POST_COMPOSITION step. Non-fatal.

The signature is deterministic given fixed inputs, so a stable repo produces
a stable signature and drift reports monotonically.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time

PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get(
    "PROJECT_ROOT", "/home/jah/Polychron"
)
SIGNATURES_PATH = os.path.join(PROJECT_ROOT, "metrics", "kb-signatures.json")
DRIFT_OUT = os.path.join(PROJECT_ROOT, "metrics", "hme-semantic-drift.json")
DEP_GRAPH = os.path.join(PROJECT_ROOT, "metrics", "dependency-graph.json")
BIAS_MANIFEST = os.path.join(PROJECT_ROOT, "scripts", "pipeline", "bias-bounds-manifest.json")
FEEDBACK_GRAPH = os.path.join(PROJECT_ROOT, "metrics", "feedback_graph.json")
SRC_DIR = os.path.join(PROJECT_ROOT, "src")

# A drift is flagged when the structural signature differs by at least this
# many components. 1 → any single change triggers. Default 2 avoids
# nickel-and-dime churn while still catching meaningful shifts.
DRIFT_THRESHOLD = int(os.environ.get("HME_DRIFT_THRESHOLD", "2"))


def _load_json(path: str) -> dict | list | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _find_file_for_module(module: str, dep_nodes: dict) -> str | None:
    """Return the canonical src/... path for a module stem."""
    if not module:
        return None
    for path in dep_nodes:
        base = os.path.splitext(os.path.basename(path))[0]
        if base == module:
            return path
    return None


def _caller_count(file_path: str, dep_edges: list) -> int:
    return sum(1 for e in dep_edges if e.get("to") == file_path)


def _provides(file_path: str, dep_nodes: dict) -> list[str]:
    node = dep_nodes.get(file_path) or {}
    return sorted(node.get("provides", []) or [])


def _consumes(file_path: str, dep_nodes: dict) -> list[str]:
    node = dep_nodes.get(file_path) or {}
    return sorted(node.get("consumes", []) or [])


def _bias_keys(file_path: str, bias_regs: dict) -> list[str]:
    return sorted(
        k
        for k, v in bias_regs.items()
        if isinstance(v, dict) and v.get("file", "").endswith(file_path)
    )


def _firewall_ports(module: str, feedback: dict) -> list[str]:
    ports = feedback.get("firewallPorts", []) or []
    out: list[str] = []
    for p in ports:
        blob = json.dumps(p)
        if module in blob:
            out.append(p.get("id", "?"))
    return sorted(set(out))


def _l0_io(file_path: str) -> dict:
    """Rough parse: count L0_CHANNELS.xxx references per direction (post/on)."""
    full = os.path.join(PROJECT_ROOT, file_path)
    if not os.path.exists(full):
        return {"post": [], "on": []}
    try:
        with open(full, encoding="utf-8", errors="ignore") as f:
            src = f.read()
    except OSError:
        return {"post": [], "on": []}
    post_matches = sorted(set(re.findall(r"\bL0\.post\(\s*L0_CHANNELS\.(\w+)", src)))
    on_matches = sorted(set(re.findall(r"\bL0\.on\(\s*L0_CHANNELS\.(\w+)", src)))
    return {"post": post_matches, "on": on_matches}


def current_signature(module: str) -> dict:
    """Re-derive the module's structural signature from live repo state."""
    dep_graph = _load_json(DEP_GRAPH) or {"nodes": {}, "edges": []}
    bias = _load_json(BIAS_MANIFEST) or {"registrations": {}}
    feedback = _load_json(FEEDBACK_GRAPH) or {}
    dep_nodes = dep_graph.get("nodes", {}) or {}
    dep_edges = dep_graph.get("edges", []) or []
    bias_regs = bias.get("registrations", {}) or {}

    file_path = _find_file_for_module(module, dep_nodes)
    if not file_path:
        return {"module": module, "found": False}

    caller_n = _caller_count(file_path, dep_edges)
    provides = _provides(file_path, dep_nodes)
    consumes = _consumes(file_path, dep_nodes)
    bias_keys = _bias_keys(file_path, bias_regs)
    fw_ports = _firewall_ports(module, feedback)
    l0 = _l0_io(file_path)

    # A small content fingerprint — first 8 hex chars of BLAKE2b over the
    # file bytes. Not full content; just enough to detect "same structure,
    # totally rewritten body".
    content_hash = ""
    try:
        with open(os.path.join(PROJECT_ROOT, file_path), "rb") as fb:
            content_hash = hashlib.blake2b(fb.read(), digest_size=8).hexdigest()
    except OSError:
        pass

    return {
        "module": module,
        "file_path": file_path,
        "found": True,
        "caller_count": caller_n,
        "provides": provides,
        "consumes": consumes,
        "bias_keys": bias_keys,
        "firewall_ports": fw_ports,
        "l0_post": l0["post"],
        "l0_on": l0["on"],
        "content_hash_prefix": content_hash,
        "computed_ts": int(time.time()),
    }


def _diff_signatures(baseline: dict, current: dict) -> list[dict]:
    """Return a list of divergence records."""
    diffs: list[dict] = []
    if not baseline.get("found") or not current.get("found"):
        return diffs
    # Numeric fields
    b_callers = baseline.get("caller_count", 0)
    c_callers = current.get("caller_count", 0)
    if abs(c_callers - b_callers) >= 2:
        diffs.append({
            "field": "caller_count",
            "baseline": b_callers,
            "current": c_callers,
            "delta": c_callers - b_callers,
        })
    # Set fields
    for field in ("provides", "consumes", "bias_keys", "firewall_ports", "l0_post", "l0_on"):
        b_set = set(baseline.get(field) or [])
        c_set = set(current.get(field) or [])
        added = c_set - b_set
        removed = b_set - c_set
        if added or removed:
            diffs.append({
                "field": field,
                "added": sorted(added),
                "removed": sorted(removed),
            })
    # Content hash is informational — always report if it changed
    if baseline.get("content_hash_prefix") != current.get("content_hash_prefix"):
        diffs.append({
            "field": "content_hash_prefix",
            "baseline": baseline.get("content_hash_prefix", ""),
            "current": current.get("content_hash_prefix", ""),
        })
    return diffs


def main() -> int:
    sigs = _load_json(SIGNATURES_PATH) or {"entries": {}}
    entries = sigs.get("entries", {}) or {}
    drift_records: list[dict] = []
    verified = 0

    for entry_id, info in entries.items():
        module = info.get("module")
        baseline = info.get("signature") or {}
        if not module or not baseline:
            continue
        current = current_signature(module)
        verified += 1
        diffs = _diff_signatures(baseline, current)
        # Separate out content hash so threshold works on structural diffs only
        structural_diffs = [d for d in diffs if d.get("field") != "content_hash_prefix"]
        if len(structural_diffs) >= DRIFT_THRESHOLD:
            drift_records.append({
                "entry_id": entry_id,
                "module": module,
                "file_path": current.get("file_path"),
                "kb_title": info.get("title", ""),
                "baseline_ts": baseline.get("computed_ts"),
                "current_ts": current.get("computed_ts"),
                "diffs": diffs,
                "structural_diff_count": len(structural_diffs),
            })

    report = {
        "meta": {
            "script": "check-kb-semantic-drift.py",
            "timestamp": int(time.time()),
            "signatures_total": len(entries),
            "verified": verified,
            "drifted": len(drift_records),
            "threshold": DRIFT_THRESHOLD,
        },
        "drifted_entries": drift_records,
    }
    os.makedirs(os.path.dirname(DRIFT_OUT), exist_ok=True)
    with open(DRIFT_OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    status = "PASS" if not drift_records else "WARN"
    print(
        f"check-kb-semantic-drift: {status} — {verified} signature(s) checked, "
        f"{len(drift_records)} entry(s) drifted (threshold={DRIFT_THRESHOLD})"
    )
    for d in drift_records[:10]:
        fields = ",".join(sorted({x["field"] for x in d["diffs"]}))
        print(f"  - {d['module']} ({d['entry_id'][:8]}): drifted [{fields}]")
    if len(drift_records) > 10:
        print(f"  … and {len(drift_records) - 10} more")
    return 0  # non-fatal; drift is a warning, not a pipeline blocker


if __name__ == "__main__":
    sys.exit(main())
