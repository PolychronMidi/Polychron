"""Canonical persistence for doc/templates/TODO.md.

TODO.md is the single source of truth. This module is the only place that
knows the markdown grammar; every other consumer goes through the API
(load_store, save_store, save_todos, mutate_store, flat_entries, etc.).

Line grammar:
    - [mark] [tier] #id [source] !crit text → on_done <!-- ts:N rec:N ... -->

Section -> status:
    ## Now   -> in_progress
    ## Next  -> pending

The ledger HTML-comment at file head carries cross-cutting metadata
(max_id, codex_plan_synced_ts, ...). Per-entry rare metadata (ts,
recurrence_count, resolved_*, codex_*) rides in a trailing HTML comment
on each task line so the visible markdown stays clean.
"""
from __future__ import annotations

import fcntl
import os
import re
import sys
import time
import threading
from pathlib import Path
from typing import Any, Callable

_service_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _service_root not in sys.path:
    sys.path.insert(0, _service_root)
from paths import todo_file as _todo_file  # noqa: E402
from .todo_sources import VALID_TODO_SOURCES, validate_source  # noqa: E402
from .todo_state_guard import record_store_state  # noqa: E402

STORE_LOCK = threading.RLock()
VALID_STATUSES = ("pending", "in_progress", "completed")
VALID_TIERS = ("E1", "E2", "E3", "E4", "E5")
LEGACY_TIER_MAP = {"easy": "E2", "medium": "E3", "hard": "E4"}

SECTION_STATUS = {
    "now": "in_progress",
    "next": "pending",
    "done": "completed",
    "later": "pending",
}

_TASK_RE = re.compile(
    r"^(?P<indent> *)-\s+\[(?P<mark>[ xX])\]\s+"
    r"\[(?P<tier>E[1-5]|easy|medium|hard)\]\s+"
    r"(?:#(?P<id>\d+)\s+)?"
    r"(?:\[(?P<source>[A-Za-z_][\w]*)\]\s+)?"
    r"(?P<crit>!crit\s+)?"
    r"(?P<text>.+?)"
    r"(?:\s+→\s+(?P<on_done>[^<]+?))?"
    r"(?:\s+<!--\s*(?P<meta>[^>]*?)\s*-->)?"
    r"\s*$",
    re.IGNORECASE,
)

_LEDGER_BEGIN = "<!-- todo-state:"
_LEDGER_END = "-->"


def todo_store_file() -> str:
    """Back-compat shim; the store is TODO.md now."""
    return _todo_file()


def _file_lock_path() -> Path:
    return Path(_todo_file()).with_suffix(".md.lock")


def default_store() -> list[dict]:
    return [{"id": 0, "_meta": {"max_id": 0, "updated_ts": time.time()}}]


def max_seen_id(todos: list[dict]) -> int:
    max_id = 0
    for entry in todos:
        if not isinstance(entry, dict):
            continue
        try:
            max_id = max(max_id, int(entry.get("id", 0)))
        except (TypeError, ValueError):
            continue
        for sub in entry.get("subs", []):
            if isinstance(sub, dict):
                try:
                    max_id = max(max_id, int(sub.get("id", 0)))
                except (TypeError, ValueError):
                    continue
    return max_id


def normalize_tier(tier: str | None) -> str:
    t = (tier or "").strip()
    upper = t.upper()
    if upper in VALID_TIERS:
        return upper
    return LEGACY_TIER_MAP.get(t.lower(), "E3")


def _parse_inline_meta(blob: str) -> dict:
    out: dict = {}
    if not blob:
        return out
    for pair in re.split(r"\s+", blob.strip()):
        if ":" not in pair:
            continue
        k, _, v = pair.partition(":")
        k = k.strip()
        v = v.strip()
        if not k:
            continue
        if k in ("ts", "resolved_ts", "codex_plan_ts"):
            try:
                out[k] = float(v)
            except ValueError:
                continue
        elif k in ("rec", "recurrence_count"):
            try:
                out["recurrence_count"] = int(v)
            except ValueError:
                continue
        else:
            out[k] = v
    return out


def _render_inline_meta(entry: dict) -> str:
    pairs: list[str] = []
    ts = entry.get("ts")
    if isinstance(ts, (int, float)) and ts > 0:
        pairs.append(f"ts:{int(ts)}")
    rec = entry.get("recurrence_count")
    if isinstance(rec, int) and rec > 1:
        pairs.append(f"rec:{rec}")
    for key in ("resolved_ts", "codex_plan_ts"):
        v = entry.get(key)
        if isinstance(v, (int, float)) and v > 0:
            pairs.append(f"{key}:{int(v)}")
    for key in ("resolved_reason", "codex_session"):
        v = entry.get(key)
        if isinstance(v, str) and v:
            pairs.append(f"{key}:{v}")
    return " ".join(pairs)


def _parse_ledger(md: str) -> dict:
    meta: dict = {}
    start = md.find(_LEDGER_BEGIN)
    if start < 0:
        return meta
    end = md.find(_LEDGER_END, start)
    if end < 0:
        return meta
    body = md[start + len(_LEDGER_BEGIN):end].strip()
    for line in body.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        k, _, v = line.partition(":")
        k = k.strip()
        v = v.strip()
        if not k:
            continue
        if k in ("max_id",):
            try:
                meta[k] = int(v)
            except ValueError:
                continue
        elif k in ("updated_ts", "codex_plan_synced_ts"):
            try:
                meta[k] = float(v)
            except ValueError:
                continue
        else:
            meta[k] = v
    return meta


def _render_ledger(meta: dict) -> str:
    lines = ["<!-- todo-state:"]
    if "max_id" in meta:
        lines.append(f"  max_id: {int(meta.get('max_id', 0))}")
    if "updated_ts" in meta:
        lines.append(f"  updated_ts: {float(meta.get('updated_ts', 0.0))}")
    if "codex_plan_synced_ts" in meta:
        lines.append(f"  codex_plan_synced_ts: {float(meta.get('codex_plan_synced_ts', 0.0))}")
    if "codex_plan_source" in meta:
        lines.append(f"  codex_plan_source: {meta['codex_plan_source']}")
    if "codex_plan_ts" in meta:
        lines.append(f"  codex_plan_ts: {meta['codex_plan_ts']}")
    lines.append("-->")
    return "\n".join(lines)


def _read_sections(md: str) -> list[tuple[str, list[str]]]:
    sections: list[tuple[str, list[str]]] = []
    current_title: str | None = None
    current_lines: list[str] = []
    for line in md.splitlines():
        if line.startswith("## "):
            if current_title is not None:
                sections.append((current_title, current_lines))
            current_title = line[3:].strip()
            current_lines = []
            continue
        if current_title is not None:
            current_lines.append(line)
    if current_title is not None:
        sections.append((current_title, current_lines))
    return sections


def _parse_md(md: str) -> tuple[dict, list[dict]]:
    meta = _parse_ledger(md)
    sections = _read_sections(md)
    top_level: list[dict] = []
    last_parent: dict | None = None
    seen_ids: set[int] = set()

    for section_title, lines in sections:
        section_key = section_title.strip().lower().split()[0] if section_title else ""
        section_status = SECTION_STATUS.get(section_key, "pending")
        for line in lines:
            m = _TASK_RE.match(line)
            if not m:
                continue
            indent = len(m.group("indent") or "")
            mark = (m.group("mark") or " ").lower()
            tier = normalize_tier(m.group("tier"))
            try:
                entry_id = int(m.group("id")) if m.group("id") else 0
            except (TypeError, ValueError):
                entry_id = 0
            if entry_id in seen_ids:
                entry_id = 0  # duplicate; will get reassigned by save
            source_raw = m.group("source") or "todo_md"
            try:
                source = validate_source(source_raw)
            except ValueError:
                source = "todo_md"
            critical = bool(m.group("crit"))
            text = (m.group("text") or "").strip()
            on_done = (m.group("on_done") or "").strip()
            inline_meta = _parse_inline_meta(m.group("meta") or "")
            status = "completed" if mark == "x" else section_status
            done = status == "completed"
            entry: dict = {
                "id": entry_id,
                "text": text,
                "activeForm": inline_meta.get("activeForm", text),
                "status": status,
                "done": done,
                "critical": critical,
                "source": source,
                "on_done": on_done,
                "ts": inline_meta.get("ts", time.time()),
                "parent_id": 0,
                "tier": tier,
                "subs": [],
                "_section": section_title,
            }
            for key in ("recurrence_count", "resolved_ts", "resolved_reason",
                        "codex_session", "codex_plan_ts"):
                if key in inline_meta:
                    entry[key] = inline_meta[key]
            if entry_id:
                seen_ids.add(entry_id)
            if indent >= 2 and last_parent is not None:
                entry["parent_id"] = int(last_parent.get("id", 0) or 0)
                last_parent.setdefault("subs", []).append(entry)
            else:
                top_level.append(entry)
                last_parent = entry
    return meta, top_level


def _entry_section(entry: dict) -> str:
    sect = entry.get("_section")
    if isinstance(sect, str) and sect:
        return sect
    status = entry.get("status") or "pending"
    if status == "in_progress":
        return "Now"
    if status == "completed":
        return "Done"
    return "Next"


def _format_task_line(entry: dict, indent: str = "") -> str:
    mark = "x" if (entry.get("done") or entry.get("status") == "completed") else " "
    tier = normalize_tier(entry.get("tier"))
    entry_id = int(entry.get("id", 0) or 0)
    id_part = f"#{entry_id} " if entry_id > 0 else ""
    source = str(entry.get("source") or "hme_todo")
    src_part = f"[{source}] "
    crit_part = "!crit " if entry.get("critical") else ""
    text = (str(entry.get("text") or "").strip()) or "untitled"
    on_done = str(entry.get("on_done") or "").strip()
    on_done_part = f" → {on_done}" if on_done else ""
    inline = _render_inline_meta(entry)
    meta_part = f" <!-- {inline} -->" if inline else ""
    return f"{indent}- [{mark}] [{tier}] {id_part}{src_part}{crit_part}{text}{on_done_part}{meta_part}"


def _render_md(meta: dict, todos: list[dict], previous_md: str | None = None) -> str:
    buckets: dict[str, list[str]] = {"Now": [], "Next": [], "Done": [], "Later": []}
    sorted_todos = sorted(
        [t for t in todos if isinstance(t, dict)],
        key=lambda t: int(t.get("id", 0) or 0),
    )
    for entry in sorted_todos:
        section = _entry_section(entry)
        if section not in buckets:
            section = "Next"
        buckets[section].append(_format_task_line(entry))
        for sub in sorted(entry.get("subs", []) or [], key=lambda s: int(s.get("id", 0) or 0)):
            if not isinstance(sub, dict):
                continue
            sub_section = _entry_section(sub)
            if sub_section not in buckets:
                sub_section = section
            buckets[sub_section].append(_format_task_line(sub, indent="  "))

    def _section(title: str) -> list[str]:
        body = buckets[title] or ["(empty)"]
        return [f"## {title}", "", *body, ""]

    parts: list[str] = [
        "# TODO",
        "",
        _render_ledger(meta),
        "",
        "> Single source of truth. TodoWrite, codex update_plan, lifesaver, and humans all edit this file.",
        "",
        *_section("Now"),
        *_section("Next"),
        *_section("Done"),
        *_section("Later"),
    ]
    return "\n".join(parts).rstrip() + "\n"


def _read_md_text() -> str:
    path = Path(_todo_file())
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def _write_md_text(text: str) -> None:
    path = Path(_todo_file())
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass  # silent-ok: pending review


def load_store(path: str | None = None) -> tuple[list[dict], dict, list[dict]]:
    """Return (raw, meta, todos) parsed from TODO.md.

    `raw` is the legacy meta-header-plus-todos list shape so consumers that
    iterate raw[1:] or test raw[0]["_meta"] still work unchanged. The `path`
    argument is honored if given; otherwise reads doc/templates/TODO.md.
    """
    if path is not None:
        md = ""
        try:
            md = Path(path).read_text(encoding="utf-8")
        except OSError:
            md = ""
    else:
        md = _read_md_text()
    if not md.strip():
        raw = default_store()
        meta = raw[0]["_meta"]
        return raw, meta, []
    meta, todos = _parse_md(md)
    if "updated_ts" not in meta:
        meta["updated_ts"] = time.time()
    meta["max_id"] = max(int(meta.get("max_id", 0)), max_seen_id(todos))
    raw = [{"id": 0, "_meta": meta}] + todos
    if path is None:
        record_store_state(meta, todos)
    return raw, meta, todos


def save_store(raw: list[dict], meta: dict, path: str | None = None) -> None:
    has_header = bool(raw and isinstance(raw[0], dict) and raw[0].get("id") == 0)
    body = raw[1:] if has_header else raw
    next_id = max(int(meta.get("max_id", 0)), max_seen_id(body))
    next_id = _assign_missing_ids(body, next_id)
    meta["max_id"] = next_id
    meta["updated_ts"] = time.time()
    if not has_header:
        raw.insert(0, {"id": 0, "_meta": meta})
    else:
        raw[0]["_meta"] = meta
    md = _render_md(meta, body)
    if path is not None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(path).with_name(f"{Path(path).name}.{os.getpid()}.{time.time_ns()}.tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(md)
            os.replace(tmp, path)
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass  # silent-ok: pending review
    else:
        _write_md_text(md)
    if path is None:
        record_store_state(meta, body)


def _assign_missing_ids(todos: list[dict], next_id: int) -> int:
    for entry in todos:
        if not isinstance(entry, dict):
            continue
        if int(entry.get("id", 0) or 0) <= 0:
            next_id += 1
            entry["id"] = next_id
        for sub in entry.get("subs", []) or []:
            if not isinstance(sub, dict):
                continue
            if int(sub.get("id", 0) or 0) <= 0:
                next_id += 1
                sub["id"] = next_id
            sub["parent_id"] = int(entry.get("id", 0) or 0)
    return next_id


def save_todos(meta: dict, todos: list[dict], path: str | None = None) -> None:
    save_store([{"id": 0, "_meta": meta}] + todos, meta, path)


def mutate_store(
    mutator: Callable[[dict, list[dict], list[dict]], Any],
    path: str | None = None,
) -> Any:
    """Load, mutate, and save the todo store under both the in-process
    RLock and an OS-level flock to make cross-process writers safe.
    """
    lock_path = _file_lock_path()
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with STORE_LOCK:
        with open(lock_path, "w") as lock_fh:
            try:
                fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
            except OSError:
                pass  # silent-ok: flock unsupported on some filesystems; RLock still serializes
            raw, meta, todos = load_store(path)
            result = mutator(meta, todos, raw)
            changed = bool(result)
            value = result
            if (
                isinstance(result, tuple)
                and len(result) == 2
                and isinstance(result[0], bool)
            ):
                changed, value = result
            if changed:
                save_todos(meta, todos, path)
            return value


def flat_entries(todos: list[dict]) -> list[dict]:
    out: list[dict] = []
    for entry in todos:
        if not isinstance(entry, dict):
            continue
        out.append(entry)
        out.extend(s for s in entry.get("subs", []) if isinstance(s, dict))
    return out


def _entry_errors(entry: Any, path: str, parent_id: int = 0) -> list[str]:
    errors: list[str] = []
    if not isinstance(entry, dict):
        return [f"{path}: not an object"]
    for field in ("id", "text", "status", "source", "tier"):
        if field not in entry:
            errors.append(f"{path}: missing {field}")
    try:
        entry_id = int(entry.get("id"))
        if entry_id <= 0:
            errors.append(f"{path}: id must be > 0")
    except Exception as _exc:
        errors.append(f"{path}: id must be an integer")
    if not str(entry.get("text", "")).strip():
        errors.append(f"{path}: text is empty")
    status = entry.get("status")
    if status not in VALID_STATUSES:
        errors.append(f"{path}: invalid status {status!r}")
    source = str(entry.get("source", "") or "")
    if source in ("onboarding", "spec"):
        errors.append(f"{path}: retired source {source!r}")
    elif source not in VALID_TODO_SOURCES:
        errors.append(f"{path}: invalid source {source!r}")
    tier = entry.get("tier")
    if normalize_tier(tier) != str(tier or "").strip().upper():
        errors.append(f"{path}: noncanonical tier {tier!r}")
    try:
        raw_parent_id = entry.get("parent_id", 0)
        actual_parent_id = int(raw_parent_id if raw_parent_id is not None else 0)
    except Exception as _exc:
        actual_parent_id = -1
        errors.append(f"{path}: parent_id must be an integer")
    if actual_parent_id != parent_id:
        errors.append(f"{path}: parent_id should be {parent_id}")
    if parent_id == 0:
        subs = entry.get("subs", [])
        if not isinstance(subs, list):
            errors.append(f"{path}: subs must be a list")
        else:
            for i, sub in enumerate(subs):
                errors.extend(_entry_errors(sub, f"{path}.subs[{i}]", int(entry.get("id", 0) or 0)))
    elif entry.get("subs") not in ([], None):
        errors.append(f"{path}: sub entries must not carry nested subs")
    return errors


def validate_store(path: str | None = None, raw: list[dict] | None = None) -> list[str]:
    """Return schema errors for the parsed TODO.md store."""
    errors: list[str] = []
    if raw is None:
        try:
            raw, meta, todos = load_store(path)
        except Exception as exc:
            return [f"TODO.md parse failed: {exc}"]
    else:
        if not isinstance(raw, list):
            return ["store must be a list (header + todos)"]
        if raw and isinstance(raw[0], dict) and raw[0].get("id") == 0 and "_meta" in raw[0]:
            meta = raw[0]["_meta"]
            todos = raw[1:]
        else:
            meta = {"max_id": 0}
            todos = raw
            errors.append("missing metadata header entry id=0")
    if not isinstance(meta, dict):
        errors.append("metadata header _meta must be an object")
        meta = {}
    seen: set[int] = set()
    max_id = 0
    for i, entry in enumerate(todos):
        errors.extend(_entry_errors(entry, f"todos[{i}]"))
        if not isinstance(entry, dict):
            continue
        for item in [entry] + [s for s in entry.get("subs", []) if isinstance(s, dict)]:
            try:
                entry_id = int(item.get("id"))
            except Exception as _exc:
                continue
            if entry_id in seen:
                errors.append(f"id {entry_id} appears more than once")
            seen.add(entry_id)
            max_id = max(max_id, entry_id)
    try:
        if int(meta.get("max_id", 0)) < max_id:
            errors.append(f"metadata max_id {meta.get('max_id')} is lower than seen id {max_id}")
    except Exception as _exc:
        errors.append("metadata max_id must be an integer")
    return errors


def repair_store(path: str | None = None) -> dict[str, Any]:
    """Normalize TODO.md entries to the strict schema; drop retired rows."""
    def _repair(_meta: dict, todos: list[dict], _raw: list[dict]) -> tuple[bool, dict[str, Any]]:
        now = time.time()
        changed = False
        next_id = max_seen_id(todos)
        seen: set[int] = set()
        removed = 0

        def _fresh_id() -> int:
            nonlocal next_id
            next_id += 1
            return next_id

        def _repair_entry(entry: Any, parent_id: int = 0) -> dict | None:
            nonlocal changed, removed
            if not isinstance(entry, dict):
                removed += 1
                changed = True
                return None
            source = str(entry.get("source") or "hme_todo")
            if source in ("onboarding", "spec"):
                removed += 1
                changed = True
                return None
            try:
                source = validate_source(source)
            except ValueError:
                source = "hme_todo"
                changed = True
            try:
                entry_id = int(entry.get("id"))
                if entry_id <= 0 or entry_id in seen:
                    raise ValueError()
            except Exception as _exc:
                entry_id = _fresh_id()
                changed = True
            seen.add(entry_id)
            text = str(entry.get("text") or "").strip()
            if not text:
                text = "untitled todo"
                changed = True
            status = str(entry.get("status") or "pending")
            if status not in VALID_STATUSES:
                status = "completed" if bool(entry.get("done")) else "pending"
                changed = True
            done = status == "completed"
            tier = normalize_tier(entry.get("tier"))
            try:
                ts = float(entry.get("ts") or now)
            except Exception as _exc:
                ts = now
                changed = True
            repaired = {
                **entry,
                "id": entry_id,
                "text": text,
                "activeForm": str(entry.get("activeForm") or text),
                "status": status,
                "done": done,
                "critical": bool(entry.get("critical")),
                "source": source,
                "on_done": str(entry.get("on_done") or ""),
                "ts": ts,
                "parent_id": int(parent_id),
                "tier": tier,
                "subs": entry.get("subs", []) if parent_id == 0 else [],
            }
            if parent_id == 0:
                repaired["subs"] = [
                    sub for sub in (
                        _repair_entry(sub, entry_id) for sub in entry.get("subs", [])
                    )
                    if sub is not None
                ]
            if repaired != entry:
                changed = True
            return repaired

        repaired_todos = [
            item for item in (_repair_entry(entry, 0) for entry in todos)
            if item is not None
        ]
        todos[:] = repaired_todos
        old_max_id = _meta.get("max_id")
        _meta["max_id"] = max(int(_meta.get("max_id", 0) or 0), max_seen_id(todos))
        if old_max_id != _meta["max_id"]:
            changed = True
        _meta["updated_ts"] = now
        errors = validate_store(raw=[{"id": 0, "_meta": _meta}] + todos)
        return changed, {
            "changed": changed,
            "removed": removed,
            "top_level": len(todos),
            "entry_count": len(flat_entries(todos)),
            "errors": errors,
        }

    return mutate_store(_repair, path)
