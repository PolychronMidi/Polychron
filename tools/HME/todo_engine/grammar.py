"""TODO grammar: parse/render the status-code line format (TODO_new.md).

One todo per line. Line shape:
    #<id> <code> <text>[ _q="qualifier"][ <!-- since:EPOCH -->]

Status codes:
    0_     created (default)
    1_     in progress
    2_     revisit; default 10 min, custom via 2_<min> (e.g. 2_60)
    3_     major block (architecture/scope/low-confidence)
    4_     nominally complete, needs follow-up; next line MUST be 4f_
    4f_    follow-up; auto -> 0_ in 30 min, custom via 4f_<min>; optional _q="..."
    5_     completed totally

Timer anchor (`since:EPOCH`) rides in a trailing HTML comment so the visible
markdown stays clean. Only timed codes (2_, 4f_) carry it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

TIMED_CODES = ("2", "4f")
KNOWN_CODES = ("0", "1", "2", "3", "4", "4f", "5")
DEFAULT_MINUTES = {"2": 10, "4f": 30}

_LINE_RE = re.compile(
    r"^\s*#(?P<id>\d+)\s+"
    r"(?P<code>0|1|2|3|4f|4|5)"
    r"(?:_(?P<minutes>\d+))?"
    r"_?\s+"
    r"(?P<text>.*?)"
    r"(?:\s+_q=\"(?P<q>[^\"]*)\")?"
    r"(?:\s+<!--\s*since:(?P<since>\d+(?:\.\d+)?)\s*-->)?"
    r"\s*$"
)


@dataclass
class Todo:
    id: int
    code: str                       # one of KNOWN_CODES
    text: str
    minutes: int | None = None      # explicit timer override (2_/4f_)
    qualifier: str = ""             # 4f_ _q="..."
    since: float | None = None      # epoch anchor for timed codes

    def effective_minutes(self) -> int | None:
        if self.code not in TIMED_CODES:
            return None
        return self.minutes if self.minutes is not None else DEFAULT_MINUTES[self.code]


def parse_line(line: str) -> Todo | None:
    m = _LINE_RE.match(line)
    if not m:
        return None
    code = m.group("code")
    if code not in KNOWN_CODES:
        return None
    minutes = int(m.group("minutes")) if m.group("minutes") else None
    since = float(m.group("since")) if m.group("since") else None
    return Todo(
        id=int(m.group("id")),
        code=code,
        text=(m.group("text") or "").strip(),
        minutes=minutes,
        qualifier=(m.group("q") or ""),
        since=since,
    )


def render_line(todo: Todo) -> str:
    code_tok = todo.code
    if todo.minutes is not None and todo.code in TIMED_CODES:
        code_tok = f"{todo.code}_{todo.minutes}"
    parts = [f"#{todo.id}", f"{code_tok}_", todo.text]
    line = " ".join(p for p in parts if p)
    if todo.code == "4f" and todo.qualifier:
        line += f' _q="{todo.qualifier}"'
    if todo.code in TIMED_CODES and todo.since is not None:
        since_txt = f"{todo.since:.3f}".rstrip("0").rstrip(".")
        line += f" <!-- since:{since_txt} -->"
    return line


def parse_document(text: str) -> tuple[list[str], list[Todo]]:
    """Return (header_lines, todos). Header = everything before the first
    todo line (the format-rules / set-title preamble), preserved verbatim."""
    header: list[str] = []
    todos: list[Todo] = []
    seen_todo = False
    for raw in text.splitlines():
        todo = parse_line(raw)
        if todo is not None:
            seen_todo = True
            todos.append(todo)
        elif not seen_todo:
            header.append(raw)
        # lines after the first todo that aren't todos (blanks) are dropped
        # on render; render reinserts a blank between items for readability.
    return header, todos


def render_document(header: list[str], todos: list[Todo]) -> str:
    out: list[str] = []
    out.extend(header)
    if header and header[-1].strip():
        out.append("")
    for todo in todos:
        out.append(render_line(todo))
        out.append("")
    return "\n".join(out).rstrip() + "\n"
