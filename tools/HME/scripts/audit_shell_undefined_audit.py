#!/usr/bin/env python3
"""Shell undefined-variable audit -- static analysis for tools/HME/hooks/**/*.sh.

Scans every hook script for `$VAR` / `${VAR}` references that have no
assignment anywhere in scope (the file itself, any file it sources, or the
`.env` / system defaults set by `_safety.sh`). Catches the exact bug class
that silently broke auto-completeness-inject for months: `$_AC_PROJECT`
referenced in `holograph.sh` had never been defined anywhere in the repo's
history, and under `set -u` in `_safety.sh`, it crashed `stop.sh` before the
completeness gate (in `work_checks.sh`) ever got a chance to run.

Why not shellcheck: shellcheck isn't in the HME baseline toolchain (the
audit-shell-hooks.py sister script chose the same path -- custom Python
analyzer tailored to this project's source chain). This script follows
`source X/Y.sh` references transitively so a var defined in `_safety.sh`
is visible in every hook that sources it.

Rules:
  R1 -- REF without DEFN in scope
       `$VAR` / `${VAR}` reference with no matching `VAR=...`, `local VAR=`,
       `readonly VAR=`, `export VAR=`, `declare VAR=`, `typeset VAR=`,
       loop-var `for VAR in`, `while read VAR`, arithmetic
       `for ((VAR=...))`, `[[ -v VAR ]]`, case-setup assignments, nor
       function-parameter bind, nor `.env` entry.
       Exempt: references with an explicit default (`${VAR:-...}`,
       `${VAR-...}`, `${VAR:?...}`, `${VAR:+...}`) -- bash expands those safely
       even under `set -u`. Exempt: positional args `$0..$9 $@ $* $#`,
       special `$? $$ $! $_ $-`, special env `HOME PATH PWD ...`.

Output:
  Default: human-readable summary to stdout, exit 0 on clean, 1 on
  violations.
  --json:  JSON to stdout for the HCI verifier.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# Helpers (_strip_*, _find_refs, _load_env_vars, _transitive_defs) and
def _vars():
    mod = sys.modules.get("audit_shell_undefined_vars")
    if mod is not None and hasattr(mod, "_load_env_vars"):
        return mod
    main_mod = sys.modules.get("__main__")
    if main_mod is not None and hasattr(main_mod, "_load_env_vars"):
        return main_mod
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import audit_shell_undefined_vars as _v
    return _v

REPO_ROOT = Path(__file__).resolve().parents[3]
HOOKS_DIR = REPO_ROOT / "tools" / "HME" / "hooks"
ENV_FILE = REPO_ROOT / ".env"

# Additional shell-script trees that run under the same `set -u` risk
EXTRA_SCAN_DIRS = [
    REPO_ROOT / "tools" / "HME" / "launcher",
    REPO_ROOT / "tools" / "HME" / "proxy",   # test-proxy*.sh etc.
    REPO_ROOT / "tools" / "HME" / "scripts", # setup_*.sh
]

# Bash specials / positional args / standard env never to flag.
_BUILTIN_VARS = {
    # Positional and special
    *{str(i) for i in range(10)},
    "@", "*", "#", "?", "!", "$", "-", "_", "0",
    # Bash internal
    "BASH", "BASH_ARGC", "BASH_ARGV", "BASH_COMMAND", "BASH_LINENO",
    "BASH_SOURCE", "BASH_SUBSHELL", "BASH_VERSION", "BASHOPTS",
    "BASHPID", "COLUMNS", "COMP_CWORD", "COMP_KEY", "COMP_LINE",
    "COMP_POINT", "COMP_TYPE", "COMP_WORDBREAKS", "COMP_WORDS",
    "DIRSTACK", "EPOCHREALTIME", "EPOCHSECONDS", "EUID", "FUNCNAME",
    "GROUPS", "HISTCMD", "HOSTNAME", "HOSTTYPE", "IFS", "LINENO",
    "MACHTYPE", "OLDPWD", "OPTARG", "OPTERR", "OPTIND", "OSTYPE",
    "PIPESTATUS", "PPID", "PS1", "PS2", "PS3", "PS4", "PWD",
    "RANDOM", "READLINE_LINE", "READLINE_POINT", "REPLY", "SECONDS",
    "SHELL", "SHELLOPTS", "SHLVL", "UID",
    # Common environment
    "HOME", "PATH", "USER", "LOGNAME", "TERM", "LANG", "LC_ALL",
    "LC_CTYPE", "TMPDIR", "EDITOR", "VISUAL", "DISPLAY", "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
    # Claude Code / plugin hooks
    "CLAUDE_PROJECT_DIR", "CLAUDE_ENV_FILE",
}

_ASSIGNMENT_RE = re.compile(
    r"""(?x)
    (?:^|[\s;&|(])                      # start / boundary
    (?:local\s+|readonly\s+|export\s+|declare\s+(?:-\S+\s+)*|typeset\s+(?:-\S+\s+)*)?
    ([A-Za-z_][A-Za-z0-9_]*)           # VAR
    (?:\[[^\]]*\])?                     # optional array index
    =
    """
)
_FOR_VAR_RE     = re.compile(r"\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b")
_FOR_ARITH_RE   = re.compile(r"\bfor\s+\(\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")
_WHILE_READ_RE  = re.compile(r"\bread\s+(?:-[A-Za-z]+\s+)*(?:-[A-Za-z]+\s+\S+\s+)*([A-Za-z_][A-Za-z0-9_]*(?:\s+[A-Za-z_][A-Za-z0-9_]*)*)")
_LET_RE         = re.compile(r"\blet\s+['\"]?([A-Za-z_][A-Za-z0-9_]*)")
_TESTV_RE       = re.compile(r"\[\[\s+-v\s+([A-Za-z_][A-Za-z0-9_]*)\s+\]\]")
_GETOPTS_RE     = re.compile(r"\bgetopts\s+\S+\s+([A-Za-z_][A-Za-z0-9_]*)")
_FUNC_PARAM_RE  = re.compile(r'"\$\{?([1-9])\}?"|"\$([@*])"')  # positional -- always defined

# Variable REFERENCES. Captures:
_REF_RE = re.compile(
    r"""(?x)
    \$
    (?:
      \{
        (?P<brace>[A-Za-z_][A-Za-z0-9_]*)
        (?P<suffix>[^{}]*)
      \}
      |
      (?P<bare>[A-Za-z_][A-Za-z0-9_]*)
    )
    """
)

# Suffixes that provide a safe default -- reference never crashes under set -u.
_SAFE_SUFFIX_RE = re.compile(r"^(?::-|:=|:\?|:\+|-|=|\?|\+)")

# Source-line extraction. Matches `source X`, `. X`, handling quoted paths.
_SOURCE_RE = re.compile(
    r'(?m)^\s*(?:source|\.)\s+("([^"]+)"|\x27([^\x27]+)\x27|([^\s#;&|]+))'
)

# Heredoc body extraction -- skip var references inside `<<EOF`/`<<-EOF` bodies
_HEREDOC_RE = re.compile(
    r'<<-?\s*([\'"]?)(\w+)\1\s*\n(.*?)(?=^\s*\2\s*$)',
    re.DOTALL | re.MULTILINE,
)




def _dispatcher_defs(path: Path, env_vars: set[str]) -> set[str]:
    """If `path` is a sub-file of a known dispatcher dir, return the union
    of defs from the dispatcher (transitively) and every SIBLING sub-file
    that's loaded before it. Our dispatchers source sub-files in a fixed
    order; a sub-file inherits everything its predecessors set."""
    v = _vars()
    parent = path.parent
    # JS-side dispatchers (e.g. proxy/stop_chain/shell_policy.js) set env
    js_vars = getattr(v, "_JS_DISPATCHER_VARS", {}).get(parent, set())
    dispatcher = v._DISPATCHER_FOR.get(parent)
    if not dispatcher or not dispatcher.is_file():
        return set(js_vars)
    defs = v._transitive_defs(dispatcher, env_vars)
    disp_text = dispatcher.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"for\s+\w+\s+in\s+([^;]+);\s*do", disp_text)
    if m:
        order = m.group(1).split()
        try:
            idx = order.index(path.stem)
        except ValueError:
            idx = len(order)
        for name in order[:idx]:
            sibling = parent / f"{name}.sh"
            if sibling.is_file():
                defs |= v._transitive_defs(sibling, env_vars)
    return defs | set(js_vars)


def audit_file(path: Path, env_vars: set[str]) -> list[dict]:
    """Run the audit on one file. Returns list of violation dicts."""
    v = _vars()
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return [{"line": 0, "var": "", "snippet": f"read failed: {e}", "rule": "R1"}]
    cleaned = v._strip_single_quoted(v._strip_comments(v._strip_heredocs(text)))
    defs = v._transitive_defs(path, env_vars)
    if path.resolve() != v._SAFETY_SH.resolve():
        defs |= v._transitive_defs(v._SAFETY_SH, env_vars)
    defs |= _dispatcher_defs(path, env_vars)
    refs = v._find_refs(cleaned, defs, env_vars)
    return [
        {"line": ln, "var": var, "snippet": snip, "rule": "R1"}
        for ln, var, snip in refs
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = ap.parse_args()

    env_vars = _vars()._load_env_vars(ENV_FILE)
    files = list(HOOKS_DIR.rglob("*.sh"))
    for extra_dir in EXTRA_SCAN_DIRS:
        if extra_dir.is_dir():
            # Shallow + one-level deep, not recursive -- avoid grabbing node_modules,
            # venvs, or output/ files that happen to be named .sh.
            files.extend(extra_dir.glob("*.sh"))
            for sub in extra_dir.iterdir():
                if sub.is_dir() and sub.name not in {"node_modules", "dist", "out", ".git"}:
                    files.extend(sub.glob("*.sh"))
    files = sorted(set(files))
    results = []
    total_viol = 0
    for f in files:
        viols = audit_file(f, env_vars)
        if viols:
            total_viol += len(viols)
            results.append({
                "file": str(f.relative_to(REPO_ROOT)),
                "findings": viols,
            })

    if args.json:
        print(json.dumps({
            "violation_count": total_viol,
            "files_scanned": len(files),
            "files_with_violations": len(results),
            "files": results,
        }, indent=2))
    else:
        if total_viol == 0:
            print(f"[ok] {len(files)} shell hook(s) scanned -- no undefined-variable references")
            return 0
        print(f"[no] {total_viol} undefined-var reference(s) across {len(results)} file(s):\n")
        for f in results:
            print(f"  {f['file']}:")
            for v in f["findings"][:10]:
                print(f"    line {v['line']}: ${v['var']}  --  {v['snippet']}")
            if len(f["findings"]) > 10:
                print(f"    ... and {len(f['findings']) - 10} more")
            print()
    return 0 if total_viol == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
