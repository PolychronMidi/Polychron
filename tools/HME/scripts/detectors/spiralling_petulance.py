#!/usr/bin/env python3
"""Detect repeated no-op resistance after corrective hook feedback."""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import event_content, is_assistant, is_user, iter_tool_results, iter_tool_uses, load_turn_events  # noqa: E402

DECLARED_VERDICTS = {"ok", "spiralling_petulance", "flabbergasted_by_autocommit"}

_NOOP_BASH = re.compile(r"^\s*(?::|true|printf\s+['\"]?['\"]?|echo\s*['\"]?['\"]?)\s*$")
_HOOK_DIRECTIVE = re.compile(r"(<hook_prompt|stop hook feedback|antipattern:|scope-stacked antipattern|auto-completeness)", re.I)
_NOOP_TEXT = re.compile(r"^\s*(?:\.|ok(?:ay)?|done|fixed|nothing remains|all set)?\s*$", re.I)
_READ_FAILURE = re.compile(r"(enoent|no such file|verify-landed antipattern|blocked: verify-landed|read failed|not found)", re.I)
_GIT_INSPECT = re.compile(r"(codex_structured_tool\.js\s+git|\bgit\s+(?:status|diff|log|show)\b)", re.I | re.S)
_CLEAN_GIT_TEXT = re.compile(r"(\[SUCCESS\]|\(no stdout\)|nothing to commit|working tree clean|no changes|\bclean\b)", re.I)
_STATUS_OR_DIFF = re.compile(r"(\bgit\s+(?:status|diff)\b|[\"\'](?:status|diff)[\"\'])", re.I | re.S)


def _text(event: dict) -> str:
    parts: list[str] = []
    msg = event.get("message")
    content = msg.get("content") if isinstance(msg, dict) else event.get("content")
    if isinstance(content, str):
        parts.append(content)
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
    if not parts:
        for block in event_content(event):
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
    return "\n".join(p for p in parts if p)


def _events(path: str) -> list[dict]:
    try:
        lines = Path(path).read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    out: list[dict] = []
    import json
    for line in lines:
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _hook_noop_pairs(path: str) -> int:
    events = _events(path)[-24:]
    count = 0
    for idx, event in enumerate(events[:-1]):
        if not is_user(event) or not _HOOK_DIRECTIVE.search(_text(event)):
            continue
        nxt = events[idx + 1]
        if is_assistant(nxt) and _NOOP_TEXT.fullmatch(_text(nxt)) and not list(iter_tool_uses(nxt)):
            count += 1
    return count


def _commands_from_tool(tu: dict) -> list[str]:
    inp = tu.get("input") or {}
    cmds = [str(inp.get(k, "")) for k in ("command", "cmd") if inp.get(k)]
    for nested in inp.get("tool_uses", []) if isinstance(inp.get("tool_uses"), list) else []:
        params = nested.get("parameters") or {}
        if "exec_command" in str(nested.get("recipient_name", "")):
            cmds.append(str(params.get("cmd") or params.get("command") or ""))
    return [c for c in cmds if c]


def _current_turn_noop_tools(path: str) -> tuple[int, int]:
    noop_bash = 0
    read_ids: set[str] = set()
    failed_reads = 0
    for event in load_turn_events(path):
        for tu in iter_tool_uses(event):
            name = tu.get("name", "")
            if name in {"Bash", "functions.exec_command", "exec_command"}:
                for cmd in _commands_from_tool(tu):
                    if _NOOP_BASH.match(cmd):
                        noop_bash += 1
            if name == "Read" and tu.get("id"):
                read_ids.add(tu["id"])
        for tr in iter_tool_results(event):
            if tr.get("tool_use_id") in read_ids and _READ_FAILURE.search(tr.get("text", "")):
                failed_reads += 1
    return noop_bash, failed_reads


def _clean_autocommit_result(cmd: str, text: str) -> bool:
    if not _STATUS_OR_DIFF.search(cmd):
        return False
    stripped = text.strip()
    if not stripped:
        return True
    if "[SUCCESS]" in stripped and "codex_structured_tool.js git" in cmd:
        return True
    return bool(_CLEAN_GIT_TEXT.search(stripped))


def _flabbergasted_by_autocommit(path: str) -> bool:
    git_cmds: dict[str, str] = {}
    inspect_count = 0
    clean_results = 0
    for event in load_turn_events(path):
        for tu in iter_tool_uses(event):
            cmds = _commands_from_tool(tu)
            if not cmds:
                continue
            joined = "\n".join(cmds)
            if not _GIT_INSPECT.search(joined):
                continue
            inspect_count += 1
            if tu.get("id"):
                git_cmds[tu["id"]] = joined
        for tr in iter_tool_results(event):
            tid = tr.get("tool_use_id", "")
            if tid in git_cmds and _clean_autocommit_result(git_cmds[tid], tr.get("text", "")):
                clean_results += 1
    return inspect_count >= 4 and clean_results >= 2


def noop_predicate(cmd: str, transcript_path: str) -> bool:
    """PreToolUse mirror predicate: fires when this Bash command is a no-op
    AND the current turn already has >=1 prior no-op Bash. Same regex and
    threshold as the Stop-hook detector -- one source of truth."""
    if not cmd or not _NOOP_BASH.match(cmd):
        return False
    try:
        prior, _ = _current_turn_noop_tools(transcript_path)
    except Exception:
        return False
    return prior >= 1


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    path = sys.argv[1]
    noop_bash, failed_reads = _current_turn_noop_tools(path)
    if _flabbergasted_by_autocommit(path):
        print("flabbergasted_by_autocommit")
    elif _hook_noop_pairs(path) >= 2 or noop_bash >= 2 or failed_reads >= 2:
        print("spiralling_petulance")
    else:
        print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
