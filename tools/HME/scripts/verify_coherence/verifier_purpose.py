"""Verifier purpose-contract checks."""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path

from ._base import VerdictResult, Verifier, _PROJECT, failed, passed, register, warned, env_truthy

REQUIRED_FIELDS = {"invariant", "false_positive_policy", "sources_checked", "does_not_enforce"}


@register
class VerifierPurposeContractVerifier(Verifier):
    """Ensure the verifier purpose contract exists and can be tightened safely."""
    name = "verifier-purpose-contract"
    category = "coverage"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        cfg_path = root / "tools/HME/config/verifier-purpose-contract.json"
        if not cfg_path.exists():
            return failed(summary="verifier purpose contract missing", details=[str(cfg_path)])
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception as e:
            return failed(summary=f"verifier purpose contract invalid JSON: {e}")
        missing = REQUIRED_FIELDS - set(cfg.get("required_fields") or [])
        if missing:
            return failed(summary="verifier purpose contract missing required fields", details=sorted(missing))

        classes: list[str] = []
        missing_meta: list[str] = []
        for path in sorted((root / "tools/HME/scripts/verify_coherence").glob("*.py")):
            if path.name.startswith("_") or path.name == "__init__.py":
                continue
            tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
            for node in tree.body:
                if not isinstance(node, ast.ClassDef):
                    continue
                if not any(getattr(base, "id", getattr(base, "attr", "")) == "Verifier" for base in node.bases):
                    continue
                classes.append(f"{path.name}:{node.name}")
                names = {stmt.targets[0].id for stmt in node.body if isinstance(stmt, ast.Assign) and stmt.targets and isinstance(stmt.targets[0], ast.Name)}
                doc_ok = bool((ast.get_docstring(node) or "").strip())
                if not (REQUIRED_FIELDS <= names or doc_ok):
                    missing_meta.append(f"{path.name}:{node.name}")
        if env_truthy(os.environ.get(str(cfg.get("strict_mode_env") or "HME_VERIFIER_PURPOSE_STRICT"))) and missing_meta:
            return failed(summary=f"{len(missing_meta)} verifier(s) lack explicit purpose metadata/docstring", details=missing_meta)
        if missing_meta:
            return warned(score=0.95, summary=f"verifier purpose contract present; {len(missing_meta)} legacy verifier(s) lack metadata", details=missing_meta[:20])
        return passed(summary=f"verifier purpose contract present ({len(classes)} verifier classes covered by metadata/docstrings)")
