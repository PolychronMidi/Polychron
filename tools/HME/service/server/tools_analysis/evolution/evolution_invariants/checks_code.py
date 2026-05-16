"""All _check_* invariant handlers, dispatched by dispatch._eval."""
from __future__ import annotations

import fnmatch
import glob as globmod
import json
import os
import re

from server import context as ctx

from ._base import METRICS_DIR, _CONFIG_REL, _load_invariant_config, _resolve, _excluded, _is_regex
import time
import datetime





def _check_shell_output_empty(inv: dict) -> tuple[bool, str]:
    """Run a command; pass only when exit code and output match config."""
    import subprocess
    shell_cmd = inv["shell"]
    cwd = inv.get("cwd", ctx.PROJECT_ROOT)
    allowed = set(inv.get("allow_exit_codes", [0]))
    capture_stderr = bool(inv.get("capture_stderr", True))
    result = subprocess.run(
        shell_cmd, shell=True, capture_output=True, text=True, cwd=cwd
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip() if capture_stderr else ""
    output = "\n".join(part for part in (stdout, stderr) if part)
    if result.returncode not in allowed:
        detail = output.splitlines()[0] if output else "no output"
        return False, f"exit {result.returncode} (allowed {sorted(allowed)}): {detail}"
    if output:
        lines = output.splitlines()
        preview = ", ".join(lines[:5])
        suffix = f" (+{len(lines)-5} more)" if len(lines) > 5 else ""
        label = inv.get("finding_label", "finding")
        return False, f"{len(lines)} {label}(s): {preview}{suffix}"
    return True, inv.get("success_detail", "no findings")


def _check_eslint_concordance_complete(inv: dict) -> tuple[bool, str]:
    """Validate the _js_rules concordance map in invariants.json.

    Ensures:
      (a) every scripts/eslint-rules/*.js (minus index.js) appears in _js_rules.rules
      (b) every rule with status='ported' names a python_invariant id that exists
      (c) no _js_rules entry names a rule file that no longer exists
      (d) every status value is one of: ported, js_only, conventions_cover
    """
    data = _load_invariant_config()
    js_block = data.get("_js_rules", {})
    rules = js_block.get("rules", [])
    invariants_list = data.get("invariants", [])
    invariant_ids = {inv_.get("id") for inv_ in invariants_list}

    rules_dir = os.path.join(ctx.PROJECT_ROOT, "scripts", "eslint-rules")
    try:
        on_disk = {
            os.path.splitext(f_)[0]
            for f_ in os.listdir(rules_dir)
            if f_.endswith(".js") and f_ != "index.js" and not f_.endswith(".test.js")
        }
    except OSError as e:
        return False, f"cannot list eslint-rules dir: {e}"

    mapped = {r.get("name") for r in rules}
    valid_statuses = {"ported", "js_only", "conventions_cover"}
    problems = []

    missing_from_map = on_disk - mapped
    if missing_from_map:
        problems.append(
            f"{len(missing_from_map)} rule file(s) missing from _js_rules: "
            f"{', '.join(sorted(missing_from_map))}"
        )

    stale_in_map = mapped - on_disk
    if stale_in_map:
        problems.append(
            f"{len(stale_in_map)} _js_rules entry/entries point to missing file(s): "
            f"{', '.join(sorted(stale_in_map))}"
        )

    for r in rules:
        name = r.get("name", "<unnamed>")
        status = r.get("status")
        if status not in valid_statuses:
            problems.append(f"{name}: invalid status {status!r} (must be one of {sorted(valid_statuses)})")
            continue
        if status == "ported":
            py_id = r.get("python_invariant")
            if not py_id:
                problems.append(f"{name}: status='ported' but python_invariant is empty")
            elif py_id not in invariant_ids:
                problems.append(f"{name}: python_invariant {py_id!r} is not a registered invariant id")

    if problems:
        preview = "; ".join(problems[:5])
        suffix = f" (+{len(problems) - 5} more)" if len(problems) > 5 else ""
        return False, preview + suffix
    return True, f"{len(rules)} rules mapped; {sum(1 for r in rules if r.get('status') == 'ported')} ported, {len(on_disk)} on disk"


# Main entry point

