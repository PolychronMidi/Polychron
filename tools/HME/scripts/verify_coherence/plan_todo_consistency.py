"""Plan/TODO consistency verifier."""
from __future__ import annotations

import re
from pathlib import Path

from ._base import VerdictResult, Verifier, _PROJECT, failed, passed, register

VALID_STATUSES = {"proposed", "approved", "denied", "done"}


@register
class PlanTodoConsistencyVerifier(Verifier):
    """Ensure plan phase status and TODO evidence do not diverge silently."""
    name = "plan-todo-consistency"
    category = "coverage"
    subtag = "interface-contract"
    weight = 1.0
    invariant = "Plan phase status and TODO/log evidence must stay mutually consistent for completed phases."
    false_positive_policy = "Fail only on invalid phase status words or done phases lacking any TODO evidence reference."
    sources_checked = ["plan.md", "doc/templates/TODO.md", "log/todo"]
    does_not_enforce = ["artifact correctness", "HCI evidence", "future phase approval"]

    def run(self) -> VerdictResult:
        root = Path(_PROJECT)
        plan = (root / "plan.md").read_text(encoding="utf-8", errors="ignore")
        todo_text = (root / "doc/templates/TODO.md").read_text(encoding="utf-8", errors="ignore")
        for p in sorted((root / "log/todo").glob("set*.md")):
            todo_text += "\n" + p.read_text(encoding="utf-8", errors="ignore")
        errors: list[str] = []
        for m in re.finditer(r"^## Phase\s+(\d+)\s+\(([^)]+)\)", plan, re.MULTILINE):
            phase = int(m.group(1))
            status = m.group(2).strip().lower()
            if status not in VALID_STATUSES:
                errors.append(f"Phase {phase} uses non-legend status {status!r}")
            if status == "done" and phase >= 15:
                if f"Phase {phase}" not in todo_text:
                    errors.append(f"Phase {phase} is {status} but no TODO/log evidence mentions it")
        for m in re.finditer(r"Phase\s+(\d+)[^\n]{0,120}\b5_", todo_text):
            phase = int(m.group(1))
            head = re.search(rf"^## Phase\s+{phase}\s+\(([^)]+)\)", plan, re.MULTILINE)
            if head and head.group(1).strip().lower() == "proposed":
                errors.append(f"TODO marks Phase {phase} done while plan still says proposed")
        if errors:
            return failed(score=max(0.0, 1 - len(errors) / 10), summary=f"{len(errors)} plan/TODO consistency violation(s)", details=errors)
        return passed(summary="plan phase statuses and TODO/log evidence are consistent")
