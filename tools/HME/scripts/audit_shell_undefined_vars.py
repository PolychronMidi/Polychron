#!/usr/bin/env python3
"""Shell undefined-variable audit -- static analysis for tools/HME/hooks/**/*.sh.

Scans every hook script for `$VAR` / `${VAR}` references that have no
assignment anywhere in scope (the file itself, any file it sources, or the
`.env` / system defaults set by `_safety.sh`). Catches the exact bug class
that silently broke auto-completeness-inject for months: `$_AC_PROJECT`
referenced in `holograph.sh` had never been defined anywhere in the repo's
history, and under `set -u` in `_safety.sh`, it crashed the stop stage before
the completeness gate ever got a chance to run.

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


def _load_env_vars(path: Path) -> set[str]:
    """Extract variable names from a .env file (KEY=VALUE lines)."""
    out: set[str] = set()
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=", raw)
        if m:
            out.add(m.group(1))
    return out


def _strip_heredocs(text: str) -> str:
    """Replace heredoc bodies with blank lines so their `$VAR` contents
    (often payloads to other interpreters) don't trigger false positives."""
    # Keep line boundaries intact for reasonable line-number reporting.
    def _blank(m: re.Match) -> str:
        body = m.group(3)
        return m.group(0).replace(body, "\n" * body.count("\n"))
    return _HEREDOC_RE.sub(_blank, text)


def _strip_comments(text: str) -> str:
    """Remove shell comments (# to end-of-line), respecting quoted strings."""
    out = []
    for line in text.splitlines(True):
        # Fast path: if no # at all, keep as-is.
        if "#" not in line:
            out.append(line)
            continue
        # Walk char-by-char tracking quote state.
        in_single = False
        in_double = False
        i = 0
        emit_end = len(line)
        while i < len(line):
            c = line[i]
            if c == "\\" and i + 1 < len(line):
                i += 2
                continue
            if c == "'" and not in_double:
                in_single = not in_single
            elif c == '"' and not in_single:
                in_double = not in_double
            elif c == "#" and not in_single and not in_double:
                # Comment only if preceded by whitespace or start-of-line.
                if i == 0 or line[i - 1] in " \t":
                    emit_end = i
                    break
            i += 1
        out.append(line[:emit_end] + ("\n" if line.endswith("\n") and emit_end < len(line) else ""))
    return "".join(out)


def _strip_single_quoted(text: str) -> str:
    """Replace the body of every single-quoted bash string with spaces so
    `$VAR` references inside (jq program text, awk scripts, python
    heredocs, etc.) don't trigger false positives. Bash itself never
    expands $ inside single quotes, so any ref there is by definition
    not a shell-scope reference. Preserve newlines for line numbers.

    Tracks double-quote state so apostrophes in strings like
    `"Claude's"` or `"pipeline's"` aren't mis-treated as start-of-
    single-quote (which would put the scanner into a multi-line
    'inside-quotes' state and pollute downstream analysis with
    cross-region $VAR misses)."""
    out = []
    i = 0
    n = len(text)
    in_double = False
    while i < n:
        c = text[i]
        if c == "\\" and i + 1 < n:
            out.append(text[i:i+2])
            i += 2
            continue
        if c == '"':
            in_double = not in_double
            out.append(c)
            i += 1
            continue
        if c == "'" and not in_double:
            # Find matching close quote. Bash single quotes can't contain
            # escaped quotes -- first unescaped ' ends the string.
            j = text.find("'", i + 1)
            if j == -1:
                out.append(text[i:])
                break
            body = text[i+1:j]
            # Replace non-newline chars with space.
            out.append("'")
            out.append("".join(" " if ch != "\n" else "\n" for ch in body))
            out.append("'")
            i = j + 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _collect_defs(text: str) -> set[str]:
    """Extract every variable-defining construct in `text`."""
    defs: set[str] = set()
    for m in _ASSIGNMENT_RE.finditer(text):
        defs.add(m.group(1))
    for pat in (_FOR_VAR_RE, _FOR_ARITH_RE, _LET_RE, _TESTV_RE, _GETOPTS_RE):
        for m in pat.finditer(text):
            defs.add(m.group(1))
    # `read X Y Z` binds all listed vars
    for m in _WHILE_READ_RE.finditer(text):
        for tok in m.group(1).split():
            defs.add(tok)
    return defs


def _find_sources(text: str, base_dir: Path) -> list[Path]:
    """Return resolved paths of files this text `source`s. Best-effort --
    $PROJECT_ROOT / $_HME_HELPERS_DIR etc. are resolved to their common
    literal expansions for this project."""
    out: list[Path] = []
    for m in _SOURCE_RE.finditer(text):
        target = m.group(2) or m.group(3) or m.group(4) or ""
        if not target:
            continue
        # Best-effort resolve of common $-variables used in our source lines
        resolved = (
            target
            .replace('"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"', str(base_dir))
            .replace('$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)', str(base_dir))
            .replace("${_HME_HELPERS_DIR}", str(REPO_ROOT / "tools/HME/hooks/helpers"))
            .replace("${_HME_SAFETY_DIR}", str(REPO_ROOT / "tools/HME/hooks/helpers/safety"))
            .replace("${_STOP_DIR}", str(REPO_ROOT / "tools/HME/hooks/lifecycle"))
            .replace('"$_HME_ENV_FILE"', str(ENV_FILE))
            .replace("${PROJECT_ROOT:-}", str(REPO_ROOT))
            .replace("${PROJECT_ROOT}", str(REPO_ROOT))
            .replace("$PROJECT_ROOT", str(REPO_ROOT))
            .replace("${_HME_ADAPT_FILE}", "")  # skip dynamic
            .replace("$_HME_ADAPT_FILE", "")
        )
        # Skip unresolved dynamic paths
        if "$" in resolved or "*" in resolved:
            continue
        p = Path(resolved)
        if not p.is_absolute():
            p = (base_dir / resolved).resolve()
        if p.is_file() and p.suffix == ".sh":
            out.append(p)
    return out


def _transitive_defs(entry: Path, env_vars: set[str], seen: set[Path] | None = None) -> set[str]:
    """Collect all variable definitions reachable from `entry` via source chains."""
    if seen is None:
        seen = set()
    if entry in seen or not entry.is_file():
        return set()
    seen.add(entry)
    try:
        text = entry.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()
    cleaned = _strip_heredocs(_strip_comments(text))
    defs = _collect_defs(cleaned)
    for sub in _find_sources(text, entry.parent):
        defs |= _transitive_defs(sub, env_vars, seen)
    return defs


def _find_refs(text: str, defs: set[str], env_vars: set[str]) -> list[tuple[int, str, str]]:
    """Return list of (line_no, varname, context_snippet) for undefined-var references."""
    violations: list[tuple[int, str, str]] = []
    known = defs | env_vars | _BUILTIN_VARS
    # `jq --arg NAME value 'jq-script-using-$NAME'` declares jq-script-scope
    for jm in re.finditer(r"--(?:arg|argjson|slurpfile)\s+([A-Za-z_][A-Za-z0-9_]*)\b", text):
        known = known | {jm.group(1)}
    for m in _REF_RE.finditer(text):
        name = m.group("brace") or m.group("bare")
        suffix = m.group("suffix") or ""
        if _SAFE_SUFFIX_RE.match(suffix):
            continue  # ${VAR:-default} etc. is safe
        if name in known:
            continue
        # line number
        line_no = text.count("\n", 0, m.start()) + 1
        # Context snippet: the line containing this match
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", m.end())
        if line_end == -1:
            line_end = len(text)
        snippet = text[line_start:line_end].strip()
        violations.append((line_no, name, snippet[:140]))
    return violations


_SAFETY_SH = HOOKS_DIR / "helpers" / "_safety.sh"

# Dispatcher -> sub-file-dir map. Sub-files in these dirs are SOURCED BY
_DISPATCHER_FOR = {
    HOOKS_DIR / "helpers" / "safety":      _SAFETY_SH,
    HOOKS_DIR / "lifecycle" / "stop":      _SAFETY_SH,
    HOOKS_DIR / "pretooluse" / "bash":     HOOKS_DIR / "pretooluse" / "pretooluse_bash.sh",
}

# Vars set by JS-side dispatcher wrappers BEFORE sourcing a sub-file.
_JS_DISPATCHER_VARS = {
    HOOKS_DIR / "lifecycle" / "stop": {
        "PROJECT", "_HME_HELPERS_DIR", "_STOP_DIR", "_DETECTORS_DIR",
        "_HME_STAGE_NAME", "_HME_HOOK_NAME", "INPUT",
    },
}



# Re-exports -- audit + main extracted.
import sys; sys.path.insert(0, "/home/jah/Polychron/scripts")
from audit_shell_undefined_audit import _dispatcher_defs, audit_file, main  # noqa: F401, E402

if __name__ == "__main__":
    sys.exit(main())
