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
    return str(path.relative_to(root))


def verifier_names(root: Path) -> list[str]:
    names: list[str] = []
    for path in sorted((root / "tools/HME/scripts/verify_coherence").glob("*.py")):
        if path.name.startswith("_") or path.name == "__init__.py":
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        names.extend(re.findall(r"\bname\s*=\s*['\"]([^'\"]+)['\"]", text))
    return sorted(set(names))


def generated_block(root: Path) -> str:
    boundaries_path = root / "tools/HME/project_boundaries.json"
    depth_path = root / "teams/rounds/depth_policy.json"
    models_path = root / "config/models.json"
    boundaries = load_json(boundaries_path)
    depth = load_json(depth_path)
    models = load_json(models_path)
    subsystems = boundaries.get("subsystems") or {}
    canonical = boundaries.get("canonical_destinations") or {}
    profiles = depth.get("escalation_profiles") or {}
    gates = depth.get("gate_min_depth") or {}
    skipped = (models.get("providers_to_skip") or {}).get("providers") or []
    providers = (models.get("_meta") or {}).get("providers") or {}
    verifiers = verifier_names(root)

    lines = [
        START,
        "",
        "Generated from machine-readable sources by `python3 doc/infra/update_self_coherence.py`. Do not hand-edit inside this block.",
        "",
        "### Machine-derived coherence sources",
        "",
        f"- Project boundary map: [`{rel(boundaries_path, root)}`](../{rel(boundaries_path, root)}) -- {len(subsystems)} subsystem rows, {len(canonical)} canonical destination classes.",
        f"- Mesh depth policy: [`{rel(depth_path, root)}`](../{rel(depth_path, root)}) -- {len(profiles)} depth profiles, {len(gates)} evidence gates.",
        f"- Model/provider registry: [`{rel(models_path, root)}`](../{rel(models_path, root)}) -- {len(providers)} providers declared, {len(skipped)} currently paused by `providers_to_skip`.",
        f"- HCI verifier registry: [`tools/HME/scripts/verify_coherence/`](../tools/HME/scripts/verify_coherence/) -- {len(verifiers)} verifier names discovered from source.",
        "",
        "Canonical destination summary:",
    ]
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
