"""TODO administration helpers for hme_admin."""

def hme_todo_admin(action: str, set_name: str = "") -> str:
    from collections import Counter
    import json as _json
    from paths import todo_archive_index_file as _archive_index_file
    from ..todo_md_sync import repair_todo_md_from_store
    from ..todo_archive import _archive_set
    from ..todo_store import flat_entries, load_store, repair_store, save_todos, validate_store

    _raw, meta, todos = load_store()
    entries = flat_entries(todos)
    stale_onboarding = [
        e for e in entries
        if e.get("source") == "onboarding" or "HME onboarding walkthrough" in str(e.get("text", ""))
    ]

    def _archive_index_status() -> tuple[str, list[str]]:
        path = _archive_index_file()
        with open(path, encoding="utf-8") as f:
            index = _json.load(f)
        archives = index.get("archives")
        if not isinstance(archives, list):
            return "invalid", ["archives must be a list"]
        missing = []
        for i, item in enumerate(archives):
            if not isinstance(item, dict):
                missing.append(f"archives[{i}] is not an object")
                continue
            for key in (
                "archive_id", "archived", "set_name", "archive_path",
                "task_count", "done_count", "todo_count", "content_sha256",
            ):
                if key not in item:
                    missing.append(f"archives[{i}] missing {key}")
        last = archives[-1].get("archive_path") if archives else "none"
        return f"{len(archives)} archive record(s), latest={last}", missing

    if action == "todo_status":
        by_source = Counter(str(e.get("source") or "unknown") for e in entries)
        open_count = sum(1 for e in entries if e.get("status") != "completed" and not e.get("done"))
        done_count = len(entries) - open_count
        try:
            archive_status, archive_issues = _archive_index_status()
        except Exception as e:
            archive_status, archive_issues = f"unreadable: {type(e).__name__}: {e}", []
        stale_line = f"{len(stale_onboarding)} stale onboarding mirror entry(s)"
        issue_line = f"\nArchive index issues: {'; '.join(archive_issues)}" if archive_issues else ""
        return (
            "TODO status\n"
            f"- store entries: {len(entries)} ({open_count} open, {done_count} done)\n"
            f"- sources: {dict(sorted(by_source.items()))}\n"
            f"- stale onboarding mirrors: {stale_line}\n"
            f"- archive index: {archive_status}{issue_line}"
        )

    if action == "todo_validate":
        result = repair_todo_md_from_store(write=False)
        try:
            archive_status, archive_issues = _archive_index_status()
        except Exception as e:
            archive_status, archive_issues = f"unreadable: {type(e).__name__}: {e}", [str(e)]
        issues = []
        issues.extend(validate_store())
        if result["changed"]:
            issues.append("TODO.md differs from todos.json render")
        if stale_onboarding:
            issues.append(f"{len(stale_onboarding)} stale onboarding mirror entry(s)")
        issues.extend(archive_issues)
        if issues:
            return "TODO validation FAIL\n- " + "\n- ".join(issues) + f"\nArchive index: {archive_status}"
        return f"TODO validation PASS\nArchive index: {archive_status}"

    if action == "todo_repair":
        store_repair = repair_store()
        if stale_onboarding:
            _raw, meta, todos = load_store()
            stale_ids = {id(e) for e in stale_onboarding}
            removed = 0
            cleaned = []
            for t in todos:
                if id(t) in stale_ids:
                    removed += 1
                    continue
                subs = t.get("subs", [])
                if subs:
                    kept_subs = [s for s in subs if id(s) not in stale_ids]
                    removed += len(subs) - len(kept_subs)
                    t["subs"] = kept_subs
                cleaned.append(t)
            save_todos(meta, cleaned)
        else:
            removed = 0
        result = repair_todo_md_from_store()
        state = "changed" if result["changed"] else "already synced"
        return (
            "TODO repair complete\n"
            f"- store normalized: {store_repair['changed']} ({store_repair['entry_count']} entries, {store_repair['removed']} retired/invalid removed)\n"
            f"- stale onboarding mirrors removed: {removed}\n"
            f"- TODO.md: {state} ({result['todo_count']} top-level todo(s))"
        )

    if action == "todo_archive":
        archive_result = _archive_set(set_name=set_name, force=True)
        if archive_result["ok"]:
            return (
                "TODO archive complete\n"
                f"- devlog: {archive_result['devlog_path']}\n"
                "- TODO.md reset to fresh slate"
            )
        return f"TODO archive refused: {archive_result.get('message', 'unknown error')}"

    return f"Unknown TODO admin action: {action}"
