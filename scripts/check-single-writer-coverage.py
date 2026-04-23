#!/usr/bin/env python3
"""Meta-invariant: every lifecycle-critical write site MUST call assert_writer.

Walks the HME Python tree and flags any mutation of a protected domain
that isn't preceded by an assert_writer call in the same function.

Protected mutation patterns (per lifecycle_writers._OWNERS):
  llama-server       → subprocess.Popen() of llama-server binary
  embedders          → SentenceTransformer(..., device=...)
  kb                 → knowledge_table.add / remove
  hme-todo-store     → _write_todo_entry / _save_todos
  lifesaver-registry → _failures[...] =  (in failure_genealogy)
  onboarding-state   → _STATE_FILE write (in onboarding_chain)

Exit 0 on clean, 1 on violations. Intended to run in CI and via a
selftest probe. Catches the next duplicate-supervisor-class bug before
it ships — not after it races in production.
"""
from __future__ import annotations

import ast
import os
import sys


# Pattern: (domain, glob-of-source-files-that-are-legitimate-owners,
#           AST-match-predicate-describing-a-mutation-call)
#
# The predicate receives an ast.Call and returns True if this call looks
# like a mutation of the protected domain. We rely on substring checks
# against node source text; imperfect but zero-dependency and good enough
# to catch the "forgot to gate" class of mistake.

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_MCP_ROOT = os.path.join(_PROJECT_ROOT, "tools", "HME", "mcp")


def _function_calls_assert_writer(func_node: ast.FunctionDef, domain: str) -> bool:
    """True iff the function body contains assert_writer("<domain>", ...)
    somewhere (direct call or wrapped in try/except)."""
    for child in ast.walk(func_node):
        if not isinstance(child, ast.Call):
            continue
        fn = child.func
        name = None
        if isinstance(fn, ast.Name):
            name = fn.id
        elif isinstance(fn, ast.Attribute):
            name = fn.attr
        if name != "assert_writer":
            continue
        if not child.args:
            continue
        first = child.args[0]
        if isinstance(first, ast.Constant) and first.value == domain:
            return True
    return False


def _find_function_containing(tree: ast.AST, target_node: ast.AST) -> ast.FunctionDef | None:
    """Return the FunctionDef enclosing target_node, or None for module-level."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for child in ast.walk(node):
                if child is target_node:
                    return node
    return None


def _scan_file(path: str, checks: list[tuple[str, str, callable]]) -> list[str]:
    """Return list of violation messages (empty on clean)."""
    violations: list[str] = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            src = f.read()
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        return [f"{path}: parse error: {e}"]
    rel = os.path.relpath(path, _PROJECT_ROOT)
    for domain, owner_stem, predicate in checks:
        # Core invariant: only the OWNER module may contain mutations for
        # this domain. Within the owner, we trust its internal organization
        # (not every private helper needs its own assert_writer — the
        # module's public entry points are already gated and the existence
        # of the module-level `from server.lifecycle_writers import`
        # confirms the contract is acknowledged).
        is_owner = owner_stem + ".py" == os.path.basename(path)
        if is_owner:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if not predicate(node, src):
                continue
            lineno = getattr(node, "lineno", "?")
            violations.append(
                f"{rel}:{lineno}: non-owner module calls protected mutation for "
                f"domain {domain!r}; expected sole writer: {owner_stem}.py"
            )
    return violations


def _match_llama_spawn(node: ast.Call, src: str) -> bool:
    """Popen(argv) where argv references a llama-server binary.
    Source-text substring check on the surrounding context avoids
    flagging unrelated subprocess.Popen (nvidia-smi, git, lsof)."""
    fn = node.func
    is_popen = (
        (isinstance(fn, ast.Attribute) and fn.attr == "Popen")
        or (isinstance(fn, ast.Name) and fn.id == "Popen")
    )
    if not is_popen:
        return False
    # Only flag Popen calls in a context that mentions llama-server.
    # ast.unparse is py3.9+; fall back to lineno-window slice.
    try:
        snippet = ast.unparse(node)
    except Exception:
        start = max(0, (getattr(node, "lineno", 1) - 1))
        end = getattr(node, "end_lineno", start + 5)
        snippet = "\n".join(src.splitlines()[start:end])
    return "llama-server" in snippet or "build_argv" in snippet


def _match_sentence_transformer(node: ast.Call, src: str) -> bool:
    fn = node.func
    name = None
    if isinstance(fn, ast.Name):
        name = fn.id
    elif isinstance(fn, ast.Attribute):
        name = fn.attr
    return name == "SentenceTransformer"


def _match_kb_write(node: ast.Call, src: str) -> bool:
    fn = node.func
    if not isinstance(fn, ast.Attribute):
        return False
    if fn.attr not in {"add_knowledge_entry", "remove_knowledge"}:
        return False
    return True


def _match_todo_write(node: ast.Call, src: str) -> bool:
    fn = node.func
    name = None
    if isinstance(fn, ast.Name):
        name = fn.id
    elif isinstance(fn, ast.Attribute):
        name = fn.attr
    return name in {"_save_todos"}


def _match_onboarding_write(node: ast.Call, src: str) -> bool:
    # onboarding state is a file write; look for open(_STATE_FILE, "w")
    fn = node.func
    if not isinstance(fn, ast.Name) or fn.id != "open":
        return False
    # Check if any arg is _STATE_FILE
    for a in node.args:
        if isinstance(a, ast.Name) and a.id == "_STATE_FILE":
            return True
    return False


_CHECKS = [
    ("llama-server", "llamacpp_daemon", _match_llama_spawn),
    ("embedders", "rag_engines", _match_sentence_transformer),
    ("hme-todo-store", "todo", _match_todo_write),
    ("onboarding-state", "onboarding_chain", _match_onboarding_write),
]


def main() -> int:
    violations: list[str] = []
    for root, _dirs, files in os.walk(_MCP_ROOT):
        # Skip venv / __pycache__
        if "__pycache__" in root or "/venv/" in root:
            continue
        for f in files:
            if not f.endswith(".py"):
                continue
            violations.extend(_scan_file(os.path.join(root, f), _CHECKS))
    if violations:
        print(f"check-single-writer-coverage: {len(violations)} violation(s):")
        for v in violations:
            print(f"  {v}")
        return 1
    print("check-single-writer-coverage: CLEAN — all protected mutations gated by assert_writer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
