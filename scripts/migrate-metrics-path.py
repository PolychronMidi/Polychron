#!/usr/bin/env python3
"""Bulk migrate hardcoded metrics/ path references to use METRICS_DIR env variable.

Replaces:
  JS:     path.join(ROOT, 'metrics', ...)  →  path.join(METRICS_DIR, ...)
          path.join(ROOT, "metrics", ...)  →  same
          path.join(projectRoot, 'metrics', ...)  →  same
          path.join(PROJECT_ROOT, 'metrics', ...)  →  same
          'metrics/<file>'  →  process.env.METRICS_DIR + '/<file>'  (bare string refs)
  Python: os.path.join(PROJECT_ROOT, "metrics", ...)  →  os.path.join(METRICS_DIR, ...)
          os.path.join(ctx.PROJECT_ROOT, "metrics", ...)  →  same
          os.path.join(project_root, "metrics", ...)  →  same
          "metrics/<file>"  →  os.path.join(METRICS_DIR, "<file>")  (bare string refs)
  Shell:  ${PROJECT_ROOT}/metrics/  →  ${METRICS_DIR}/
          $PROJECT_ROOT/metrics/    →  ${METRICS_DIR}/
          metrics/<file>  (bare, in -path or find args)  →  updated
  JSON invariants: "path": "metrics/<file>"  →  "path": "output/metrics/<file>"
                   "activity_path": "metrics/..."  →  same

Also adds METRICS_DIR to .env if not already present.

Safe: prints a dry-run diff by default. Pass --apply to write changes.
"""
from __future__ import annotations
import re
import sys
import pathlib
import argparse

ROOT = pathlib.Path(__file__).resolve().parent.parent

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "tools/HME/KB",  # lance tables / KB chunks — no path refs
}

SKIP_FILES = {
    # This script itself
    "scripts/migrate-metrics-path.py",
    # Already-correct files (the enforcement layer we just updated)
    "scripts/pipeline/validators/check-root-only-dirs.js",
    "scripts/smoke-test-i-wrappers.sh",
    "tools/HME/hooks/pretooluse/pretooluse_bash.sh",
    "tools/HME/hooks/pretooluse/pretooluse_edit.sh",
    "tools/HME/hooks/pretooluse/pretooluse_write.sh",
}

# ---------------------------------------------------------------------------
# Replacement rules — list of (pattern, replacement) pairs per file type.
# Order matters: more specific patterns first.
# ---------------------------------------------------------------------------

JS_RULES = [
    # path.join(ROOT, 'metrics')  or  path.join(ROOT, "metrics")
    (r"path\.join\(ROOT,\s*['\"]metrics['\"]\)",
     "path.join(METRICS_DIR)"),
    (r"path\.join\(ROOT,\s*['\"]metrics['\"],\s*",
     "path.join(METRICS_DIR, "),
    # path.join(projectRoot, 'metrics', ...)
    (r"path\.join\(projectRoot,\s*['\"]metrics['\"],\s*",
     "path.join(METRICS_DIR, "),
    (r"path\.join\(projectRoot,\s*['\"]metrics['\"]\)",
     "path.join(METRICS_DIR)"),
    # path.join(PROJECT_ROOT, 'metrics', ...)
    (r"path\.join\(PROJECT_ROOT,\s*['\"]metrics['\"],\s*",
     "path.join(METRICS_DIR, "),
    (r"path\.join\(PROJECT_ROOT,\s*['\"]metrics['\"]\)",
     "path.join(METRICS_DIR)"),
    # bare string literals  'metrics/foo.json'  or  "metrics/foo.json"
    (r"'metrics/([^']+)'",
     lambda m: f"path.join(METRICS_DIR, '{m.group(1)}')"),
    (r'"metrics/([^"]+)"',
     lambda m: f'path.join(METRICS_DIR, "{m.group(1)}")'),
]

# METRICS_DIR must be defined at the top of each JS file that uses it.
JS_METRICS_DIR_DECL = "const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');\n"
JS_METRICS_DIR_PATTERN = re.compile(r"const METRICS_DIR\s*=")

PY_RULES = [
    # os.path.join(PROJECT_ROOT, "metrics", ...)  — covers any capitalization of the var
    (r'os\.path\.join\(PROJECT_ROOT,\s*"metrics",\s*',
     'os.path.join(METRICS_DIR, '),
    (r"os\.path\.join\(PROJECT_ROOT,\s*'metrics',\s*",
     'os.path.join(METRICS_DIR, '),
    (r'os\.path\.join\(PROJECT_ROOT,\s*"metrics"\)',
     'os.path.join(METRICS_DIR)'),
    (r"os\.path\.join\(PROJECT_ROOT,\s*'metrics'\)",
     'os.path.join(METRICS_DIR)'),
    # os.path.join(ctx.PROJECT_ROOT, "metrics", ...) — keep ctx.PROJECT_ROOT, just add "output"
    (r'os\.path\.join\(ctx\.PROJECT_ROOT,\s*"metrics",\s*',
     'os.path.join(ctx.PROJECT_ROOT, "output", "metrics", '),
    (r'os\.path\.join\(ctx\.PROJECT_ROOT,\s*"metrics"\)',
     'os.path.join(ctx.PROJECT_ROOT, "output", "metrics")'),
    # os.path.join(root, "metrics", ...) — bare "root" local var (e.g. meta_layers, onboarding_chain)
    (r'os\.path\.join\(root,\s*"metrics",\s*',
     'os.path.join(root, "output", "metrics", '),
    (r'os\.path\.join\(root,\s*"metrics"\)',
     'os.path.join(root, "output", "metrics")'),
    # os.path.join(root, "metrics", ...)  — common local var name
    (r'os\.path\.join\(root,\s*"metrics",\s*',
     'os.path.join(METRICS_DIR, '),
    (r'os\.path\.join\(root,\s*"metrics"\)',
     'os.path.join(METRICS_DIR)'),
    # os.path.join(_PROJECT, "metrics", ...)
    (r'os\.path\.join\(_PROJECT,\s*"metrics",\s*',
     'os.path.join(METRICS_DIR, '),
    (r'os\.path\.join\(_PROJECT,\s*"metrics"\)',
     'os.path.join(METRICS_DIR)'),
    # os.path.join(PROJECT, "metrics", ...)
    (r'os\.path\.join\(PROJECT,\s*"metrics",\s*',
     'os.path.join(METRICS_DIR, '),
    (r'os\.path\.join\(PROJECT,\s*"metrics"\)',
     'os.path.join(METRICS_DIR)'),
    # os.path.join(project_root, "metrics", ...)
    (r'os\.path\.join\(project_root,\s*"metrics",\s*',
     'os.path.join(METRICS_DIR, '),
    (r"os\.path\.join\(project_root,\s*'metrics',\s*",
     'os.path.join(METRICS_DIR, '),
    (r'os\.path\.join\(project_root,\s*"metrics"\)',
     'os.path.join(METRICS_DIR)'),
    # os.path.join(tmp_project, "metrics" ...)  — test-only dirs, skip via # metrics-ok
    # bare os.path.join("metrics", ...) relative form — becomes os.path.join("output", "metrics", ...)
    (r'os\.path\.join\("metrics",\s*',
     'os.path.join("output", "metrics", '),
    (r"os\.path\.join\('metrics',\s*",
     "os.path.join('output', 'metrics', "),
    # bare string path refs  "metrics/foo"
    (r'"metrics/([^"]+)"',
     lambda m: f'os.path.join(METRICS_DIR, "{m.group(1)}")'),
    (r"'metrics/([^']+)'",
     lambda m: f"os.path.join(METRICS_DIR, '{m.group(1)}')"),
]

# METRICS_DIR must be defined near PROJECT_ROOT in each Python file.
PY_METRICS_DIR_DECL = 'METRICS_DIR = os.path.join(PROJECT_ROOT, "output", "metrics")\n'
PY_METRICS_DIR_CTX_DECL = 'METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(ctx.PROJECT_ROOT, "output", "metrics"))\n'
PY_METRICS_DIR_PATTERN = re.compile(r"^METRICS_DIR\s*=", re.MULTILINE)

SH_RULES = [
    # ${PROJECT_ROOT}/metrics/  →  ${METRICS_DIR}/
    (r'\$\{PROJECT_ROOT\}/metrics/',  '${METRICS_DIR}/'),
    (r'\$PROJECT_ROOT/metrics/',      '${METRICS_DIR}/'),
    # find -path */metrics* style (in find commands)
    (r"-path '\./metrics",            "-path './output/metrics"),
    (r'-not -path "\./metrics"',      '-not -path "./output/metrics"'),
]

# JSON: plain path strings like "metrics/foo.json" in "path" or "activity_path" fields
JSON_PATH_RE = re.compile(r'("(?:path|activity_path|shell)":\s*")(metrics/)([^"]+)')


def _apply_rules(text: str, rules: list) -> str:
    for pat, repl in rules:
        if callable(repl):
            text = re.sub(pat, repl, text)
        else:
            text = re.sub(pat, repl, text)
    return text


def _has_module_level_project_root_py(text: str) -> bool:
    """True if the file has a module-level PROJECT_ROOT = ... assignment."""
    return bool(re.search(r'^PROJECT_ROOT\s*=', text, re.MULTILINE))


def _needs_metrics_dir_py(text: str) -> bool:
    return "METRICS_DIR" in text and not PY_METRICS_DIR_PATTERN.search(text)


def _needs_metrics_dir_js(text: str) -> bool:
    return "METRICS_DIR" in text and not JS_METRICS_DIR_PATTERN.search(text)


def _insert_py_metrics_dir(text: str) -> str:
    """Insert METRICS_DIR after the last module-level PROJECT_ROOT assignment."""
    m = None
    for m in re.finditer(r'^PROJECT_ROOT\s*=.+\n', text, re.MULTILINE):
        pass
    if m:
        pos = m.end()
        return text[:pos] + PY_METRICS_DIR_DECL + text[pos:]
    return text


def _insert_js_metrics_dir(text: str) -> str:
    """Insert METRICS_DIR after the ROOT constant declaration."""
    m = re.search(r'^const ROOT\s*=.+\n', text, re.MULTILINE)
    if m:
        pos = m.end()
        return text[:pos] + JS_METRICS_DIR_DECL + text[pos:]
    # Fallback: after require block
    lines = text.splitlines(keepends=True)
    last_require = 0
    for i, line in enumerate(lines):
        if 'require(' in line:
            last_require = i
    pos = sum(len(l) for l in lines[:last_require + 1])
    return text[:pos] + JS_METRICS_DIR_DECL + text[pos:]


def process_file(path: pathlib.Path, apply: bool) -> tuple[bool, str]:
    """Return (changed, diff_text)."""
    try:
        original = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False, ""

    ext = path.suffix.lower()
    rel = str(path.relative_to(ROOT))

    if rel in SKIP_FILES:
        return False, ""

    text = original

    if ext == ".js" or ext == ".ts":
        text = _apply_rules(text, JS_RULES)
        if _needs_metrics_dir_js(text):
            text = _insert_js_metrics_dir(text)
    elif ext == ".py":
        uses_ctx = bool(re.search(r'\bctx\.PROJECT_ROOT\b', original))
        has_module_root = _has_module_level_project_root_py(original)

        text = _apply_rules(text, PY_RULES)

        if _needs_metrics_dir_py(text):
            if has_module_root:
                text = _insert_py_metrics_dir(text)
            elif uses_ctx:
                pass  # ctx-based files use ctx.PROJECT_ROOT, "output", "metrics" inline — no METRICS_DIR const needed
            else:
                # function-scoped project_root: inline env-aware fallback at call site
                text = re.sub(
                    r'os\.path\.join\(project_root,\s*["\']metrics["\'],\s*',
                    'os.path.join(os.environ.get("METRICS_DIR", os.path.join(project_root, "output", "metrics")), ',
                    text,
                )
                text = re.sub(
                    r'os\.path\.join\(project_root,\s*["\']metrics["\']\)',
                    'os.path.join(os.environ.get("METRICS_DIR", os.path.join(project_root, "output", "metrics")))',
                    text,
                )
    elif ext == ".sh":
        text = _apply_rules(text, SH_RULES)
        # Shell uses ${METRICS_DIR} which must be sourced from .env via _safety.sh
        # No declaration needed — hooks already source _safety.sh which reads .env
    elif ext == ".json":
        # Only update path-value fields, not all occurrences
        text = JSON_PATH_RE.sub(lambda m: m.group(1) + "output/" + m.group(2) + m.group(3), text)
    elif ext == ".md":
        # Update doc references — bare metrics/ paths in backtick or plain text
        text = re.sub(r'`metrics/', '`output/metrics/', text)
        text = re.sub(r'(?<![/\w])metrics/([a-zA-Z0-9_\-\.]+)', r'output/metrics/\1', text)

    if text == original:
        return False, ""

    # Build a simple line-diff summary
    orig_lines = original.splitlines()
    new_lines = text.splitlines()
    diff_lines = []
    for i, (a, b) in enumerate(zip(orig_lines, new_lines)):
        if a != b:
            diff_lines.append(f"  {rel}:{i+1}: -{a.strip()}")
            diff_lines.append(f"  {rel}:{i+1}: +{b.strip()}")
    for i in range(len(new_lines), len(orig_lines)):
        diff_lines.append(f"  {rel}:{len(new_lines)+i+1}: -{orig_lines[len(new_lines)+i].strip()}")

    if apply:
        path.write_text(text, encoding="utf-8")

    return True, "\n".join(diff_lines[:40]) + ("\n  ..." if len(diff_lines) > 40 else "")


def should_skip(path: pathlib.Path) -> bool:
    parts = path.parts
    for skip in SKIP_DIRS:
        if any(p == skip or path_starts_with(path, skip) for p in parts):
            return True
    return False


def path_starts_with(path: pathlib.Path, prefix: str) -> bool:
    try:
        path.relative_to(ROOT / prefix)
        return True
    except ValueError:
        return False


def update_env(apply: bool) -> bool:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return False
    text = env_path.read_text(encoding="utf-8")
    if "METRICS_DIR" in text:
        return False
    # Insert after PROJECT_ROOT line
    new_text = re.sub(
        r'(PROJECT_ROOT=.+\n)',
        r'\1METRICS_DIR=${PROJECT_ROOT}/output/metrics\n',
        text,
        count=1,
    )
    if new_text == text:
        new_text = text + "\nMETRICS_DIR=${PROJECT_ROOT}/output/metrics\n"
    if apply:
        env_path.write_text(new_text, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry-run)")
    parser.add_argument("--summary", action="store_true", help="Print only changed file count, no diffs")
    args = parser.parse_args()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[migrate-metrics-path] {mode}")

    env_changed = update_env(args.apply)
    if env_changed:
        print(f"  .env: +METRICS_DIR=${{PROJECT_ROOT}}/output/metrics")

    changed_files = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        if should_skip(path):
            continue
        if path.suffix.lower() not in {".js", ".ts", ".py", ".sh", ".json", ".md"}:
            continue
        changed, diff = process_file(path, args.apply)
        if changed:
            changed_files.append(str(path.relative_to(ROOT)))
            if not args.summary and diff:
                print(f"\n{path.relative_to(ROOT)}:")
                print(diff)

    print(f"\n[migrate-metrics-path] {len(changed_files)} file(s) {'updated' if args.apply else 'would change'}:")
    for f in changed_files:
        print(f"  {f}")

    if not args.apply:
        print("\nRun with --apply to write changes.")


if __name__ == "__main__":
    main()
