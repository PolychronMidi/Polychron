"""Shared-state ownership registry loader."""
from __future__ import annotations

import os
import shlex
from pathlib import Path
from typing import Any

from jsonc import load_jsonc


PROJECT_ROOT = Path(
    os.environ.get("PROJECT_ROOT")
    or os.environ.get("CLAUDE_PROJECT_DIR")
    or Path(__file__).resolve().parents[3]
)
REGISTRY_PATH = PROJECT_ROOT / "tools" / "HME" / "config" / "state-files.json"
REQUIRED_ENTRY_FIELDS = {
    "path", "owner", "readers", "writers", "retention", "generated",
    "committed", "schema", "repair",
}


def load_state_registry(root: Path | None = None) -> dict[str, Any]:
    path = (root or PROJECT_ROOT) / "tools" / "HME" / "config" / "state-files.json"
    data = load_jsonc(path)
    if not isinstance(data.get("single_owner", []), list):
        raise ValueError(f"{path}: single_owner must be a list")
    if not isinstance(data.get("multi_writer", []), list):
        raise ValueError(f"{path}: multi_writer must be a list")
    for section in ("single_owner", "multi_writer"):
        for idx, entry in enumerate(data.get(section, [])):
            missing = sorted(REQUIRED_ENTRY_FIELDS - set(entry))
            if missing:
                raise ValueError(f"{path}: {section}[{idx}] missing required fields: {', '.join(missing)}")
            if not isinstance(entry.get("readers"), list) or not isinstance(entry.get("writers"), list):
                raise ValueError(f"{path}: {section}[{idx}] readers/writers must be lists")
            if not isinstance(entry.get("generated"), bool) or not isinstance(entry.get("committed"), bool):
                raise ValueError(f"{path}: {section}[{idx}] generated/committed must be booleans")
    return data


def ownership_map(root: Path | None = None) -> dict[str, set[str]]:
    data = load_state_registry(root)
    out: dict[str, set[str]] = {}
    for entry in data.get("single_owner", []):
        path = str(entry.get("path", "")).strip()
        owner = str(entry.get("owner", "")).strip()
        if path and owner:
            out.setdefault(path, set()).add(owner)
    for entry in data.get("multi_writer", []):
        path = str(entry.get("path", "")).strip()
        writers = entry.get("writers", [])
        if path and isinstance(writers, list):
            out.setdefault(path, set()).update(str(w).strip() for w in writers if str(w).strip())
    return out


def iter_entries(root: Path | None = None) -> list[dict[str, Any]]:
    data = load_state_registry(root)
    entries: list[dict[str, Any]] = []
    for section in ("single_owner", "multi_writer"):
        for entry in data.get(section, []):
            item = dict(entry)
            item["section"] = section
            entries.append(item)
    return entries


def registry_doc_summary(root: Path | None = None) -> str:
    entries = iter_entries(root)
    single = [e for e in entries if e["section"] == "single_owner"]
    multi = [e for e in entries if e["section"] == "multi_writer"]
    committed = sum(1 for e in entries if e.get("committed"))
    generated = sum(1 for e in entries if e.get("generated"))
    lines = [
        "<!-- BEGIN GENERATED STATE REGISTRY -->",
        f"- Registered state paths: {len(entries)} ({len(single)} single-owner, {len(multi)} multi-writer).",
        f"- Generated state: {generated}; committed state: {committed}.",
        "- Repair commands and reader/writer ownership live in `tools/HME/config/state-files.json`.",
    ]
    if multi:
        lines.append("- Multi-writer paths:")
        for entry in sorted(multi, key=lambda e: str(e.get("path", ""))):
            writers = [str(w) for w in entry.get("writers", [])]
            shown = ", ".join(writers[:3])
            suffix = f" (+{len(writers) - 3} more)" if len(writers) > 3 else ""
            lines.append(f"  - `{entry.get('path')}` -- {len(writers)} writer(s): {shown}{suffix}")
    lines.append("<!-- END GENERATED STATE REGISTRY -->")
    return "\n".join(lines)


def repair_command_issues(root: Path | None = None) -> list[str]:
    root = root or PROJECT_ROOT
    issues: list[str] = []
    for entry in iter_entries(root):
        repair = str(entry.get("repair") or "").strip()
        if not repair:
            issues.append(f"{entry.get('path')}: missing repair command")
            continue
        try:
            parts = shlex.split(repair)
        except ValueError as e:
            issues.append(f"{entry.get('path')}: repair command does not parse: {e}")
            continue
        if not parts:
            issues.append(f"{entry.get('path')}: missing repair command")
            continue
        if parts[0] in {"run", "bash", "python", "python3", "node"} and len(parts) > 1:
            candidate = Path(parts[1])
        else:
            candidate = Path(parts[0])
        if str(candidate).startswith("-"):
            continue
        if candidate.suffix and not candidate.is_absolute():
            full = root / candidate
            if not full.exists():
                issues.append(f"{entry.get('path')}: repair command target missing: {candidate}")
    return issues


def unregistered_state_candidates(root: Path | None = None) -> list[str]:
    root = root or PROJECT_ROOT
    registered = {str(e.get("path", "")) for e in iter_entries(root)}
    scan_roots = [root / "tools" / "HME" / "runtime", root / "log", root / "output" / "metrics"]
    candidates: list[str] = []
    for scan_root in scan_roots:
        if not scan_root.exists():
            continue
        for path in scan_root.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()
            if rel in registered or any(rel.startswith(p.rstrip("*")) for p in registered if "*" in p):
                continue
            if path.name.endswith((".pyc", ".tmp")):
                continue
            candidates.append(rel)
    return sorted(candidates)
