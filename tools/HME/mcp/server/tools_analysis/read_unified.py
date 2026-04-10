"""HME read — unified code reading tool.

Merges file_intel, file_lines, get_function_body, and module_intel
into one tool with auto-detection by input format.
"""
import os
import re
import logging

from server import context as ctx
from . import _track
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


@ctx.mcp.tool()
def read(target: str, mode: str = "auto") -> str:
    """Smart code reader — auto-routes by target format.
    'src/path/file.js' → file_intel (structure + KB).
    'src/path/file.js:10-50' → file_lines (line range).
    'functionName' → get_function_body (search all files).
    'moduleName' with mode='story'|'impact'|'both' → module_intel.
    mode='before' → before_editing pre-edit briefing (KB constraints, callers, risks).
    mode='auto' (default) detects from target format."""
    _track("read")
    if mode != "before":
        append_session_narrative("search", f"read({mode}): {target[:60]}")
    ctx.ensure_ready_sync()
    if not target or not target.strip():
        return "Error: target cannot be empty. Pass a file path, function name, or module name."

    if mode == "before":
        from .workflow import before_editing as _be
        return _be(target)

    if mode != "auto":
        return _route_explicit(target, mode)

    # Auto-detect by format
    target = target.strip()

    # Path with line range: src/foo/bar.js:10-50
    line_match = re.match(r'^(.+?):(\d+)-(\d+)$', target)
    if line_match:
        from server.tools_search import file_lines as _fl
        return _fl(line_match.group(1), start=int(line_match.group(2)), end=int(line_match.group(3)))

    # Path with single line: src/foo/bar.js:10
    single_line_match = re.match(r'^(.+?):(\d+)$', target)
    if single_line_match:
        start = int(single_line_match.group(2))
        from server.tools_search import file_lines as _fl
        return _fl(single_line_match.group(1), start=max(1, start - 10), end=start + 30)

    # File path (contains / or ends with .js/.py/.ts/.md)
    if '/' in target or re.search(r'\.(js|py|ts|md|json|sh)$', target):
        from .symbols import file_intel as _fi
        return _fi(target)

    # camelCase or PascalCase with no spaces — could be function or module
    if re.match(r'^[a-zA-Z_]\w*$', target) and not target.islower():
        # Check if it's a known src/ module first
        import glob as _gl
        matches = _gl.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{target}.js"), recursive=True)
        if matches:
            from .reasoning import module_intel as _mi
            return _mi(target, mode="story")
        # Otherwise try as function name
        from .symbols import get_function_body as _gfb
        return _gfb(target)

    # All lowercase single word — try as function/symbol
    if re.match(r'^[a-z]\w*$', target):
        from .symbols import get_function_body as _gfb
        return _gfb(target)

    # Fallback: semantic search for the target
    from server.tools_search import search_code as _sc
    return _sc(target, response_format="concise", top_k=5)


def _route_explicit(target: str, mode: str) -> str:
    """Explicit mode routing."""
    if mode in ("story", "impact", "both"):
        from .reasoning import module_intel as _mi
        return _mi(target, mode=mode)
    if mode == "lines":
        m = re.match(r'^(.+?):(\d+)-(\d+)$', target)
        if m:
            from server.tools_search import file_lines as _fl
            return _fl(m.group(1), start=int(m.group(2)), end=int(m.group(3)))
        from server.tools_search import file_lines as _fl
        return _fl(target)
    if mode == "function":
        from .symbols import get_function_body as _gfb
        return _gfb(target)
    if mode == "structure":
        from .symbols import file_intel as _fi
        return _fi(target)
    if mode == "callers":
        from server.tools_search import find_callers as _fc
        return _fc(target)
    if mode == "deps":
        from .symbols import file_intel as _fi
        return _fi(target, mode="deps")
    return f"Unknown mode '{mode}'. Use: auto, before, story, impact, both, lines, function, structure, callers, deps."
