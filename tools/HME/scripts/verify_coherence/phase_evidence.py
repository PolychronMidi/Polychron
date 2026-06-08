"""Phase evidence proof-reference verifier."""
from __future__ import annotations

import json
import re
from pathlib import Path

from ._base import VerdictResult, Verifier, _PROJECT, failed, passed, register

ALLOWED_ROW_FIELDS = {"phase", "plan_anchor", "todo_refs", "closes", "artifacts", "tests", "hci", "does_not_prove"}
REQUIRED_ROW_FIELDS = ALLOWED_ROW_FIELDS
FOGGY_CLOSES = {"coherence", "quality", "architecture", "safety", "all_regressions"}


def _verifier_names(root: Path) -> set[str]:
    names: set[str] = set()
    for path in (root / "tools/HME/scripts/verify_coherence").glob("*.py"):
        if path.name.startswith("_") or path.name == "__init__.py":
            continue
        names.update(re.findall(r"\bname\s*=\s*['\"]([^'\"]+)['\"]", path.read_text(encoding="utf-8", errors="ignore")))
    return names


def _done_phase_numbers(plan_text: str, floor: int) -> set[int]:
    out: set[int] = set()
    for m in re.finditer(r"^## Phase\s+(\d+)\s+\(([^)]+)\)", plan_text, re.MULTILINE):
        num = int(m.group(1))
        status = m.group(2).strip().lower()
        if num >= floor and status in {"done", "executed"}:
            out.add(num)
    return out


def _todo_ref_exists(root: Path, ref: str) -> bool:
    if "#" not in ref:
        return False
    file_part, item = ref.split("#", 1)
    if not item.isdigit():
        return False
    path = root / file_part
    if not path.exists():
        return False
    needle = f"#{item} "
    return any(line.lstrip().startswith(needle) for line in path.read_text(encoding="utf-8", errors="ignore").splitlines())


@register
class PhaseEvidenceVerifier(Verifier):
    """Ensure completed phases use proof refs without becoming a second ledger."""
    name = "phase-evidence"
    category = "coverage"
    subtag = "interface-contract"
    weight = 1.5
    invariant = "Completed phase evidence must be traversable through existing owner surfaces without duplicating status."
    false_positive_policy = "Only fail on missing references, invalid closed enums, or forbidden ledger-like fields."
    sources_checked = ["tools/HME/config/phase-evidence.json", "plan.md", "doc/templates/TODO.md", "log/todo", "tools/HME/scripts/verify_coherence"]
    does_not_enforce = ["runtime performance", "future phase completion", "all possible regressions", "mesh consensus truth"]

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        cfg_path = root / "tools/HME/config/phase-evidence.json"
        if not cfg_path.exists():
            return failed(summary="phase evidence config missing", details=[str(cfg_path)])
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception as e:
            return failed(summary=f"phase evidence config invalid JSON: {e}")
        errors: list[str] = []
        closes_enum = set(cfg.get("closes_enum") or [])
        does_not_prove_enum = set(cfg.get("does_not_prove_enum") or [])
        forbidden = set(cfg.get("forbidden_fields") or [])
        if not closes_enum:
            errors.append("closes_enum empty")
        if not does_not_prove_enum:
            errors.append("does_not_prove_enum empty")
        if FOGGY_CLOSES & closes_enum:
            errors.append("closes_enum contains foggy labels: " + ", ".join(sorted(FOGGY_CLOSES & closes_enum)))
        if forbidden & ALLOWED_ROW_FIELDS:
            errors.append("forbidden_fields overlaps allowed row fields")
        plan_text = (root / "plan.md").read_text(encoding="utf-8", errors="ignore")
        hci_names = _verifier_names(root)
        phases = cfg.get("phases") or []
        if not isinstance(phases, list) or not phases:
            errors.append("phases must be non-empty list")
        for row in phases if isinstance(phases, list) else []:
            if not isinstance(row, dict):
                errors.append("phase row must be object")
                continue
            keys = set(row)
            extra = keys - ALLOWED_ROW_FIELDS
            missing = REQUIRED_ROW_FIELDS - keys
            if extra:
                errors.append(f"phase {row.get('phase')} has forbidden/unknown fields: {', '.join(sorted(extra))}")
            if missing:
                errors.append(f"phase {row.get('phase')} missing fields: {', '.join(sorted(missing))}")
            if forbidden & keys:
                errors.append(f"phase {row.get('phase')} has explicitly forbidden fields: {', '.join(sorted(forbidden & keys))}")
            anchor = str(row.get("plan_anchor") or "")
            if not anchor or anchor not in plan_text:
                errors.append(f"phase {row.get('phase')} plan_anchor missing from plan.md")
            for ref in row.get("todo_refs") or []:
                if not _todo_ref_exists(root, str(ref)):
                    errors.append(f"phase {row.get('phase')} TODO ref missing: {ref}")
            for field in ["artifacts", "tests"]:
                for p in row.get(field) or []:
                    if not (root / str(p)).exists():
                        errors.append(f"phase {row.get('phase')} {field[:-1]} path missing: {p}")
            for name in row.get("hci") or []:
                if str(name) not in hci_names:
                    errors.append(f"phase {row.get('phase')} HCI verifier missing: {name}")
            for close in row.get("closes") or []:
                if str(close) not in closes_enum:
                    errors.append(f"phase {row.get('phase')} invalid closes enum: {close}")
            for no in row.get("does_not_prove") or []:
                if str(no) not in does_not_prove_enum:
                    errors.append(f"phase {row.get('phase')} invalid does_not_prove enum: {no}")
        if errors:
            return failed(score=max(0.0, 1 - len(errors) / 25), summary=f"{len(errors)} phase evidence violation(s)", details=errors)
        return passed(summary=f"phase evidence valid ({len(phases)} phase proof row(s))")
