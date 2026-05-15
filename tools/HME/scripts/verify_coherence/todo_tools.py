"""Todo store schema + merge consistency + tool-surface coverage."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

from ._base import (
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)


class TodoStoreSchemaVerifier(Verifier):
    """Every entry in todos.json has the required canonical fields."""
    name = "todo-store-schema"
    category = "state"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        store = os.path.join(_PROJECT, "tools", "HME", "KB", "todos.json")
        if not os.path.isfile(store):
            return _result(SKIP, 1.0, "no todo store (fresh project)")
        try:
            with open(store) as f:
                data = json.load(f)
        except Exception as e:
            return _result(FAIL, 0.0, f"todos.json invalid JSON: {e}")
        if not isinstance(data, list):
            return _result(FAIL, 0.0, "todos.json is not a JSON array")
        violations = []
        # First entry should be _meta (or be a regular entry from legacy schema)
        for i, entry in enumerate(data):
            if not isinstance(entry, dict):
                violations.append(f"[{i}] not a dict")
                continue
            if entry.get("id") == 0 and "_meta" in entry:
                # Header entry
                continue
            for required in ("id", "text", "status", "done"):
                if required not in entry:
                    violations.append(f"[{i}] missing field '{required}'")
                    break
        score = 1.0 - min(1.0, len(violations) / max(1, len(data)))
        if not violations:
            return _result(PASS, 1.0, f"{len(data)} entries pass schema check")
        return _result(WARN, score, f"{len(violations)} schema violations", violations[:10])


class TodoMarkdownSyncVerifier(Verifier):
    """TODO.md should be the sole human todo surface and match todos.json."""
    name = "todo-markdown-sync"
    category = "state"
    subtag = "interface-contract"
    weight = 1.5

    def run(self) -> VerdictResult:
        todo_md = os.path.join(_PROJECT, "doc", "templates", "TODO.md")
        spec_md = os.path.join(_PROJECT, "doc", "templates", "SPEC.md")
        autoflip = os.path.join(_PROJECT, "tools", "HME", "scripts", "todo_autoflip.py")
        old_autoflip = os.path.join(_PROJECT, "tools", "HME", "scripts", "spec_autoflip.py")
        failures: list[str] = []
        if not os.path.isfile(todo_md):
            failures.append("doc/templates/TODO.md missing")
        if os.path.exists(spec_md):
            failures.append("doc/templates/SPEC.md should be deleted")
        if not os.path.isfile(autoflip):
            failures.append("todo_autoflip.py missing")
        if os.path.exists(old_autoflip):
            failures.append("spec_autoflip.py still exists")
        hook_paths = [
            os.path.join(_PROJECT, "tools", "HME", "hooks", "posttooluse", "posttooluse_edit.sh"),
            os.path.join(_PROJECT, "tools", "HME", "hooks", "posttooluse", "posttooluse_write.sh"),
        ]
        for hook in hook_paths:
            try:
                text = open(hook, encoding="utf-8").read()
            except OSError as e:
                failures.append(f"{os.path.relpath(hook, _PROJECT)} unreadable: {e}")
                continue
            if "doc/templates/TODO.md" not in text or "todo_autoflip.py" not in text:
                failures.append(f"{os.path.relpath(hook, _PROJECT)} not wired to TODO autoflip")
        try:
            sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "service"))
            from server.tools_analysis.todo_store import load_store
            from server.tools_analysis.todo_md_sync import render_todo_md, section_headers, TODO_SECTIONS
            _raw, _meta, todos = load_store()
            current = open(todo_md, encoding="utf-8").read() if os.path.isfile(todo_md) else ""
            if tuple(section_headers(current)) != TODO_SECTIONS:
                failures.append(f"TODO.md sections are {section_headers(current)}, expected {list(TODO_SECTIONS)}")
            rendered = render_todo_md(todos, previous_md=current)
            if current and rendered != current:
                failures.append("TODO.md does not match render(todos.json)")
        except Exception as e:
            failures.append(f"TODO.md sync check errored: {e}")
        if failures:
            score = max(0.0, 1.0 - 0.25 * len(failures))
            return _result(FAIL, score, f"{len(failures)} TODO sync violation(s)", failures)
        return _result(PASS, 1.0, "TODO.md is canonical, synced, and hook-wired")


class TodoOnboardingDecoupledVerifier(Verifier):
    """Onboarding state must not create persistent TODO/TodoWrite entries."""
    name = "todo-onboarding-decoupled"
    category = "state"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        failures: list[str] = []
        store = os.path.join(_PROJECT, "tools", "HME", "KB", "todos.json")
        if os.path.isfile(store):
            try:
                sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "service"))
                from server.tools_analysis.todo_store import flat_entries, load_store
                _raw, _meta, todos = load_store(store)
                for entry in flat_entries(todos):
                    text = str(entry.get("text", ""))
                    if entry.get("source") == "onboarding" or "HME onboarding walkthrough" in text:
                        failures.append(f"stale onboarding todo #{entry.get('id')}: {text[:80]}")
            except Exception as e:
                failures.append(f"store check errored: {e}")
        code_checks = [
            ("tools/HME/service/server/onboarding_chain.py", "register_onboarding_tree"),
            ("tools/HME/service/server/onboarding_chain.py", "clear_onboarding_tree"),
            ("tools/HME/service/server/tools_analysis/todo_native_merge.py", "[HME onboarding]"),
            ("tools/HME/service/server/tools_analysis/todo_native_merge.py", '"spec"'),
            ("tools/HME/hooks/helpers/_todo_merge.py", "[HME onboarding]"),
        ]
        for rel, needle in code_checks:
            path = os.path.join(_PROJECT, rel)
            try:
                text = open(path, encoding="utf-8").read()
            except OSError as e:
                failures.append(f"{rel} unreadable: {e}")
                continue
            if needle in text:
                failures.append(f"{rel} still references {needle!r}")
        if failures:
            return _result(FAIL, 0.0,
                           f"{len(failures)} onboarding/TODO coupling issue(s)",
                           failures[:12])
        return _result(PASS, 1.0, "onboarding state is separate from persistent TODO storage")


class TodoArchiveContractVerifier(Verifier):
    """TODO-era devlogs should keep their documented archive shape."""
    name = "todo-archive-contract"
    category = "state"
    subtag = "interface-contract"
    weight = 0.5
    strict_from = "2026-05-15"

    def run(self) -> VerdictResult:
        devlog = os.path.join(_PROJECT, "tools", "HME", "KB", "devlog")
        index_path = os.path.join(_PROJECT, "tools", "HME", "config", "todo-archive-index.json")
        index_failures: list[str] = []
        try:
            with open(index_path, encoding="utf-8") as f:
                index = json.load(f)
            archives = index.get("archives")
            if not isinstance(archives, list):
                index_failures.append("archives must be a list")
            else:
                for i, item in enumerate(archives):
                    if not isinstance(item, dict):
                        index_failures.append(f"archives[{i}] is not an object")
                        continue
                    for key in ("archived", "set_name", "archive_path", "task_count", "done_count", "todo_count"):
                        if key not in item:
                            index_failures.append(f"archives[{i}] missing {key}")
        except Exception as e:
            index_failures.append(f"archive index unreadable: {e}")
        if not os.path.isdir(devlog):
            if index_failures:
                return _result(FAIL, 0.0, "TODO archive index invalid", index_failures)
            return _result(PASS, 1.0, "archive index valid; no local devlog directory")
        try:
            sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "service"))
            from server.tools_analysis.todo_archive import validate_archive_text
        except Exception as e:
            return _result(ERROR, 0.0, f"archive validator import failed: {e}")
        checked = 0
        legacy = 0
        failures: list[str] = []
        for name in sorted(os.listdir(devlog)):
            if not name.endswith(".md"):
                continue
            path = os.path.join(devlog, name)
            try:
                text = open(path, encoding="utf-8", errors="ignore").read()
            except OSError as e:
                failures.append(f"{name}: unreadable: {e}")
                continue
            if "## TODO snapshot" not in text:
                continue
            if name[:10] < self.strict_from and "## todos.json snapshot" not in text:
                legacy += 1
                continue
            checked += 1
            errors = validate_archive_text(text)
            if errors:
                failures.append(f"{name}: {', '.join(errors)}")
        if index_failures:
            failures.extend(index_failures)
        if failures:
            return _result(FAIL, 0.0, f"{len(failures)} TODO archive contract violation(s)", failures[:10])
        suffix = f"; {legacy} legacy TODO archive(s) skipped" if legacy else ""
        return _result(PASS, 1.0, f"{checked} current TODO archive(s) match contract{suffix}")



# Verifiers -- COVERAGE category


class ToolSurfaceCoverageVerifier(Verifier):
    """Every public @ctx.mcp.tool() function appears in either templates/ONBOARDING.md
    or HME.md. Hidden tools don't need to be documented."""
    name = "tool-surface-coverage"
    category = "coverage"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        import ast
        public_tools = set()
        hidden_tools = set()
        for root, _dirs, files in os.walk(_SERVER_DIR):
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(root, f)
                try:
                    with open(path) as fp:
                        tree = ast.parse(fp.read())
                except Exception:
                    # silent-ok: optional fallback path.
                    continue
                for node in ast.walk(tree):
                    if not isinstance(node, ast.FunctionDef):
                        continue
                    for dec in node.decorator_list:
                        if not (isinstance(dec, ast.Call)
                                and isinstance(dec.func, ast.Attribute)
                                and dec.func.attr == "tool"):
                            continue
                        # Check meta={"hidden": True}
                        is_hidden = False
                        for kw in dec.keywords:
                            if kw.arg == "meta" and isinstance(kw.value, ast.Dict):
                                for k, v in zip(kw.value.keys, kw.value.values):
                                    if (isinstance(k, ast.Constant) and k.value == "hidden"
                                            and isinstance(v, ast.Constant) and v.value):
                                        is_hidden = True
                        if is_hidden:
                            hidden_tools.add(node.name)
                        else:
                            public_tools.add(node.name)
        if not public_tools:
            return _result(SKIP, 1.0, "no public tools found")
        # Check each public tool appears in primer/HME.md
        primer = os.path.join(_PROJECT, "doc", "templates", "ONBOARDING.md")
        hmemd = os.path.join(_PROJECT, "doc", "HME.md")
        text = ""
        for p in (primer, hmemd):
            if os.path.isfile(p):
                with open(p) as f:
                    text += f.read()
        missing = sorted(t for t in public_tools if t not in text)
        if not missing:
            return _result(PASS, 1.0, f"all {len(public_tools)} public tools documented",
                           [f"public: {sorted(public_tools)}", f"hidden: {sorted(hidden_tools)}"])
        score = 1.0 - len(missing) / len(public_tools)
        return _result(WARN, score, f"{len(missing)}/{len(public_tools)} public tools undocumented",
                       missing)



# Verifiers -- RUNTIME category


class TodoMergeHookConsistencyVerifier(Verifier):
    """The native TodoWrite hook should merge updatedInput without blocking."""
    name = "todowrite-hook-nonblock"
    category = "code"
    subtag = "structural-integrity"
    weight = 1.0

    def run(self) -> VerdictResult:
        hook = os.path.join(_PROJECT, "tools", "HME", "event_kernel", "native_hooks", "todo.js")
        if not os.path.isfile(hook):
            return _result(SKIP, 1.0, "native TodoWrite hook not found")
        try:
            with open(hook) as f:
                src = f.read()
        except Exception as e:
            return _result(ERROR, 0.0, f"read error: {e}")
        m = re.search(r'async function pretoolTodoWrite\(.*?\n}\n\nasync function posttoolTodoWrite', src, re.DOTALL)
        if not m:
            return _result(FAIL, 0.0, "pretoolTodoWrite handler not found")
        body = m.group(0)
        if "hookBlock(" in body or '"decision":"block"' in body or "'decision':'block'" in body:
            return _result(FAIL, 0.0,
                           "TodoWrite handler has a blocking decision -- native TodoWrite will be frozen",
                           ["return allow(...updatedInput...) so native TodoWrite proceeds"])
        if "updatedInput" not in body or "return allow" not in body:
            return _result(FAIL, 0.5,
                           "TodoWrite handler does not visibly return allow(...updatedInput...)",
                           ["preserve native TodoWrite with a merged updatedInput payload"])
        return _result(PASS, 1.0, "TodoWrite hook allows native TodoWrite to proceed")
