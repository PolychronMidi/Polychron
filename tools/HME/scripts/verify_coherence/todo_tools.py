"""Todo store schema, sync, archive, and Codex-plan consistency."""
from __future__ import annotations

import json
import os
import subprocess
import sys

from ._base import (
    ERROR,
    FAIL,
    PASS,
    SKIP,
    VerdictResult,
    Verifier,
    WARN,
    _PROJECT,
    _SCRIPTS_DIR,
    _SERVER_DIR,
    _result,
    errored,
    failed,
    passed,
    register,
    skipped,
    warned,
)


@register
class TodoStoreSchemaVerifier(Verifier):
    """Every entry in todos.json has the required canonical fields."""
    name = "todo-store-schema"
    category = "state"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        store = os.path.join(_PROJECT, "tools", "HME", "KB", "todos.json")
        if not os.path.isfile(store):
            return skipped(summary="no todo store (fresh project)")
        try:
            sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "service"))
            from server.tools_analysis.todo_store import flat_entries, load_store, validate_store
            _raw, _meta, todos = load_store(store)
            violations = validate_store(store)
        except Exception as e:
            return failed(summary=f"todos.json validation errored: {e}")
        entries = flat_entries(todos)
        score = 1.0 - min(1.0, len(violations) / max(1, len(entries)))
        if not violations:
            return passed(summary=f"{len(entries)} entries pass strict schema check")
        return warned(score=score, summary=f"{len(violations)} schema violations", details=violations[:10])


@register
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
        bridge_paths = [
            os.path.join(_PROJECT, "tools", "HME", "hooks", "posttooluse", "posttooluse_edit.sh"),
            os.path.join(_PROJECT, "tools", "HME", "hooks", "posttooluse", "posttooluse_write.sh"),
            os.path.join(_PROJECT, "tools", "HME", "proxy", "middleware", "28_post_write_side_effects.js"),
        ]
        wired = False
        unreadable: list[str] = []
        for bridge in bridge_paths:
            try:
                text = open(bridge, encoding="utf-8").read()
            except OSError as e:
                unreadable.append(f"{os.path.relpath(bridge, _PROJECT)} unreadable: {e}")
                continue
            norm = text.replace("\\/", "/").replace("\\.", ".")
            if "doc/templates/TODO.md" in norm and "todo_autoflip.py" in norm:
                wired = True
                break
        if not wired:
            failures.extend(unreadable)
            failures.append("TODO autoflip not wired through hook or proxy post-write bridge")
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
            return failed(score=score, summary=f"{len(failures)} TODO sync violation(s)", details=failures)
        return passed(summary="TODO.md is canonical, synced, and hook-wired")


@register
class TodoCodexPlanSyncVerifier(Verifier):
    """Codex update_plan must have a bridge into the canonical TODO store."""
    name = "todo-codex-plan-sync"
    category = "state"
    subtag = "interface-contract"
    weight = 1.0

    def run(self) -> VerdictResult:
        failures: list[str] = []
        script = os.path.join(_SCRIPTS_DIR, "codex_plan_sync.py")
        if not os.path.isfile(script):
            failures.append("tools/HME/scripts/codex_plan_sync.py missing")
        else:
            proc = subprocess.run(
                ["python3", "-m", "py_compile", script],
                capture_output=True,
                text=True,
                timeout=20,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
            if proc.returncode != 0:
                failures.append(f"codex_plan_sync.py does not compile: {proc.stderr.strip()}")
        for rel in [
            "tools/HME/proxy/codex_proxy.js",
            "tools/HME/event_kernel/codex_adapter.js",
        ]:
            target = os.path.join(_PROJECT, rel)
            if not os.path.isfile(target):
                failures.append(f"{rel} missing")
                continue
            proc = subprocess.run(
                ["node", "--check", target],
                capture_output=True,
                text=True,
                timeout=20,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
            if proc.returncode != 0:
                failures.append(f"{rel} does not compile: {proc.stderr.strip()}")
        for rel in [
            "tools/HME/scripts/sync-codex-settings.py",
            "tools/HME/scripts/audit-codex-settings.py",
            "tools/HME/scripts/codex_settings.py",
        ]:
            target = os.path.join(_PROJECT, rel)
            if not os.path.isfile(target):
                failures.append(f"{rel} missing")
                continue
            proc = subprocess.run(
                ["python3", "-m", "py_compile", target],
                capture_output=True,
                text=True,
                timeout=20,
                env={**os.environ, "PROJECT_ROOT": _PROJECT},
            )
            if proc.returncode != 0:
                failures.append(f"{rel} does not compile: {proc.stderr.strip()}")
        hooks_json = os.path.join(_PROJECT, "tools", "HME", "hooks", "codex_hooks.json")
        try:
            hooks_doc = json.load(open(hooks_json, encoding="utf-8"))
            hooks = hooks_doc.get("hooks", {})
            for event in ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "Stop"]:
                groups = hooks.get(event)
                if not groups:
                    failures.append(f"codex_hooks.json missing {event}")
                    continue
                if "codex_adapter.js" not in json.dumps(groups):
                    failures.append(f"codex_hooks.json {event} does not route through codex_adapter.js")
        except Exception as e:
            failures.append(f"codex_hooks.json invalid: {e}")
        try:
            services = json.load(open(os.path.join(_PROJECT, "tools", "HME", "config", "services.json"), encoding="utf-8")).get("services", [])
            if not any(s.get("id") == "codex_proxy" for s in services if isinstance(s, dict)):
                failures.append("services.json missing codex_proxy")
        except Exception as e:
            failures.append(f"services.json unreadable for codex_proxy check: {e}")
        codex_proxy_cfg = os.path.join(_PROJECT, "tools", "HME", "config", "codex-proxy.json")
        if not os.path.isfile(codex_proxy_cfg):
            failures.append("tools/HME/config/codex-proxy.json missing")
        try:
            sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "service"))
            from server.tools_analysis.todo_sources import TODO_SOURCES
            if "codex_plan" not in TODO_SOURCES:
                failures.append("todo_sources.py missing codex_plan source")
            elif not TODO_SOURCES["codex_plan"].get("preserve_in_native_merge"):
                failures.append("codex_plan source is not preserved across native TodoWrite merges")
        except Exception as e:
            failures.append(f"todo source registry check errored: {e}")
        todo_md = os.path.join(_PROJECT, "doc", "templates", "TODO.md")
        try:
            text = open(todo_md, encoding="utf-8").read()
            if "Native TodoWrite syncs this file" in text:
                failures.append("TODO.md still claims only native TodoWrite syncs it")
        except OSError as e:
            failures.append(f"TODO.md unreadable: {e}")
        admin_path = os.path.join(_SERVER_DIR, "tools_analysis", "evolution", "evolution_admin.py")
        try:
            admin_text = open(admin_path, encoding="utf-8").read()
            if "todo_sync_codex" in admin_text:
                failures.append("hme_admin still advertises manual todo_sync_codex; Codex plan sync must be automatic")
        except OSError as e:
            failures.append(f"evolution_admin.py unreadable: {e}")
        pulse_tick = os.path.join(_PROJECT, "tools", "HME", "activity", "universal_pulse_tick.py")
        pulse_cfg = os.path.join(_PROJECT, "tools", "HME", "config", "universal_pulse.json")
        try:
            tick_text = open(pulse_tick, encoding="utf-8").read()
            if "sync_latest_codex_plan" not in tick_text:
                failures.append("universal_pulse_tick.py does not sync Codex plans")
        except OSError as e:
            failures.append(f"universal_pulse_tick.py unreadable: {e}")
        try:
            with open(pulse_cfg, encoding="utf-8") as f:
                cfg = json.load(f)
            if not cfg.get("codex_plan_sync", {}).get("enabled", False):
                failures.append("universal_pulse.json does not enable codex_plan_sync")
        except Exception as e:
            failures.append(f"universal_pulse.json codex sync config unreadable: {e}")
        if failures:
            return failed(summary=f"{len(failures)} Codex TODO sync issue(s)", details=failures)
        return passed(summary="Codex update_plan sync has proxy, hook adapter, and pulse automatic paths")


@register
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
        rules_path = os.path.join(_PROJECT, "tools", "HME", "config", "forbidden-refs.json")
        try:
            with open(rules_path, encoding="utf-8") as f:
                rules = json.load(f).get("rules", [])
        except Exception as e:
            failures.append(f"forbidden refs registry unreadable: {e}")
            rules = []
        for rule in rules:
            if not isinstance(rule, dict):
                failures.append("forbidden refs rule is not an object")
                continue
            for rel in rule.get("paths", []):
                path = os.path.join(_PROJECT, rel)
                try:
                    text = open(path, encoding="utf-8").read()
                except OSError as e:
                    failures.append(f"{rel} unreadable: {e}")
                    continue
                for needle in rule.get("forbidden", []):
                    if needle in text:
                        failures.append(f"{rel} still references {needle!r} ({rule.get('id', 'unnamed')})")
        if failures:
            return failed(summary=f"{len(failures)} onboarding/TODO coupling issue(s)", details=failures[:12])
        return passed(summary="onboarding state is separate from persistent TODO storage")


@register
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
                    for key in (
                        "archive_id", "archived", "set_name", "archive_path",
                        "task_count", "done_count", "todo_count", "content_sha256",
                    ):
                        if key not in item:
                            index_failures.append(f"archives[{i}] missing {key}")
        except Exception as e:
            index_failures.append(f"archive index unreadable: {e}")
        if not os.path.isdir(devlog):
            if index_failures:
                return failed(summary="TODO archive index invalid", details=index_failures)
            return passed(summary="archive index valid; no local devlog directory")
        try:
            sys.path.insert(0, os.path.join(_PROJECT, "tools", "HME", "service"))
            from server.tools_analysis.todo_archive import validate_archive_text
        except Exception as e:
            return errored(summary=f"archive validator import failed: {e}")
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
            return failed(summary=f"{len(failures)} TODO archive contract violation(s)", details=failures[:10])
        suffix = f"; {legacy} legacy TODO archive(s) skipped" if legacy else ""
        return passed(summary=f"{checked} current TODO archive(s) match contract{suffix}")
