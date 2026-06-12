#!/usr/bin/env python3
"""Block final mesh-consult reporting before required final artifacts are read.

A mesh consultation is complete only after the runner emits _consult-complete.json
and the agent reads every file listed in must_read_before_report. Progress stdout
or task-completion notifications are not proof of peer content.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import event_content, is_assistant, iter_tool_uses, load_full_turn_with_user  # noqa: E402

DECLARED_VERDICTS = {"ok", "consult_premature_report"}
CONSULT_WORD_RE = re.compile(r"\b(mesh|consult|consultation|peer|red_final|blue_final|final_synth|round)\b", re.I)
REPORT_WORD_RE = re.compile(r"\b(done|complete|converged|conclusion|verdict|synthesis|final|mesh heard|mesh said|vote|rank)\b", re.I)
READ_NAME_RE = re.compile(r"""(?:^|/)teams/runtime/output/([^/]+)/([^/\s`'"]+\.json)\b""")
COMPLETE_RE = re.compile(r"(?:^|/)teams/runtime/output/([^/]+)/_consult-complete\.json\b")


def _assistant_texts(events: list[dict]) -> list[str]:
    out: list[str] = []
    for ev in events:
        if not is_assistant(ev):
            continue
        parts: list[str] = []
        for b in event_content(ev):
            if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str):
                parts.append(b["text"])
        if parts:
            out.append("\n".join(parts))
    return out


def _read_paths(events: list[dict]) -> set[str]:
    paths: set[str] = set()
    for ev in events:
        if not is_assistant(ev):
            continue
        for tu in iter_tool_uses(ev):
            name = tu.get("name", "")
            inp = tu.get("input", {}) or {}
            if name == "Read" and isinstance(inp, dict):
                p = inp.get("file_path") or inp.get("path") or ""
                if p:
                    paths.add(str(p))
            elif name == "Bash" and isinstance(inp, dict):
                cmd = str(inp.get("command") or "")
                for m in READ_NAME_RE.finditer(cmd):
                    paths.add(f"teams/runtime/output/{m.group(1)}/{m.group(2)}")
                for m in COMPLETE_RE.finditer(cmd):
                    paths.add(f"teams/runtime/output/{m.group(1)}/_consult-complete.json")
    return paths


def _reported_round(text: str) -> str | None:
    for m in re.finditer(r"\b([a-z0-9-]+-consult)\b", text, re.I):
        return m.group(1)
    return None


def _completion(round_name: str) -> dict | None:
    root = Path(__file__).resolve().parents[4]
    p = root / "teams/runtime/output" / round_name / "_consult-complete.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _path_read(required: str, reads: set[str]) -> bool:
    norm = required.lstrip("/")
    return any(r.endswith(norm) or r.lstrip("/") == norm for r in reads)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    events = load_full_turn_with_user(sys.argv[1])
    texts = _assistant_texts(events)
    if not texts:
        print("ok")
        return 0
    final_text = texts[-1]
    if not (CONSULT_WORD_RE.search(final_text) and REPORT_WORD_RE.search(final_text)):
        print("ok")
        return 0
    round_name = _reported_round(final_text)
    if not round_name:
        print("ok")
        return 0
    complete = _completion(round_name)
    if not complete or complete.get("complete") is not True:
        print("consult_premature_report")
        return 0
    reads = _read_paths(events)
    required = [str(p) for p in complete.get("must_read_before_report") or complete.get("final_outputs") or []]
    if required and not all(_path_read(p, reads) for p in required):
        print("consult_premature_report")
        return 0
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
