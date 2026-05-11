"""All _check_* invariant handlers, dispatched by dispatch._eval."""
from __future__ import annotations

import fnmatch
import glob as globmod
import json
import os
import re

from server import context as ctx

from ._base import METRICS_DIR, _CONFIG_REL, _resolve, _excluded, _is_regex
import time
import datetime





def _check_public_functions_reachable(inv: dict) -> tuple[bool, str]:
    """Every undecorated public function (no leading `_`) in a scanned dir must
    be either @ctx.mcp.tool-decorated, referenced from another module, OR
    listed in the explicit `allowed_internals` list. Catches the class of
    bug where a handler is defined with a public-looking name but nothing
    can actually call it (status() was unreachable for months for exactly
    this reason).

    Config:
      scan_dir         -- directory to walk for .py files
      allowed_internals -- list of function names that are legitimately
                          internal-but-undecorated (dispatch-table-called,
                          test harness, etc.)
    """
    import ast as _ast
    import re as _re
    scan_dir = os.path.join(ctx.PROJECT_ROOT, inv["scan_dir"])
    allowed = set(inv.get("allowed_internals", []))
    candidates: dict = {}
    for root, _dirs, files in os.walk(scan_dir):
        if "__pycache__" in root:
            continue
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(root, f)
            try:
                tree = _ast.parse(open(path, encoding="utf-8").read(), filename=path)
            except (OSError, SyntaxError):
                continue
            for node in tree.body:
                if not isinstance(node, _ast.FunctionDef):
                    continue
                if node.name.startswith("_"):
                    continue
                if node.name in allowed:
                    continue
                has_tool = any(
                    "mcp.tool" in (_ast.unparse(d) if hasattr(_ast, "unparse") else "")
                    for d in node.decorator_list
                )
                if has_tool:
                    continue
                rel = os.path.relpath(path, ctx.PROJECT_ROOT)
                candidates[node.name] = (rel, node.lineno)

    # Check cross-file references
    scan_root = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "mcp")
    orphans: list = []
    for name, (file, line) in candidates.items():
        refs = 0
        for root, _dirs, files in os.walk(scan_root):
            if "__pycache__" in root:
                continue
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                rel = os.path.relpath(path, ctx.PROJECT_ROOT)
                if rel == file:
                    continue
                try:
                    content = open(path, encoding="utf-8").read()
                except OSError:
                    continue
                if _re.search(rf"\b{_re.escape(name)}\b", content):
                    refs += 1
                    break
        if refs == 0:
            orphans.append(f"{file}:{line}:{name}")

    if orphans:
        preview = ", ".join(orphans[:5])
        suffix = f" (+{len(orphans)-5} more)" if len(orphans) > 5 else ""
        return False, (
            f"{len(orphans)} undecorated public function(s) with zero external "
            f"references: {preview}{suffix}. Either prefix with `_` to mark "
            f"internal, add @ctx.mcp.tool() to expose, or add to "
            f"`allowed_internals` in the invariant config."
        )
    return True, f"all {len(candidates)} public functions reachable"


def _check_shell_output_empty(inv: dict) -> tuple[bool, str]:
    """Run a shell command; pass if stdout is empty, fail if it produces any output.

    Use for git-clean checks: shell='git ls-files --others --exclude-standard'
    fails if any untracked non-gitignored files exist.
    Optional 'cwd' key (default: PROJECT_ROOT).
    """
    import subprocess
    shell_cmd = inv["shell"]
    cwd = inv.get("cwd", ctx.PROJECT_ROOT)
    result = subprocess.run(
        shell_cmd, shell=True, capture_output=True, text=True, cwd=cwd
    )
    output = result.stdout.strip()
    if output:
        lines = output.splitlines()
        preview = ", ".join(lines[:5])
        suffix = f" (+{len(lines)-5} more)" if len(lines) > 5 else ""
        return False, f"{len(lines)} untracked file(s): {preview}{suffix}"
    return True, "no untracked files"


def _check_eslint_concordance_complete(inv: dict) -> tuple[bool, str]:
    """Validate the _js_rules concordance map in invariants.json.

    Ensures:
      (a) every scripts/eslint-rules/*.js (minus index.js) appears in _js_rules.rules
      (b) every rule with status='ported' names a python_invariant id that exists
      (c) no _js_rules entry names a rule file that no longer exists
      (d) every status value is one of: ported, js_only, conventions_cover
    """
    config_path = os.path.join(ctx.PROJECT_ROOT, _CONFIG_REL)
    with open(config_path, encoding="utf-8") as f:
        data = json.load(f)
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

