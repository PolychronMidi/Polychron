#!/usr/bin/env python3
"""Validate compact causal coherence proof files.

This intentionally implements the local schema subset instead of depending on a
JSON-schema package in hooks. Empty output means valid; any line is a finding.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[4])
REQUIRED = (
    "schema",
    "intent",
    "artifacts_touched",
    "causal_path_ids",
    "verifier_ids",
    "proof_artifacts",
    "forbidden_paths_checked",
    "open_risks",
)
PROOF_KINDS = {"test-output", "invariant-output", "runtime-output", "trace", "metric", "fixture"}
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def _is_nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _unique_nonempty_str_list(value: Any, *, allow_empty: bool = False) -> bool:
    if not isinstance(value, list):
        return False
    if not allow_empty and not value:
        return False
    if not all(_is_nonempty_str(x) for x in value):
        return False
    return len(set(value)) == len(value)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(path: Path, *, verify_hashes: bool = False) -> list[str]:
    findings: list[str] = []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"{path}: invalid JSON: {type(exc).__name__}: {exc}"]
    if not isinstance(doc, dict):
        return [f"{path}: root must be object"]
    extra = sorted(set(doc) - set(REQUIRED))
    missing = [k for k in REQUIRED if k not in doc]
    if extra:
        findings.append(f"{path}: extra keys: {', '.join(extra)}")
    if missing:
        findings.append(f"{path}: missing keys: {', '.join(missing)}")
    if doc.get("schema") != 1:
        findings.append(f"{path}: schema must be 1")
    if not _is_nonempty_str(doc.get("intent")):
        findings.append(f"{path}: intent must be nonempty string")
    for key in ("artifacts_touched", "causal_path_ids", "verifier_ids", "forbidden_paths_checked"):
        if not _unique_nonempty_str_list(doc.get(key)):
            findings.append(f"{path}: {key} must be a nonempty unique string list")
    if not isinstance(doc.get("open_risks"), list) or not all(isinstance(x, str) for x in doc.get("open_risks", [])):
        findings.append(f"{path}: open_risks must be a string list")
    arts = doc.get("proof_artifacts")
    if not isinstance(arts, list) or not arts:
        findings.append(f"{path}: proof_artifacts must be a nonempty list")
    else:
        for idx, art in enumerate(arts):
            prefix = f"{path}: proof_artifacts[{idx}]"
            if not isinstance(art, dict):
                findings.append(f"{prefix}: must be object")
                continue
            extra_art = sorted(set(art) - {"path", "kind", "sha256"})
            if extra_art:
                findings.append(f"{prefix}: extra keys: {', '.join(extra_art)}")
            if not _is_nonempty_str(art.get("path")):
                findings.append(f"{prefix}: path must be nonempty string")
            if art.get("kind") not in PROOF_KINDS:
                findings.append(f"{prefix}: kind invalid")
            sha = art.get("sha256")
            if sha is not None and not (isinstance(sha, str) and SHA_RE.match(sha)):
                findings.append(f"{prefix}: sha256 must be 64 lowercase hex chars")
            if verify_hashes and sha and _is_nonempty_str(art.get("path")):
                p = ROOT / art["path"]
                if not p.is_file():
                    findings.append(f"{prefix}: referenced path missing: {art['path']}")
                else:
                    got = _sha256(p)
                    if got != sha:
                        findings.append(f"{prefix}: sha256 mismatch: got {got}")
    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--verify-hashes", action="store_true")
    ns = ap.parse_args()
    all_findings: list[str] = []
    for raw in ns.paths:
        path = raw if raw.is_absolute() else ROOT / raw
        all_findings.extend(validate(path, verify_hashes=ns.verify_hashes))
    for row in all_findings:
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
