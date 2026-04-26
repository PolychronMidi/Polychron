#!/usr/bin/env python3
"""Shell-hook audit — static analysis for tools/HME/hooks/**/*.sh.

Sister of scripts/audit-core-principles.py for shell code. ESLint covers
.js, `_scan_python_bug_patterns` in workflow_audit.py covers .py, and
audit-core-principles.py covers src/ architecture — .sh hooks were the
blind spot. This script closes it.

Why this exists: Claude Code invokes HME hooks via the plugin-cache path
(`~/.claude/plugins/cache/polychron-local/HME/1.0.0/hooks/...`). Shell
hooks that resolve paths via `${BASH_SOURCE[0]}`-relative ascents
("`$(dirname ${BASH_SOURCE[0]})/../../..`") silently land INSIDE the
cache tree when invoked from the cache, instead of reaching the repo.
That broke _safety.sh (.env lookup miss → PROJECT_ROOT unset),
_autocommit.sh (.git not found), and stop.sh (detectors loaded from
stale cache copies). The fix was to resolve via `$PROJECT_ROOT` /
walk-up-to-.git / hardcoded fallback. This audit enforces that fix.

Rules:
  R1 — BASH_SOURCE-ascent-outside-hooks
       `${BASH_SOURCE[0]}` combined with `../..` (or deeper) OR a
       reference to a repo-root target (.env, .git, /src, /scripts,
       /mcp, /proxy, /output, /tmp, /log, /tools/HME/<non-hooks>) is a
       cache-trap — the path resolves into the plugin cache when the
       hook is invoked from there. Resolve via $PROJECT_ROOT instead.
       Exempt: hooks in `direct/` that explicitly walk-up looking for
       .git (pattern `while ... dirname`), since they build their own
       $PROJECT_ROOT from scratch.

Outputs:
  - Human-readable summary on stdout (default)
  - JSON payload with --json (consumed by ShellHookAuditVerifier)
  - Exit 0 if no violations, 1 otherwise

Usage:
    python3 scripts/audit-shell-hooks.py
    python3 scripts/audit-shell-hooks.py --json
"""
import json
import os
import re
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)
_HOOKS_DIR = os.path.join(_PROJECT, "tools", "HME", "hooks")

# Forbidden path fragments that, if reached via BASH_SOURCE-relative
# resolution, indicate the hook is trying to touch a repo-root artifact
# and will silently land in the plugin cache instead.
_REPO_ROOT_TARGETS = (
    "/.env",
    "/.git",
    "/src/",
    "/scripts/",
    "/output/",
    "/tmp/",
    "/log/",
    "/tools/HME/service/",
    "/tools/HME/proxy/",
    "/tools/HME/scripts/",
    "/tools/HME/activity/",
    "/tools/HME/KB/",
)

# BASH_SOURCE reference patterns. Either the canonical form or a variable
# that was just assigned from it (a common alias we saw in _autocommit.sh:
#   _AC_SELF="${BASH_SOURCE[0]}"
#   _AC_ROOT="$(cd "$(dirname "$_AC_SELF")/../../../.." ...)"
_BASH_SOURCE_RE = re.compile(r'\$\{BASH_SOURCE\[0\]\}|\$BASH_SOURCE\b|\$_\w*SELF\b')

# Ascent counter: matches "../" runs. 2+ consecutive = leaves the
# immediate directory, which is usually fine WITHIN hooks/ but not
# safe for a BASH_SOURCE-relative expression that then touches a
# repo-root target.
_ASCENT_RE = re.compile(r'(?:\.\./){2,}')


def _file_lines(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.readlines()


def _relpath(abs_path):
    return os.path.relpath(abs_path, _PROJECT)


def _scan_file(abs_path):
    """Return list of {rule, line, snippet, reason} dicts."""
    findings = []
    lines = _file_lines(abs_path)
    # Track "SELF=BASH_SOURCE" aliases so a later use of $_SELF still
    # counts. Simple approach: if any line declares _X_SELF from
    # BASH_SOURCE, treat $_X_SELF in that file as equivalent.
    alias_vars = set()
    for ln in lines:
        m = re.search(r'(_\w+)="\$\{BASH_SOURCE\[0\]\}"', ln)
        if m:
            alias_vars.add(m.group(1))

    for idx, ln in enumerate(lines, start=1):
        stripped = ln.rstrip()
        # Short-circuit: skip comments and blank lines.
        if not stripped or stripped.lstrip().startswith("#"):
            continue

        bash_source_here = bool(_BASH_SOURCE_RE.search(ln))
        alias_here = any(f'${v}' in ln for v in alias_vars)
        if not (bash_source_here or alias_here):
            continue

        # Signal 1: deep ascent in same expression.
        ascent_hit = _ASCENT_RE.search(ln)
        # Signal 2: repo-root target reference.
        target_hit = next((t for t in _REPO_ROOT_TARGETS if t in ln), None)

        if ascent_hit or target_hit:
            reason_parts = []
            if ascent_hit:
                reason_parts.append(f"ascent `{ascent_hit.group(0)}`")
            if target_hit:
                reason_parts.append(f"target `{target_hit.strip('/')}`")
            findings.append({
                "rule": "R1",
                "line": idx,
                "snippet": stripped[:160],
                "reason": (
                    "BASH_SOURCE-relative path with "
                    + " and ".join(reason_parts)
                    + " — resolves into plugin cache when hook is invoked from there. "
                    "Use $PROJECT_ROOT or walk-up-to-.git instead."
                ),
            })

    return findings


def _walk_hooks():
    if not os.path.isdir(_HOOKS_DIR):
        return
    for dirpath, _dirs, files in os.walk(_HOOKS_DIR):
        for name in files:
            if name.endswith(".sh"):
                yield os.path.join(dirpath, name)


def run():
    results = []
    for abs_path in sorted(_walk_hooks()):
        findings = _scan_file(abs_path)
        if findings:
            results.append({
                "file": _relpath(abs_path),
                "findings": findings,
            })
    return results


def _format_report(results):
    if not results:
        return "audit-shell-hooks: no violations found."
    lines = ["# Shell-Hook Audit", ""]
    total = sum(len(r["findings"]) for r in results)
    lines.append(f"Found {total} violation(s) across {len(results)} file(s).")
    lines.append("")
    for r in results:
        lines.append(f"## {r['file']}")
        for f in r["findings"]:
            lines.append(f"  [{f['rule']}] line {f['line']}: {f['reason']}")
            lines.append(f"      {f['snippet']}")
        lines.append("")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    results = run()
    violation_count = sum(len(r["findings"]) for r in results)

    if "--json" in args:
        print(json.dumps({
            "files": results,
            "violation_count": violation_count,
            "has_violations": violation_count > 0,
        }, indent=2))
    else:
        print(_format_report(results))

    return 1 if violation_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
