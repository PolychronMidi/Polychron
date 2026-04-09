"""HME search tools — basic: grep, file_lines, count_lines."""
import os
import logging

from server import context as ctx
from server.helpers import (
    validate_project_path,
    LINE_COUNT_TARGET, LINE_COUNT_WARN,
)

logger = logging.getLogger("HME")


def grep(pattern: str, path: str = "", file_type: str = "", context: int = 0, regex: bool = False, files_only: bool = False) -> str:
    """Exact string or regex search across project files, enriched with KB cross-references. Use this instead of built-in Grep for all exact-match searches — it automatically surfaces relevant knowledge constraints alongside results. Set regex=True for extended regex (-E), context=N for surrounding lines (-C), files_only=True for file paths only (-l). Returns up to 30 matching lines plus any KB entries related to the search pattern. For semantic/intent-based searches, use search_code instead."""
    import subprocess
    ctx.ensure_ready_sync()
    if not pattern:
        return "Error: pattern cannot be empty."
    if regex:
        import re as _re
        try:
            _re.compile(pattern)
        except _re.error as e:
            return f"Error: invalid regex pattern: {e}"
    target = os.path.join(ctx.PROJECT_ROOT, path) if path and not os.path.isabs(path) else (path if path else ctx.PROJECT_ROOT)
    if not os.path.realpath(target).startswith(os.path.realpath(ctx.PROJECT_ROOT)):
        return f"Error: path '{path}' is outside the project root."
    cmd = ["grep", "-rn"]
    if file_type:
        cmd.extend(["--include", f"*.{file_type}"])
    if regex:
        cmd.insert(1, "-E")
    if context > 0:
        cmd.extend([f"-C{context}"])
    if files_only:
        cmd = ["grep", "-rl"]
        if file_type:
            cmd.extend(["--include", f"*.{file_type}"])
        if regex:
            cmd.insert(1, "-E")
    cmd.extend([pattern, target])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
    except Exception as e:
        return f"Grep failed: {e}"
    # Intelligence layer: check KB for constraints related to the search
    kb_hits = ctx.project_engine.search_knowledge(pattern, top_k=2)
    relevant_kb = kb_hits
    parts = []
    if relevant_kb:
        parts.append("## KB Context")
        for k in relevant_kb:
            parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:100]}...")
        parts.append("")
    if not lines:
        parts.append(f"No matches for '{pattern}' in {path}/*.{file_type}")
        return "\n".join(parts)
    # Dedupe by file and add boundary warnings
    shown = lines[:30]
    parts.append(f"## Matches ({len(lines)} lines)")
    for line in shown:
        rel = line.replace(ctx.PROJECT_ROOT + "/", "")
        parts.append(f"  {rel}")
    if len(lines) > 30:
        parts.append(f"  ... and {len(lines) - 30} more")
    return "\n".join(parts)


def file_lines(file_path: str, start: int = 1, end: int = 0) -> str:
    """Read specific line ranges of a file with automatic KB context for the module. Use this instead of Bash cat/head/tail/sed — it surfaces any knowledge constraints associated with the file's module. Accepts relative paths (resolved against ctx.PROJECT_ROOT) or absolute paths. Specify start and end line numbers to read a range; omit end to read to EOF. Returns numbered lines plus any matching KB entries."""
    ctx.ensure_ready_sync()
    abs_path = validate_project_path(file_path, ctx.PROJECT_ROOT)
    if abs_path is None:
        return f"Error: path '{file_path}' is outside the project root."
    if not os.path.isfile(abs_path):
        return f"File not found: {abs_path}"
    try:
        with open(abs_path, encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()
    except Exception as e:
        return f"Error: {e}"
    total = len(all_lines)
    if end > 0 and end < start:
        return f"Error: end ({end}) must be >= start ({start})."
    s = max(1, start) - 1
    e = end if end > 0 else total
    e = min(e, total)
    selected = all_lines[s:e]
    parts = []
    # KB context for this file
    module_name = os.path.basename(abs_path).replace(".js", "").replace(".ts", "")
    kb_hits = ctx.project_engine.search_knowledge(module_name, top_k=1)
    if kb_hits:
        k = kb_hits[0]
        parts.append(f"## KB: [{k['category']}] {k['title']}")
        parts.append("")
    rel = abs_path.replace(ctx.PROJECT_ROOT + "/", "")
    parts.append(f"## {rel} (lines {s+1}-{e} of {total})")
    for i, line in enumerate(selected, start=s+1):
        parts.append(f"{i:4d}  {line.rstrip()}")
    return "\n".join(parts)


def count_lines(path: str = "src", file_type: str = "js") -> str:
    """Count lines per file in a directory, sorted largest-first with convention warnings. Use instead of wc -l. Flags files exceeding the project's 200-line target and 250-line hard limit. Returns the top 30 files by size, total line count, and number of oversize files. Useful for identifying extraction candidates and tracking code bloat. Can also be called with a file path to count a single file."""
    from file_walker import walk_code_files
    if path == "":
        path = "src"
    target = os.path.join(ctx.PROJECT_ROOT, path) if not os.path.isabs(path) else path
    if not os.path.realpath(target).startswith(os.path.realpath(ctx.PROJECT_ROOT)):
        return f"Error: path '{path}' is outside the project root."
    counts = []
    # Handle file path directly (not just directories)
    if os.path.isfile(target):
        try:
            with open(target, encoding="utf-8", errors="ignore") as _f:
                n = sum(1 for _ in _f)
            rel = target.replace(ctx.PROJECT_ROOT + "/", "")
            flag = " *** OVERSIZE" if n > LINE_COUNT_WARN else " * over target" if n > LINE_COUNT_TARGET else ""
            return f"  {n:5d}  {rel}{flag}\n\nTotal: {n} lines"
        except Exception as e:
            return f"Error reading file: {e}"
    for fpath in walk_code_files(target):
        if not str(fpath).endswith(f".{file_type}"):
            continue
        try:
            with open(fpath, encoding="utf-8", errors="ignore") as _f:
                n = sum(1 for _ in _f)
            rel = str(fpath).replace(ctx.PROJECT_ROOT + "/", "")
            counts.append((n, rel))
        except Exception:
            continue
    counts.sort(key=lambda x: -x[0])
    parts = [f"## Line Counts ({len(counts)} .{file_type} files in {path})\n"]
    for n, rel in counts[:30]:
        flag = " *** OVERSIZE" if n > LINE_COUNT_WARN else " * over target" if n > LINE_COUNT_TARGET else ""
        parts.append(f"  {n:5d}  {rel}{flag}")
    if len(counts) > 30:
        parts.append(f"  ... and {len(counts) - 30} more files")
    total = sum(n for n, _ in counts)
    oversize = sum(1 for n, _ in counts if n > LINE_COUNT_WARN)
    parts.append(f"\nTotal: {total} lines | {oversize} oversize files (>{LINE_COUNT_WARN})")
    return "\n".join(parts)
