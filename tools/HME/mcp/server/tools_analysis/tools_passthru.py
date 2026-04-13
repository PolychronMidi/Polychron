"""HME passthrough tools — barebones wrappers for native Claude Code tools.

Provides glob, grep, and edit as MCP tools with minimal KB enrichment.
Mirrors native tool interfaces so HME owns the full toolbox.
"""
import os
import re
import subprocess
import logging

from server import context as ctx
from . import _track, _budget_gate, BUDGET_TOOL

logger = logging.getLogger("HME")


def _kb_enrich(query: str, top_k: int = 2) -> str:
    if ctx.project_engine is None:
        return ""
    hits = ctx.project_engine.search_knowledge(query, top_k=top_k)
    if not hits:
        return ""
    lines = ["## KB Context"]
    for k in hits:
        lines.append(f"  [{k['category']}] {k['title']}: {k['content'][:120]}...")
    return "\n".join(lines)


@ctx.mcp.tool()
def grep(pattern: str, path: str = "", glob: str = "", type: str = "",
         output_mode: str = "content", context: int = 0,
         case_insensitive: bool = False, head_limit: int = 50) -> str:
    """Ripgrep search with KB enrichment. Drop-in for native Grep.
    output_mode: 'content' (matching lines), 'files_with_matches', 'count'.
    glob: file filter ('*.js'). type: file type ('js','py'). context: lines around match.
    head_limit: max results (default 50)."""
    _track("grep")
    ctx.ensure_ready_sync()
    if not pattern:
        return "Error: pattern cannot be empty."

    target = path
    if target and not os.path.isabs(target):
        target = os.path.join(ctx.PROJECT_ROOT, target)
    if not target:
        target = ctx.PROJECT_ROOT

    cmd = ["rg", "--no-heading"]
    if output_mode == "files_with_matches":
        cmd.append("-l")
    elif output_mode == "count":
        cmd.append("-c")
    else:
        cmd.append("-n")
    if case_insensitive:
        cmd.append("-i")
    if context > 0 and output_mode == "content":
        cmd.extend(["-C", str(context)])
    if glob:
        cmd.extend(["--glob", glob])
    if type:
        cmd.extend(["--type", type])
    cmd.extend([pattern, target])

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        raw = r.stdout.strip()
    except FileNotFoundError:
        return _grep_fallback(pattern, target, output_mode, head_limit)
    except Exception as e:
        return f"Error: {e}"

    if not raw:
        kb = _kb_enrich(pattern)
        return (kb + "\n\n" if kb else "") + f"No matches for '{pattern}'"

    lines = raw.split("\n")
    shown = lines[:head_limit]
    parts = []
    kb = _kb_enrich(pattern)
    if kb:
        parts.append(kb)
        parts.append("")
    rel_lines = [l.replace(ctx.PROJECT_ROOT + "/", "") for l in shown]
    parts.extend(rel_lines)
    if len(lines) > head_limit:
        parts.append(f"  ... +{len(lines) - head_limit} more")
    return "\n".join(parts)


def _grep_fallback(pattern, target, output_mode, head_limit):
    cmd = ["grep", "-rn"]
    if output_mode == "files_with_matches":
        cmd = ["grep", "-rl"]
    elif output_mode == "count":
        cmd = ["grep", "-rc"]
    cmd.extend([pattern, target])
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        lines = r.stdout.strip().split("\n")[:head_limit]
        return "\n".join(l.replace(ctx.PROJECT_ROOT + "/", "") for l in lines)
    except Exception as e:
        return f"Error: {e}"


@ctx.mcp.tool()
def glob_search(pattern: str, path: str = "") -> str:
    """File pattern matching with KB enrichment. Drop-in for native Glob.
    Supports glob patterns ('**/*.js', 'src/**/*.ts'). Returns matching paths
    with KB notes for recognized modules."""
    _track("glob")
    ctx.ensure_ready_sync()
    if not pattern:
        return "Error: pattern cannot be empty."

    import glob as _gl

    base = path
    if base and not os.path.isabs(base):
        base = os.path.join(ctx.PROJECT_ROOT, base)
    if not base:
        base = ctx.PROJECT_ROOT

    full_pattern = os.path.join(base, pattern) if not os.path.isabs(pattern) else pattern
    matches = sorted(_gl.glob(full_pattern, recursive=True))

    if not matches:
        return f"No files matching '{pattern}'"

    parts = []
    kb_modules_seen = set()
    for m in matches:
        rel = m.replace(ctx.PROJECT_ROOT + "/", "")
        tag = ""
        if m.endswith(".js"):
            module = os.path.basename(m).replace(".js", "")
            if module not in kb_modules_seen and ctx.project_engine is not None:
                hits = ctx.project_engine.search_knowledge(module, top_k=1)
                if hits:
                    tag = f"  [KB: {hits[0]['title'][:50]}]"
                    kb_modules_seen.add(module)
        parts.append(f"{rel}{tag}")

    return f"{len(matches)} files\n" + "\n".join(parts)


@ctx.mcp.tool()
def edit(file_path: str, old_string: str, new_string: str,
         replace_all: bool = False) -> str:
    """File edit with KB constraint check. Drop-in for native Edit.
    Replaces old_string with new_string in file_path. replace_all for all occurrences.
    Surfaces KB constraints for the module before applying."""
    _track("edit")
    ctx.ensure_ready_sync()
    if not file_path:
        return "Error: file_path cannot be empty."
    if old_string == new_string:
        return "Error: old_string and new_string are identical."

    abs_path = file_path
    if not os.path.isabs(abs_path):
        abs_path = os.path.join(ctx.PROJECT_ROOT, abs_path)
    if not os.path.isfile(abs_path):
        return f"Error: file not found: {abs_path}"

    parts = []

    # KB constraint check
    module = os.path.basename(abs_path)
    module_name = re.sub(r'\.[^.]*$', '', module)
    if ctx.project_engine is not None:
        hits = ctx.project_engine.search_knowledge(module_name, top_k=2)
        if hits:
            parts.append("## KB Constraints")
            for k in hits:
                parts.append(f"  [{k['category']}] {k['title']}: {k['content'][:120]}...")
            parts.append("")

    try:
        with open(abs_path, encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return f"Error reading file: {e}"

    count = content.count(old_string)
    if count == 0:
        parts.append(f"Error: old_string not found in {file_path}")
        return "\n".join(parts)
    if count > 1 and not replace_all:
        parts.append(f"Error: old_string found {count} times — use replace_all=True or provide more context.")
        return "\n".join(parts)

    if replace_all:
        new_content = content.replace(old_string, new_string)
        replaced = count
    else:
        new_content = content.replace(old_string, new_string, 1)
        replaced = 1

    try:
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(new_content)
    except Exception as e:
        return f"Error writing file: {e}"

    rel = abs_path.replace(ctx.PROJECT_ROOT + "/", "")
    parts.append(f"Edited {rel} ({replaced} replacement{'s' if replaced > 1 else ''})")
    return "\n".join(parts)
