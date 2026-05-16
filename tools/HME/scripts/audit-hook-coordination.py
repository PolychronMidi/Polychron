#!/usr/bin/env python3
"""Audit hook coordination -- PAI v6.3.0 import #10.

PAI hooks declare their lifecycle position via docstring directives:

    MUST RUN BEFORE: <hook>, <hook>
    MUST RUN AFTER:  <hook>, <hook>
    COORDINATES WITH: <hook>, <hook>

This audit:
  (1) Walks all stop-chain policies and lifecycle hook scripts.
  (2) Parses each file's leading comment block / docstring for the
      directives above (case-insensitive, comma-separated names).
  (3) Builds a directed graph from MUST RUN BEFORE/AFTER edges.
  (4) Refuses cycles (would deadlock the runtime ordering).
  (5) For stop-chain policies, cross-checks declared edges against the
      actual POLICY_NAMES order in tools/HME/proxy/stop_chain/index.js.

COORDINATES WITH is informational (no ordering implication) -- surfaces
shared per-turn state that could fight with another hook silently. The
audit reports declared coordinations so a developer can read dependency
relationships without tracing execution.

Usage:
    python3 tools/HME/scripts/audit-hook-coordination.py
    python3 tools/HME/scripts/audit-hook-coordination.py --json
    python3 tools/HME/scripts/audit-hook-coordination.py --strict   # exit 1 on issues
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parent.parent)

_POLICY_DIR = _PROJECT / "tools" / "HME" / "proxy" / "stop_chain" / "policies"
_HOOK_DIR = _PROJECT / "tools" / "HME" / "hooks" / "lifecycle"
_INDEX_JS = _PROJECT / "tools" / "HME" / "proxy" / "stop_chain" / "index.js"

# Capture the leading directive line: prefix ("// " or "# " or "* ") + key + names.
_DIRECTIVE_RES = {
    "before": re.compile(
        r"^\s*(?:[\*#/]+\s*)*MUST\s+RUN\s+BEFORE\s*:\s*(.+?)\s*$",
        re.IGNORECASE | re.MULTILINE),
    "after": re.compile(
        r"^\s*(?:[\*#/]+\s*)*MUST\s+RUN\s+AFTER\s*:\s*(.+?)\s*$",
        re.IGNORECASE | re.MULTILINE),
    "coordinates": re.compile(
        r"^\s*(?:[\*#/]+\s*)*COORDINATES\s+WITH\s*:\s*(.+?)\s*$",
        re.IGNORECASE | re.MULTILINE),
}

# Read POLICY_NAMES from index.js so the audit can cross-check declared
# edges against the runtime ordering.
_POLICY_NAMES_RE = re.compile(
    r"const\s+POLICY_NAMES\s*=\s*\[([^\]]*)\]", re.MULTILINE)
_POLICY_NAME_ITEM_RE = re.compile(r"['\"]([^'\"]+)['\"]")


def _read_policy_order() -> list[str]:
    if not _INDEX_JS.is_file():
        return []
    src = _INDEX_JS.read_text(encoding="utf-8")
    m = _POLICY_NAMES_RE.search(src)
    if not m:
        return []
    return _POLICY_NAME_ITEM_RE.findall(m.group(1))


def _read_head(path: Path, max_lines: int = 80) -> str:
    """Read the first N lines -- enough to span any leading docstring /
    comment block without scanning the whole file."""
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i >= max_lines:
                    break
                out.append(line)
    except OSError:
        return ""
    return "".join(out)


def _parse_directives(text: str) -> dict[str, list[str]]:
    """Extract MUST RUN BEFORE / MUST RUN AFTER / COORDINATES WITH lists."""
    out = {"before": [], "after": [], "coordinates": []}
    for key, pat in _DIRECTIVE_RES.items():
        for m in pat.finditer(text):
            raw = m.group(1)
            for name in re.split(r"[,;]+", raw):
                name = name.strip().strip(".").strip()
                if name:
                    out[key].append(name)
    return out


def _scan_files() -> dict[str, dict]:
    """Return {hook_name: {path, before, after, coordinates}}."""
    found: dict[str, dict] = {}
    for js in _POLICY_DIR.glob("*.js"):
        name = js.stem
        d = _parse_directives(_read_head(js))
        if any(d.values()):
            found[f"policy:{name}"] = {**d, "path": str(js.relative_to(_PROJECT))}
    for hook in _HOOK_DIR.rglob("*.sh"):
        name = hook.stem
        d = _parse_directives(_read_head(hook))
        if any(d.values()):
            found[f"hook:{name}"] = {**d, "path": str(hook.relative_to(_PROJECT))}
    return found


def _build_graph(decls: dict[str, dict]) -> dict[str, set[str]]:
    """Edge a->b means 'a must run before b'."""
    g: dict[str, set[str]] = defaultdict(set)
    for src, d in decls.items():
        bare_src = src.split(":", 1)[1]
        for tgt in d["before"]:
            g[bare_src].add(tgt)
        for tgt in d["after"]:
            # `src must run after tgt` => tgt must run before src
            g[tgt].add(bare_src)
    return g


def _detect_cycle(g: dict[str, set[str]]) -> list[str] | None:
    """Return a cycle as a path of node names if one exists, else None."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = defaultdict(lambda: WHITE)
    parent: dict[str, str | None] = defaultdict(lambda: None)

    def dfs(u: str) -> list[str] | None:
        color[u] = GRAY
        for v in sorted(g.get(u, set())):
            if color[v] == GRAY:
                cycle = [v, u]
                p = parent[u]
                while p and p != v:
                    cycle.append(p)
                    p = parent[p]
                cycle.append(v)
                return list(reversed(cycle))
            if color[v] == WHITE:
                parent[v] = u
                c = dfs(v)
                if c:
                    return c
        color[u] = BLACK
        return None

    for node in sorted(g.keys()):
        if color[node] == WHITE:
            c = dfs(node)
            if c:
                return c
    return None


def _validate_against_runtime(decls: dict[str, dict],
                              order: list[str]) -> list[str]:
    """For policies, check declared MUST RUN BEFORE/AFTER against the
    runtime POLICY_NAMES order. Returns a list of violation strings."""
    pos = {name: i for i, name in enumerate(order)}
    violations = []
    for src, d in decls.items():
        if not src.startswith("policy:"):
            continue
        bare = src.split(":", 1)[1]
        if bare not in pos:
            continue
        for tgt in d["before"]:
            if tgt not in pos:
                continue
            if pos[bare] >= pos[tgt]:
                violations.append(
                    f"{bare}: declared MUST RUN BEFORE {tgt}, but runtime "
                    f"order has {bare} at index {pos[bare]} >= {tgt} at {pos[tgt]}"
                )
        for tgt in d["after"]:
            if tgt not in pos:
                continue
            if pos[bare] <= pos[tgt]:
                violations.append(
                    f"{bare}: declared MUST RUN AFTER {tgt}, but runtime "
                    f"order has {bare} at index {pos[bare]} <= {tgt} at {pos[tgt]}"
                )
    return violations


def main(argv: list) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--json", action="store_true")
    p.add_argument("--strict", action="store_true")
    args = p.parse_args(argv)

    decls = _scan_files()
    runtime_order = _read_policy_order()

    graph = _build_graph(decls)
    cycle = _detect_cycle(graph)
    runtime_violations = _validate_against_runtime(decls, runtime_order)

    findings = {
        "annotated_count": len(decls),
        "runtime_policy_order": runtime_order,
        "cycle": cycle,
        "runtime_violations": runtime_violations,
        "declarations": {
            name: {k: v for k, v in d.items() if k != "path" or v}
            for name, d in sorted(decls.items())
        },
    }

    if args.json:
        print(json.dumps(findings, indent=2, default=list))
    else:
        print(f"audit-hook-coordination: {len(decls)} annotated hook(s) scanned")
        if not decls:
            print("  no docstring directives found -- annotate hooks with")
            print("  'MUST RUN BEFORE/AFTER/COORDINATES WITH: <name>'")
        else:
            for name, d in sorted(decls.items()):
                parts = []
                if d["before"]:
                    parts.append("before " + ", ".join(d["before"]))
                if d["after"]:
                    parts.append("after " + ", ".join(d["after"]))
                if d["coordinates"]:
                    parts.append("coord " + ", ".join(d["coordinates"]))
                print(f"  {name}: " + "; ".join(parts))
        if cycle:
            print(f"\n  CYCLE detected: {' -> '.join(cycle)}")
        if runtime_violations:
            print(f"\n  runtime-order violations ({len(runtime_violations)}):")
            for v in runtime_violations:
                print(f"    {v}")
        if not cycle and not runtime_violations:
            print("\n  graph acyclic; runtime order matches declared edges.")

    if args.strict and (cycle or runtime_violations):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
