#!/usr/bin/env python3
"""Update generated sections inside doc/self-coherence-full.md from live data."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

START = "<!-- doc-infra-generated:start -->"
END = "<!-- doc-infra-generated:end -->"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root)).rstrip("/")


def verifier_names(root: Path) -> list[str]:
    names: list[str] = []
    for path in sorted((root / "tools/HME/scripts/verify_coherence").glob("*.py")):
        if path.name.startswith("_") or path.name == "__init__.py":
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        names.extend(re.findall(r"\bname\s*=\s*['\"]([^'\"]+)['\"]", text))
    return sorted(set(names))


def summary_for(root: Path, source: dict) -> str:
    path = root / source["path"]
    key = source.get("summary")
    if key == "project_boundaries":
        data = load_json(path)
        return f"{len(data.get('subsystems') or {})} subsystem rows, {len(data.get('canonical_destinations') or {})} canonical destination classes"
    if key == "depth_policy":
        data = load_json(path)
        return f"{len(data.get('escalation_profiles') or {})} depth profiles, {len(data.get('gate_min_depth') or {})} evidence gates"
    if key == "models":
        data = load_json(path)
        providers = (data.get("_meta") or {}).get("providers") or {}
        skipped = (data.get("providers_to_skip") or {}).get("providers") or []
        return f"{len(providers)} providers declared, {len(skipped)} currently paused by `providers_to_skip`"
    if key == "services":
        data = load_json(path)
        return f"{len(data.get('services') or {})} service declarations"
    if key == "i_registry":
        data = load_json(path)
        return f"{len(data.get('commands') or {})} command shims, {len(data.get('scripts') or {})} script shims"
    if key == "adapter_boundaries":
        data = load_json(path)
        return f"{len(data.get('boundaries') or {})} boundary classes"
    if key == "dispatcher_routes":
        data = load_json(path)
        return f"{len(data.get('routes') or {})} hook-event routes, {len(data.get('observation_events') or [])} observation events"
    if key == "state_files":
        data = load_json(path)
        return f"{len(data.get('files') or {})} typed state files, {len(data.get('single_owner') or {})} single-owner domains"
    if key == "phase_evidence":
        data = load_json(path)
        return f"{len(data.get('phases') or [])} phase proof rows, {len(data.get('closes_enum') or [])} closes classes, {len(data.get('does_not_prove_enum') or [])} non-proof bounds"
    if key == "verifiers":
        return f"{len(verifier_names(root))} verifier names discovered from source"
    return "source declared"


def generated_block(root: Path) -> str:
    source_contract_path = root / "tools/HME/config/generated-doc-sources.json"
    source_contract = load_json(source_contract_path)
    sources = source_contract.get("sources") or []
    boundaries = load_json(root / "tools/HME/project_boundaries.json")
    canonical = boundaries.get("canonical_destinations") or {}

    lines = [
        START,
        "",
        "Generated from machine-readable sources by `python3 doc/infra/update_self_coherence.py`. Do not hand-edit inside this block.",
        "",
        "### Machine-derived coherence sources",
        "",
        f"- Generated-source contract: [`{rel(source_contract_path, root)}`](../{rel(source_contract_path, root)}) -- {len(sources)} required source projections.",
    ]
    for src in sources:
        src_path = root / src["path"]
        link = rel(src_path, root)
        lines.append(f"- {src['label']}: [`{link}`](../{link}) -- {summary_for(root, src)}.")
    lines.extend(["", "Canonical destination summary:"])
    for key in sorted(canonical):
        value = canonical[key]
        if isinstance(value, list):
            value = ", ".join(map(str, value))
        lines.append(f"- `{key}` -> `{value}`")
    lines.extend(["", END])
    return "\n".join(lines)


def update_text(text: str, root: Path) -> str:
    block = generated_block(root)
    if START in text and END in text:
        pattern = re.compile(re.escape(START) + r"[\s\S]*?" + re.escape(END))
        return pattern.sub(block, text, count=1)
    anchor = "## Registries\n\n"
    if anchor not in text:
        raise SystemExit("doc/self-coherence-full.md missing ## Registries anchor")
    return text.replace(anchor, anchor + block + "\n\n", 1)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Update generated self-coherence doc sections")
    parser.add_argument("--check", action="store_true")
    ns = parser.parse_args(argv)
    root = repo_root()
    path = root / "doc/self-coherence-full.md"
    original = path.read_text(encoding="utf-8")
    updated = update_text(original, root)
    if ns.check:
        if updated != original:
            print(f"{path} generated section is stale", file=sys.stderr)
            return 1
        return 0
    if updated != original:
        path.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
