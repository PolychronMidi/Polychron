"""Project boundary map verifier."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from ._base import VerdictResult, Verifier, _PROJECT, failed, passed, register, warned

REQUIRED_SUBSYSTEMS = {
    "product_src", "proxy", "event_kernel_hooks", "mesh_teams", "hci_verifiers",
    "todo_plan_ledgers", "runtime_state_logs", "docs_templates", "config_policy",
}
VALID_PATH_CLASSES = {"hot", "cold", "state", "policy"}


@register
class ProjectBoundariesVerifier(Verifier):
    """Keep project-wide ownership minimal, explicit, and machine-checkable."""
    name = "project-boundaries"
    category = "coverage"
    subtag = "interface-contract"
    weight = 2.0

    def run(self) -> VerdictResult:
        path = Path(_PROJECT) / "tools/HME/project_boundaries.json"
        if not path.exists():
            return failed(summary="project boundary map missing", details=[str(path)])
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            return failed(summary=f"project boundary map invalid JSON: {e}")

        errors: list[str] = []
        warnings: list[str] = []
        canonical = data.get("canonical_destinations") or {}
        for key in ["work_state", "phase_intent", "peer_dialogue", "machine_policy_data", "runtime_evidence", "objective_invariants", "product_behavior"]:
            if key not in canonical:
                errors.append(f"canonical_destinations missing {key}")

        subsystems = data.get("subsystems") or {}
        missing = sorted(REQUIRED_SUBSYSTEMS - set(subsystems))
        if missing:
            errors.append("missing subsystem rows: " + ", ".join(missing))
        for name, row in sorted(subsystems.items()):
            if not isinstance(row, dict):
                errors.append(f"subsystem {name} must be object")
                continue
            if row.get("path_class") not in VALID_PATH_CLASSES:
                errors.append(f"subsystem {name} invalid path_class={row.get('path_class')!r}")
            for field in ["owns", "does_not_own", "entrypoints", "canonical_outputs"]:
                if field not in row or not isinstance(row[field], list):
                    errors.append(f"subsystem {name} missing list field {field}")
            if isinstance(row.get("owns"), list) and not row["owns"]:
                errors.append(f"subsystem {name} owns cannot be empty")
            if isinstance(row.get("does_not_own"), list) and not row["does_not_own"]:
                errors.append(f"subsystem {name} does_not_own cannot be empty")
            for entry in row.get("entrypoints", []) if isinstance(row.get("entrypoints"), list) else []:
                entry_path = Path(_PROJECT) / str(entry)
                if not entry_path.exists() and not any(ch in str(entry) for ch in "*[]"):
                    errors.append(f"subsystem {name} entrypoint missing: {entry}")

        forbidden = data.get("hot_path_forbidden_markers") or []
        forbidden_import_prefixes = data.get("hot_path_forbidden_import_prefixes") or []
        allowed = set(data.get("hot_path_allowed_files") or [])
        import_re = re.compile(r"(?:require\(|from\s+|import\s+).*?['\"]([^'\"]+)['\"]")
        for hot_root in ((data.get("path_classes") or {}).get("hot") or []):
            root = Path(_PROJECT) / str(hot_root)
            if not root.exists():
                continue
            for file in root.rglob("*"):
                if not file.is_file() or file.suffix not in {".js", ".mjs", ".cjs", ".py", ".sh"}:
                    continue
                rel = str(file.relative_to(_PROJECT))
                if rel in allowed:
                    continue
                try:
                    text = file.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                for marker in forbidden:
                    if marker and marker in text:
                        errors.append(f"hot path {rel} references cold-path marker {marker}")
                for spec in import_re.findall(text):
                    resolved = (file.parent / spec).resolve() if spec.startswith(".") else (Path(_PROJECT) / spec).resolve()
                    try:
                        target_rel = str(resolved.relative_to(_PROJECT)).replace("\\", "/")
                    except ValueError:
                        continue
                    for prefix in forbidden_import_prefixes:
                        if target_rel.startswith(prefix):
                            errors.append(f"hot path {rel} imports cold path {target_rel}")

        # Conservative warning: obvious new ledger-like roots should be owned.
        known_roots = {str(x).split("/")[0] for row in subsystems.values() if isinstance(row, dict) for x in row.get("entrypoints", [])}
        for rel in ["reports", "ledgers", "outputs"]:
            if (Path(_PROJECT) / rel).exists() and rel not in known_roots:
                warnings.append(f"possible new output root lacks owner: {rel}")

        if errors:
            return failed(score=max(0.0, 1 - len(errors) / 20), summary=f"{len(errors)} project boundary violation(s)", details=errors + warnings)
        if warnings:
            return warned(score=0.9, summary=f"project boundary map valid with {len(warnings)} warning(s)", details=warnings)
        return passed(summary=f"project boundary map valid ({len(subsystems)} subsystems, {len(canonical)} canonical destinations)")
