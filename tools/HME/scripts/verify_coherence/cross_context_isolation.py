"""Cross-context isolation invariant for proxy/ bounded contexts.

doc/PROXY_CONTEXTS.md declares five contexts (request_mutation,
upstream_dispatch, response_transform, failure_policy,
lifecycle_bridge). Rule 1: cross-context calls must go through the
declared façade module under proxy/contexts/<name>/. Reaching into a
different context's internal helper file is a refactor smell.

This verifier:
  1. Loads tools/HME/config/proxy-contexts.json to know which file
     belongs to which context.
  2. Walks proxy/*.js, parses each require() target.
  3. For an importer in context A requiring a file in context B != A:
     -- if the require path resolves to B's façade, allow it.
     -- otherwise, flag as a cross-context internal reach.

Files not registered in any context default to "infra" (shared
primitives below all contexts; allowed to be required from anywhere).
WARN level: the existing codebase has many such reaches; this
verifier sets the baseline and the rule is meant for new code.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from ._base import (
    Verifier,
    _PROJECT,
    failed,
    passed,
    register,
    skipped,
    warned,
)

REGISTRY_REL = "tools/HME/config/proxy-contexts.json"
PROXY_DIR_REL = "tools/HME/proxy"

_REQUIRE_RE = re.compile(
    r"""require\(\s*['"]([^'"]+)['"]\s*\)""",
)


def _load_registry(root: Path) -> dict | None:
    p = root / REGISTRY_REL
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _build_membership(registry: dict, root: Path) -> tuple[dict, dict]:
    """Return ({rel_path: context_name}, {context_name: facade_rel_path})."""
    membership: dict[str, str] = {}
    facades: dict[str, str] = {}
    for name, entry in (registry.get("contexts") or {}).items():
        facade = entry.get("facade") or ""
        facades[name] = facade
        for f in entry.get("files") or []:
            membership[f] = name
        for pat in entry.get("file_patterns") or []:
            try:
                rx = re.compile(pat)
            except re.error:
                continue
            for f in (root).rglob("*.js"):
                rel = str(f.relative_to(root)).replace("\\", "/")
                if rx.search(rel):
                    membership.setdefault(rel, name)
    return membership, facades


def _resolve_require(importer_rel: str, target: str, root: Path) -> str | None:
    """Resolve a relative require() to a tracked file path (rel to root).
    Only handles ./ and ../ forms; returns None for package imports."""
    if not target.startswith("./") and not target.startswith("../"):
        return None
    importer_path = (root / importer_rel).parent
    candidate = (importer_path / target).resolve()
    try:
        rel = candidate.relative_to(root)
    except ValueError:
        return None
    rel_str = str(rel).replace("\\", "/")
    if rel_str.endswith(".js") or rel_str.endswith(".cjs"):
        if (root / rel_str).is_file():
            return rel_str
    for ext in (".js", ".cjs"):
        if (root / (rel_str + ext)).is_file():
            return rel_str + ext
    if (root / rel_str / "index.js").is_file():
        return f"{rel_str}/index.js"
    return None


def _context_of(rel: str, membership: dict[str, str]) -> str:
    if rel in membership:
        return membership[rel]
    if rel.startswith("tools/HME/proxy/contexts/"):
        parts = rel.split("/")
        if len(parts) >= 5:
            return parts[4]
    return "infra"


@register
class CrossContextIsolationVerifier(Verifier):
    """Detect cross-context require() calls that bypass the declared façade."""

    name = "cross-context-isolation"
    category = "code"
    subtag = "interface-contract"
    weight = 1.0

    def run(self):
        root = Path(_PROJECT)
        registry = _load_registry(root)
        if registry is None:
            return skipped(summary=f"no registry at {REGISTRY_REL}")
        membership, facades = _build_membership(registry, root)
        proxy_dir = root / PROXY_DIR_REL
        if not proxy_dir.is_dir():
            return skipped(summary=f"no proxy dir at {PROXY_DIR_REL}")

        allowed_reaches: set[tuple[str, str]] = set()
        allowed_entries = registry.get("allowed_reaches") or []
        for entry in allowed_entries:
            f = entry.get("from")
            t = entry.get("to")
            if isinstance(f, str) and isinstance(t, str):
                allowed_reaches.add((f, t))

        observed_reaches: set[tuple[str, str]] = set()
        violations: list[str] = []
        checked = 0
        for js in sorted(proxy_dir.rglob("*.js")):
            try:
                importer_rel = str(js.relative_to(root)).replace("\\", "/")
            except ValueError:
                continue
            if "/contexts/" in importer_rel:
                continue
            importer_ctx = _context_of(importer_rel, membership)
            if importer_ctx == "infra":
                continue
            try:
                text = js.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for m in _REQUIRE_RE.finditer(text):
                target = m.group(1)
                resolved = _resolve_require(importer_rel, target, root)
                if resolved is None:
                    continue
                target_ctx = _context_of(resolved, membership)
                if target_ctx == "infra" or target_ctx == importer_ctx:
                    continue
                facade = facades.get(target_ctx, "")
                if resolved == facade:
                    continue
                checked += 1
                pair = (importer_rel, resolved)
                if pair in allowed_reaches:
                    observed_reaches.add(pair)
                    continue
                violations.append(
                    f"{importer_rel} ({importer_ctx}) -> {resolved} "
                    f"({target_ctx}, should go through "
                    f"contexts/{target_ctx}/)"
                )

        stale = []
        for f, t in allowed_reaches - observed_reaches:
            stale.append(
                f"stale allowed_reach: {f} -> {t} no longer occurs; "
                f"remove from {REGISTRY_REL}"
            )
        if stale:
            return failed(
                summary=f"{len(stale)} stale allowed_reach waiver(s)",
                details=stale,
            )

        if not violations:
            return passed(summary="no cross-context internal reaches detected")
        score = max(0.0, 1.0 - len(violations) / 50.0)
        return warned(
            summary=f"{len(violations)} cross-context internal reach(es) bypass façade",
            score=score,
            details=violations[:30],
        )
