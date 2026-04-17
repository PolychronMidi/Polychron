#!/usr/bin/env python3
"""Aggregate README.md frontmatter across the project into metrics/hme-dir-intent.json.

Reads every README.md containing a YAML frontmatter block; validates the schema,
computes a drift signature per directory, and emits a single JSON index. Also
flags directories that look like cohesion boundaries but are missing a README.

Used by:
  - tools/HME/proxy/middleware/dir_context.js (injects local rules on tool calls)
  - review(mode='health') surfaces drifted / missing READMEs

See doc/DIR_INTENT.md for the schema and conventions.
"""
import hashlib
import json
import os
import re
import sys
import time
from typing import Optional

try:
    import yaml  # PyYAML
except ImportError:
    print("ERROR: PyYAML required. pip install pyyaml", file=sys.stderr)
    sys.exit(2)


PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
OUTPUT = os.path.join(PROJECT, "metrics", "hme-dir-intent.json")
SIGNATURES = os.path.join(PROJECT, "metrics", "hme-dir-signatures.json")

# Dirs never walked
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
    "out", ".claude", "tmp", "log", ".pytest_cache", "output",
}

# Files that signal a dir is a cohesion boundary (candidate for README)
BOUNDARY_MARKERS = ("index.js", "index.ts", "__init__.py", "Manager.js")

# Extensions counted as "source files" for cohesion scoring
SOURCE_EXTS = {".js", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".sh"}

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


# Fields that identify a README as using OUR schema (vs e.g. HuggingFace model cards).
# If none of these fields are present, the README is using some other frontmatter
# convention and we ignore it entirely (not flag as invalid).
_SCHEMA_FINGERPRINT = {"rules", "info"}


def _parse_frontmatter(path: str) -> Optional[dict]:
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read(8192)  # cap read — frontmatter is always at the top
    except OSError:
        return None
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError as e:
        return {"_parse_error": str(e), "_uses_our_schema": True}
    if not isinstance(data, dict):
        return None
    # Only track READMEs using our schema — skip HF model cards and other conventions.
    if not (_SCHEMA_FINGERPRINT & set(data.keys())):
        return None
    data["_uses_our_schema"] = True
    return data


def _dir_signature(dir_abs: str) -> dict:
    """Signature stable across runs unless files change at this dir's top level."""
    try:
        entries = sorted(os.listdir(dir_abs))
    except OSError:
        return {"file_count": 0, "file_list_hash": "", "manager_hash": ""}
    names = [n for n in entries if not n.startswith(".") and n != "README.md"]
    source_count = sum(
        1 for n in names
        if os.path.isfile(os.path.join(dir_abs, n))
        and os.path.splitext(n)[1] in SOURCE_EXTS
    )
    list_hash = hashlib.sha1("\n".join(names).encode()).hexdigest()[:12]
    # Hash the manager/index content so we detect structural changes
    manager_hash = ""
    for marker in BOUNDARY_MARKERS:
        p = os.path.join(dir_abs, marker)
        if os.path.isfile(p):
            try:
                with open(p, "rb") as f:
                    manager_hash = hashlib.sha1(f.read()).hexdigest()[:12]
                break
            except OSError:
                pass
    return {
        "file_count": source_count,
        "file_list_hash": list_hash,
        "manager_hash": manager_hash,
    }


def _is_boundary(dir_abs: str) -> bool:
    """Heuristic: a dir is a cohesion boundary if it has ≥5 source files AND
    has an index/manager file (indicating it exposes an API)."""
    try:
        entries = os.listdir(dir_abs)
    except OSError:
        return False
    source_count = sum(
        1 for n in entries
        if os.path.isfile(os.path.join(dir_abs, n))
        and os.path.splitext(n)[1] in SOURCE_EXTS
    )
    if source_count < 5:
        return False
    has_marker = any(
        os.path.isfile(os.path.join(dir_abs, m)) for m in BOUNDARY_MARKERS
    )
    if has_marker:
        return True
    # Secondary: Manager.js or <Dirname>.js as a single entry point
    dirname = os.path.basename(dir_abs)
    pascal = dirname[:1].upper() + dirname[1:]
    alt_managers = [f"{dirname}Manager.js", f"{pascal}Manager.js", f"{dirname}.js"]
    return any(os.path.isfile(os.path.join(dir_abs, m)) for m in alt_managers)


def _validate(rel_dir: str, data: dict) -> list[str]:
    """Return a list of validation errors. Empty list = valid."""
    errors = []
    if "_parse_error" in data:
        errors.append(f"yaml parse error: {data['_parse_error']}")
        return errors
    name = data.get("name", "")
    expected_name = os.path.basename(rel_dir)
    if name != expected_name:
        errors.append(f"name={name!r} does not match dirname={expected_name!r}")
    rules = data.get("rules")
    if rules is None:
        errors.append("missing required field: rules")
    elif not isinstance(rules, list) or not all(isinstance(r, str) for r in rules):
        errors.append("rules must be a list of strings")
    elif not rules:
        errors.append("rules list is empty — if there are no local rules, this dir shouldn't have a README")
    if "info" not in data:
        errors.append("missing required field: info")
    elif not isinstance(data["info"], str):
        errors.append("info must be a string")
    children = data.get("children")
    if children is not None and not isinstance(children, dict):
        errors.append("children must be a mapping (dict)")
    return errors


def _load_signatures_cache() -> dict:
    try:
        with open(SIGNATURES) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _save_signatures_cache(cache: dict) -> None:
    os.makedirs(os.path.dirname(SIGNATURES), exist_ok=True)
    with open(SIGNATURES, "w") as f:
        json.dump(cache, f, indent=2, sort_keys=True)


def build() -> dict:
    readmes = {}  # rel_dir -> frontmatter dict
    candidates = []  # dirs that look like boundaries but have no README
    sig_cache = _load_signatures_cache()

    for root, dirs, files in os.walk(PROJECT, followlinks=False):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        rel = os.path.relpath(root, PROJECT)
        if "README.md" in files:
            fm = _parse_frontmatter(os.path.join(root, "README.md"))
            if fm is not None:
                readmes[rel] = fm
        elif _is_boundary(root) and rel != ".":
            candidates.append(rel)

    dirs_out = {}
    drifted = 0
    invalid = 0
    new_sig_cache = {}
    for rel, fm in readmes.items():
        abs_dir = os.path.join(PROJECT, rel)
        errors = _validate(rel, fm)
        sig = _dir_signature(abs_dir)
        stored = sig_cache.get(rel, {})
        is_drifted = bool(stored) and (
            stored.get("file_list_hash") != sig["file_list_hash"]
            or stored.get("manager_hash") != sig["manager_hash"]
        )
        if is_drifted:
            drifted += 1
        if errors:
            invalid += 1
        dirs_out[rel] = {
            "name": fm.get("name") if isinstance(fm, dict) else None,
            "rules": fm.get("rules", []) if isinstance(fm, dict) else [],
            "info": fm.get("info", "") if isinstance(fm, dict) else "",
            "children": fm.get("children", {}) if isinstance(fm, dict) else {},
            "signature": sig,
            "signature_stored": stored or None,
            "drifted": is_drifted,
            "errors": errors,
        }
        new_sig_cache[rel] = sig

    index = {
        "version": 1,
        "built_at": int(time.time()),
        "project_root": PROJECT,
        "dirs": dirs_out,
        "candidates_missing_readme": sorted(candidates),
        "counts": {
            "tracked": len(readmes),
            "drifted": drifted,
            "invalid": invalid,
            "missing_candidates": len(candidates),
        },
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(index, f, indent=2, sort_keys=True)
    _save_signatures_cache(new_sig_cache)
    return index


def main() -> int:
    index = build()
    c = index["counts"]
    print(f"tracked={c['tracked']} drifted={c['drifted']} invalid={c['invalid']} candidates={c['missing_candidates']}")
    if c["invalid"]:
        for rel, d in index["dirs"].items():
            if d["errors"]:
                print(f"  INVALID {rel}:")
                for e in d["errors"]:
                    print(f"    - {e}")
    if c["drifted"]:
        print("  drifted dirs:")
        for rel, d in index["dirs"].items():
            if d["drifted"]:
                print(f"    - {rel}")
    if c["missing_candidates"]:
        print(f"  candidate boundaries missing README ({c['missing_candidates']}):")
        for rel in index["candidates_missing_readme"][:10]:
            print(f"    - {rel}")
        if c["missing_candidates"] > 10:
            print(f"    … (+{c['missing_candidates'] - 10} more)")
    return 0 if (c["invalid"] == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
