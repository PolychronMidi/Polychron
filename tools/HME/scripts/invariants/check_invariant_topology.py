#!/usr/bin/env python3
"""Validate Phase Omega invariant topology metadata."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
TOPOLOGY = ROOT / "tools/HME/config/invariant-topology.json"
CONFIG = ROOT / "tools/HME/config/invariants.json"
REQUIRED = {"intent", "scope", "watched_class", "watcher_of", "watched_by", "known_escape_vectors", "negative_control"}


def _load_doc(path: Path, seen: set[Path] | None = None) -> dict:
    seen = seen or set()
    path = path.resolve()
    if path in seen:
        raise ValueError(f"cyclic include: {path}")
    seen.add(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    invs = list(data.get("invariants") or [])
    merged = {k: v for k, v in data.items() if k not in {"_include", "invariants"}}
    for rel in data.get("_include") or []:
        child = _load_doc((path.parent / rel).resolve(), seen)
        invs.extend(child.get("invariants") or [])
    merged["invariants"] = invs
    return merged


def _str_list(v, *, allow_empty: bool = False) -> bool:
    return isinstance(v, list) and (allow_empty or bool(v)) and all(isinstance(x, str) and x.strip() for x in v)


def main() -> int:
    findings: list[str] = []
    topo = json.loads(TOPOLOGY.read_text(encoding="utf-8"))
    inv_ids = {i.get("id") for i in _load_doc(CONFIG).get("invariants") or [] if i.get("id")}
    nodes = topo.get("nodes") if isinstance(topo, dict) else None
    coverage = topo.get("coverage") if isinstance(topo, dict) else None
    if topo.get("schema") != 1:
        findings.append("invariant-topology schema must be 1")
    if not isinstance(nodes, dict) or not nodes:
        findings.append("invariant-topology nodes must be nonempty object")
        nodes = {}
    if not isinstance(coverage, dict):
        findings.append("coverage must be object")
        coverage = {}
    minimum_nodes = coverage.get("minimum_nodes")
    if not isinstance(minimum_nodes, int) or minimum_nodes < 1:
        findings.append("coverage.minimum_nodes must be positive integer")
    elif len(nodes) < minimum_nodes:
        findings.append(f"coverage below minimum_nodes: {len(nodes)} < {minimum_nodes}")
    required_nodes = coverage.get("required_nodes")
    if not _str_list(required_nodes):
        findings.append("coverage.required_nodes must be nonempty string list")
        required_nodes = []
    for node_id in required_nodes or []:
        if node_id not in nodes:
            findings.append(f"coverage.required_nodes missing node {node_id}")
    for node_id, row in sorted(nodes.items()):
        if node_id not in inv_ids:
            findings.append(f"{node_id}: no matching invariant id")
        if not isinstance(row, dict):
            findings.append(f"{node_id}: row must be object")
            continue
        missing = sorted(REQUIRED - set(row))
        extra = sorted(set(row) - REQUIRED)
        if missing:
            findings.append(f"{node_id}: missing {', '.join(missing)}")
        if extra:
            findings.append(f"{node_id}: extra {', '.join(extra)}")
        for key in ("intent", "watched_class", "negative_control"):
            if not isinstance(row.get(key), str) or not row[key].strip():
                findings.append(f"{node_id}: {key} must be nonempty string")
        for key in ("scope", "known_escape_vectors"):
            if not _str_list(row.get(key)):
                findings.append(f"{node_id}: {key} must be nonempty string list")
        for key in ("watcher_of", "watched_by"):
            if not _str_list(row.get(key), allow_empty=True):
                findings.append(f"{node_id}: {key} must be string list")
            else:
                for ref in row.get(key) or []:
                    if ref not in inv_ids:
                        findings.append(f"{node_id}: {key} references unknown invariant {ref}")
    if "invariant-topology-valid" not in inv_ids:
        findings.append("missing invariant id invariant-topology-valid")
    for row in findings:
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
