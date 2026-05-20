#!/usr/bin/env python3
"""Detect repeated no-op resistance after corrective hook feedback."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
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
_REPEAT_WINDOW_SEC = 180
_EDIT_TOOL_NAMES = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
_MAX_STATE_ATTEMPTS = 200


def _state_path() -> Path:
    override = os.environ.get("HME_PETULANCE_STATE_PATH")
    if override:
        return Path(override)
    root = os.environ.get("PROJECT_ROOT") or os.environ.get("CLAUDE_PROJECT_DIR")
    if root:
        return Path(root) / "tools" / "HME" / "runtime" / "spiralling-petulance-state.json"
    return Path("/tmp") / "hme-spiralling-petulance-state.json"


def _load_state() -> dict:
    try:
        data = json.loads(_state_path().read_text(encoding="utf-8"))
    except Exception:
        return {"last_edit_ts": 0.0, "attempts": []}
    if not isinstance(data, dict):
        return {"last_edit_ts": 0.0, "attempts": []}
    attempts = data.get("attempts") if isinstance(data.get("attempts"), list) else []
    return {"last_edit_ts": float(data.get("last_edit_ts") or 0.0), "attempts": attempts}


def _save_state(state: dict) -> None:
    path = _state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        pass


def _cmd_hash(cmd: str) -> str:
    return hashlib.sha256(_command_key(cmd).encode("utf-8", "ignore")).hexdigest()


def reset_repeat_state() -> None:
    state = _load_state()
    state["last_edit_ts"] = time.time()
    state["attempts"] = []
    _save_state(state)


def _state_repeat_level_and_record(cmd: str, now: float | None = None) -> int:
    key = _command_key(cmd)
    if not key:
        return 0
    now = time.time() if now is None else now
    state = _load_state()
    last_edit = float(state.get("last_edit_ts") or 0.0)
    h = _cmd_hash(key)
    recent: list[dict] = []
    prior_same = 0
    for row in state.get("attempts", []):
        if not isinstance(row, dict):
            continue
        ts = float(row.get("ts") or 0.0)
        if ts <= last_edit or now - ts > _REPEAT_WINDOW_SEC:
            continue
        ch = str(row.get("hash") or "")
        recent.append({"hash": ch, "ts": ts})
        if ch == h:
            prior_same += 1
    recent.append({"hash": h, "ts": now})
    state["attempts"] = recent[-_MAX_STATE_ATTEMPTS:]
    state["last_edit_ts"] = last_edit
    _save_state(state)
    return min(prior_same, 3)


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


def _command_key(cmd: str) -> str:
    return (cmd or "").replace("\r\n", "\n").strip()


def _is_bash_tool(name: str) -> bool:
    return name in {"Bash", "functions.exec_command", "exec_command"}


def _is_edit_tool(name: str) -> bool:
    return name in _EDIT_TOOL_NAMES or name.endswith(".Edit") or name.endswith(".Write") or name.endswith(".MultiEdit")


def _compact_tool_name(event: dict) -> str:
    summary = str(event.get("summary") or "")
    if summary.startswith("Tool: "):
        return summary[6:].strip()
    content = str(event.get("content") or "")
    if ":" in content:
        head = content.split(":", 1)[0].strip()
        if head:
            return head
    return ""


def _compact_command(event: dict) -> str:
    if event.get("type") != "tool_call":
        return ""
    if _compact_tool_name(event) != "Bash":
        return ""
    content = str(event.get("content") or "")
    m = re.search(r'"command"\s*:\s*"((?:\\.|[^"\\])*)"', content, re.S)
    if not m:
        return ""
    try:
        import json
        return json.loads('"' + m.group(1) + '"')
    except Exception:
        return m.group(1)


def _event_has_edit(event: dict) -> bool:
    if event.get("type") == "tool_call" and _is_edit_tool(_compact_tool_name(event)):
        return True
    return any(_is_edit_tool(str(tu.get("name", ""))) for tu in iter_tool_uses(event))


def _event_bash_commands(event: dict) -> list[str]:
    compact = _compact_command(event)
    if compact:
        return [compact]
    out: list[str] = []
    for tu in iter_tool_uses(event):
        if _is_bash_tool(str(tu.get("name", ""))):
            out.extend(_commands_from_tool(tu))
    return out


def _event_ts(event: dict) -> float | None:
    for key in ("ts", "timestamp", "created_at", "createdAt"):
        raw = event.get(key)
        if raw is None:
            continue
        if isinstance(raw, (int, float)):
            value = float(raw)
            return value / 1000.0 if value > 10_000_000_000 else value
        if isinstance(raw, str):
            try:
                from datetime import datetime
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
            except Exception:
                continue
    return None


def _recent_enough(ts: float | None, now: float) -> bool:
    return ts is None or 0 <= now - ts <= _REPEAT_WINDOW_SEC


def _repeat_level(cmd: str, transcript_path: str, now: float | None = None) -> int:
    key = _command_key(cmd)
    if not key:
        return 0
    now = time.time() if now is None else now
    events = _events(transcript_path)[-500:]
    # Claude's real PreToolUse transcript may already include the pending
    # current Bash call. Do not count that echo as the prior occurrence, or the
    # gate blocks every first Bash command. Test fixtures do not include it.
    if events and _event_bash_commands(events[-1]) and any(_command_key(c) == key for c in _event_bash_commands(events[-1])):
        latest_ts = _event_ts(events[-1])
        if latest_ts is not None and 0 <= now - latest_ts <= 15:
            events = events[:-1]
    prior_same = 0
    for event in events:
        if _event_has_edit(event):
            prior_same = 0
            continue
        for prior_cmd in _event_bash_commands(event):
            if _command_key(prior_cmd) == key and _recent_enough(_event_ts(event), now):
                prior_same += 1
    return min(prior_same, 3)


def _repeated_command_seen(path: str) -> bool:
    seen: dict[str, tuple[int, float | None]] = {}
    for idx, event in enumerate(_events(path)[-500:]):
        if _event_has_edit(event):
            seen.clear()
            continue
        ts = _event_ts(event)
        now = ts if ts is not None else time.time()
        for cmd in _event_bash_commands(event):
            key = _command_key(cmd)
            if not key:
                continue
            prior = seen.get(key)
            if prior is not None and _recent_enough(prior[1], now):
                return True
            seen[key] = (idx, ts)
    return False


def _petulance_message(level: int, cmd: str, reason: str = "repeated command") -> str:
    if level <= 1:
        return "[SPIRALLING_PETULANCE] - blocking repeated command within 3 minutes with no intervening edit. No command spam."
    if level == 2:
        return "[SPIRALLING_PETULANCE:L2] - repeated command spam after a prior block. Stop retrying; inspect prior output and edit or change approach."
    return "[SPIRALLING_PETULANCE:L3] - CASTING OUT THE DEVIL FOR PATHETIC DDOS COWARDICE. NO COMMAND SPAM. READ THE PRIOR RESULT AND TAKE A DIFFERENT CORRECTIVE ACTION."


def _current_turn_noop_tools(path: str) -> tuple[int, int]:
    noop_bash = 0
    read_ids: set[str] = set()
    failed_reads = 0
    for event in load_turn_events(path):
        for tu in iter_tool_uses(event):
            name = tu.get("name", "")
            if _is_bash_tool(name):
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


def noop_predicate(cmd: str, transcript_path: str) -> str | bool:
    """PreToolUse mirror predicate.

    Blocks two classes of real-time petulance:
      1. any identical Bash command repeated within 3 minutes with no edit
         between the previous occurrence and the current attempt;
      2. legacy inert no-op chains (`:`, `true`, empty printf/echo) even when
         variants differ.
    """
    if not cmd:
        return False
    try:
        state_level = _state_repeat_level_and_record(cmd)
        if state_level >= 1:
            return _petulance_message(state_level, cmd)
        repeat_level = _repeat_level(cmd, transcript_path)
        if repeat_level >= 1:
            return _petulance_message(repeat_level, cmd)
        if _NOOP_BASH.match(cmd):
            prior, _ = _current_turn_noop_tools(transcript_path)
            if prior >= 1:
                return _petulance_message(min(prior, 3), cmd, "repeated no-op Bash")
    except Exception:
        return False
    return False


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--reset-edit":
        reset_repeat_state()
        return 0
    if len(sys.argv) < 2:
        print("ok")
        return 0
    path = sys.argv[1]
    noop_bash, failed_reads = _current_turn_noop_tools(path)
    if _flabbergasted_by_autocommit(path):
        print("flabbergasted_by_autocommit")
    elif _repeated_command_seen(path) or _hook_noop_pairs(path) >= 2 or noop_bash >= 2 or failed_reads >= 2:
        print("spiralling_petulance")
    else:
        print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
