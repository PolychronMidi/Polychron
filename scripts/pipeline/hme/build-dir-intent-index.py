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
METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(PROJECT, "output", "metrics"))
OUTPUT = os.path.join(METRICS_DIR, "hme-dir-intent.json")
SIGNATURES = os.path.join(METRICS_DIR, "hme-dir-signatures.json")

# Dirs never walked
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
    "out", ".claude", "tmp", "log", ".pytest_cache", "output",
    # Vendored libs / third-party code — we don't author READMEs here
    "py_midicsv", "site-packages", "vendor", "third_party",
    # Data dirs — not code boundaries
    "training", "metrics", "holograph",
}

# Files that signal a dir is a cohesion boundary (candidate for README)
BOUNDARY_MARKERS = ("index.js", "index.ts", "__init__.py", "Manager.js")

# Extensions counted as "source files" for cohesion scoring
SOURCE_EXTS = {".js", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".sh"}

# Metadata block is hidden in an HTML comment at the bottom of README.md. The
# content above the block is captured verbatim as `intro` — the file doubles as
# a normal README for GitHub/human viewing. Anything outside this block is not
# parsed (YAML frontmatter at the top is ignored — HF model cards use that).
INTENT_BLOCK_RE = re.compile(
    r"(.*?)\n?<!--\s*HME-DIR-INTENT\s*\n(.*?)\n\s*-->\s*$",
    re.DOTALL,
)


def _parse_readme(path: str) -> Optional[dict]:
    """Return {intro, rules, _parse_error?} if the README contains our block,
    else None (the README uses some other convention and we ignore it)."""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    m = INTENT_BLOCK_RE.match(text)
    if not m:
        return None
    intro = m.group(1).strip()
    raw_yaml = m.group(2)
    # YAML treats a leading backtick as a tag. Authors naturally write rules
    # with inline code `like this` at the start. Auto-quote list items whose
    # first non-whitespace char after `- ` is a backtick — transparent to the
    # author, avoids a pitfall that trips every review.
    raw_yaml = re.sub(
        r"^(\s*-\s+)(`[^'\"]*?)$",
        lambda mm: mm.group(1) + '"' + mm.group(2).replace('"', '\\"') + '"',
        raw_yaml,
        flags=re.MULTILINE,
    )
    try:
        data = yaml.safe_load(raw_yaml)
    except yaml.YAMLError as e:
        return {"intro": intro, "rules": [], "_parse_error": str(e)}
    if not isinstance(data, dict):
        data = {}
    return {
        "intro": intro,
        "rules": data.get("rules", []),
    }


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


RULE_MAX_CHARS = 160        # middleware footer budget is ~180; leave room for delimiter
RULE_COUNT_MAX = 6          # only first 2 are injected; more than 6 is bloat
INTRO_MAX_CHARS = 4000      # intros are for on-demand read, not injection, but keep bounded
TRIGRAM_OVERLAP_THRESHOLD = 0.50  # word-trigram Jaccard — catches actual duplication, not shared vocab


def _trigrams(text: str) -> set:
    """Word-trigram shingles — insensitive to filler words, catches near-identical phrasing."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {tuple(words[i:i+3]) for i in range(len(words) - 2)} if len(words) >= 3 else set()


def _load_claude_md_rules() -> list:
    """Extract imperative bullet points from CLAUDE.md as individual rules.
    We match against each rule separately so shared vocabulary in CLAUDE.md
    doesn't cause false positives — only actual near-duplication trips the check.
    """
    path = os.path.join(PROJECT, "CLAUDE.md")
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return []
    rules = []
    for line in text.splitlines():
        # Bullet points at any indent level
        m = re.match(r"^\s*-\s+(.+)$", line)
        if not m:
            continue
        body = m.group(1).strip()
        # Strip leading markdown emphasis / bold marker
        body = re.sub(r"^\*\*([^*]+)\*\*:?\s*", r"\1 ", body)
        if len(body) < 20:
            continue
        rules.append(body)
    return rules


def _claude_overlap(rule: str, claude_rules: list) -> float:
    """Max trigram Jaccard between this rule and any CLAUDE.md bullet."""
    rt = _trigrams(rule)
    if not rt:
        return 0.0
    best = 0.0
    for cr in claude_rules:
        ct = _trigrams(cr)
        if not ct:
            continue
        jaccard = len(rt & ct) / max(1, len(rt | ct))
        if jaccard > best:
            best = jaccard
    return best


def _validate(rel_dir: str, data: dict, claude_rules: list) -> tuple[list, list]:
    """Return (errors, warnings). Errors block validity; warnings are advisory."""
    errors = []
    warnings = []
    if "_parse_error" in data:
        errors.append(f"yaml parse error in HME-DIR-INTENT block: {data['_parse_error']}")
        return errors, warnings
    rules = data.get("rules")
    if rules is None:
        errors.append("missing required field: rules")
    elif not isinstance(rules, list) or not all(isinstance(r, str) for r in rules):
        errors.append("rules must be a list of strings")
    elif not rules:
        errors.append("rules list is empty — if there are no local rules, this dir shouldn't have an HME-DIR-INTENT block")
    else:
        if len(rules) > RULE_COUNT_MAX:
            warnings.append(f"{len(rules)} rules — middleware only injects first 2; keep ≤ {RULE_COUNT_MAX} with most important first")
        for i, r in enumerate(rules):
            if len(r) > RULE_MAX_CHARS:
                errors.append(f"rule[{i}] is {len(r)} chars — max {RULE_MAX_CHARS}; won't fit footer budget")
            elif len(r) > RULE_MAX_CHARS - 20:
                warnings.append(f"rule[{i}] is {len(r)} chars — tight against the {RULE_MAX_CHARS}-char budget")
            overlap = _claude_overlap(r, claude_rules)
            if overlap >= TRIGRAM_OVERLAP_THRESHOLD:
                preview = r[:70] + ("…" if len(r) > 70 else "")
                warnings.append(f"rule[{i}] {overlap:.0%} trigram overlap with a CLAUDE.md rule — may be redundant: {preview!r}")
    intro = data.get("intro", "")
    if not intro:
        errors.append("intro is empty — put a normal README description above the HME-DIR-INTENT block")
    elif len(intro) > INTRO_MAX_CHARS:
        warnings.append(f"intro is {len(intro)} chars — consider tightening (max {INTRO_MAX_CHARS})")
    return errors, warnings


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
    readmes = {}  # rel_dir -> parsed dict
    candidates = []  # dirs that look like boundaries but have no README
    sig_cache = _load_signatures_cache()
    claude_rules = _load_claude_md_rules()

    for root, dirs, files in os.walk(PROJECT, followlinks=False):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        rel = os.path.relpath(root, PROJECT)
        has_our_block = False
        if "README.md" in files:
            parsed = _parse_readme(os.path.join(root, "README.md"))
            if parsed is not None:
                readmes[rel] = parsed
                has_our_block = True
        if not has_our_block and _is_boundary(root) and rel != ".":
            candidates.append(rel)

    dirs_out = {}
    drifted = 0
    invalid = 0
    warned = 0
    new_sig_cache = {}
    for rel, parsed in readmes.items():
        abs_dir = os.path.join(PROJECT, rel)
        errors, warnings = _validate(rel, parsed, claude_rules)
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
        if warnings:
            warned += 1
        dirs_out[rel] = {
            "rules": parsed.get("rules", []),
            "intro": parsed.get("intro", ""),
            "signature": sig,
            "signature_stored": stored or None,
            "drifted": is_drifted,
            "errors": errors,
            "warnings": warnings,
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
            "warned": warned,
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
    print(f"tracked={c['tracked']} drifted={c['drifted']} invalid={c['invalid']} warned={c['warned']} candidates={c['missing_candidates']}")
    if c["invalid"]:
        for rel, d in index["dirs"].items():
            if d["errors"]:
                print(f"  INVALID {rel}:")
                for e in d["errors"]:
                    print(f"    - {e}")
    if c["warned"]:
        for rel, d in index["dirs"].items():
            if d["warnings"]:
                print(f"  WARN {rel}:")
                for w in d["warnings"]:
                    print(f"    - {w}")
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
