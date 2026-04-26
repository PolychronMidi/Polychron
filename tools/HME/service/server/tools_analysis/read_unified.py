"""HME read — unified code reading tool.

Merges file_intel, file_lines, get_function_body, and module_intel
into one tool with auto-detection by input format.
"""
import os
import re
import logging

from server import context as ctx
from server.onboarding_chain import chained
from . import _track
from .synthesis_session import append_session_narrative

logger = logging.getLogger("HME")


def _emit_brief_recorded(target: str, source: str = "hme_read") -> None:
    """Record BRIEF into tmp/hme-nexus.state AND emit brief_recorded activity
    event. Stores under multiple keys so downstream hme_read_prior matching
    works regardless of whether the caller later references the target by
    module name, abs path, or basename with extension.
    """
    import subprocess as _subp
    nexus_file = os.path.join(ctx.PROJECT_ROOT, "tmp", "hme-nexus.state")
    os.makedirs(os.path.dirname(nexus_file), exist_ok=True)
    # Derive all three forms: module (stem), basename_full, abs_path
    keys = {target}
    if os.path.isabs(target):
        keys.add(os.path.basename(target))
        keys.add(os.path.basename(target).rsplit(".", 1)[0])
    else:
        # Might be a module name or relative path
        if "/" in target:
            abs_p = os.path.join(ctx.PROJECT_ROOT, target)
            keys.add(abs_p)
            keys.add(os.path.basename(target))
            keys.add(os.path.basename(target).rsplit(".", 1)[0])
    ts = int(__import__("time").time())
    try:
        with open(nexus_file, "a", encoding="utf-8") as f:
            for key in keys:
                if key:
                    f.write(f"BRIEF:{ts}:{key}\n")
    except OSError as _e:
        logger.debug(f"nexus write failed: {_e}")
        return
    # Fire activity event async
    emit_path = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "activity", "emit.py")
    if os.path.isfile(emit_path):
        try:
            _subp.Popen(
                ["python3", emit_path,
                 "--event=brief_recorded",
                 f"--target={target}",
                 f"--file={target if os.path.isabs(target) else ''}",
                 f"--module={os.path.basename(target).rsplit('.', 1)[0] if '/' in target else target}",
                 f"--source={source}",
                 "--session=tool"],
                stdout=_subp.DEVNULL, stderr=_subp.DEVNULL,
                env={**os.environ, "PROJECT_ROOT": ctx.PROJECT_ROOT},  # env-ok: subprocess needs inherited env
            )
        except Exception as _spawn_err:
            logger.debug(f"brief_recorded emit failed: {_spawn_err}")


@ctx.mcp.tool(meta={"hidden": True})
@chained("read")
def read(target: str = "", mode: str = "auto", fast: bool = False) -> str:
    """Smart code reader — auto-routes by target format.
    'src/path/file.js' → file_intel (structure + KB).
    'src/path/file.js:10-50' → file_lines (line range).
    'functionName' → get_function_body (search all files).
    'moduleName' with mode='story'|'impact'|'both' → module_intel.
    mode='before' → before_editing pre-edit briefing (KB constraints, callers, risks).
    mode='auto' (default) detects from target format.
    fast=True skips the slow adaptive-synthesis section (~60-120s saved).
    Structural sections (KB constraints, callers, interactions, evolutionary
    potential) are always included — only the LLM-generated summary is gated."""
    _track("read")
    if mode != "before":
        append_session_narrative("search", f"read({mode}): {target[:60]}")
    ctx.ensure_ready_sync()
    if not target or not target.strip():
        return (
            "i/hme-read — KB-briefed code reader.\n\n"
            "Usage:\n"
            "  i/hme-read target=<name> [mode=auto|before|story|impact|both|lines|function|structure|callers|deps] [fast=true]\n\n"
            "Target forms (auto-detected):\n"
            "  src/path/file.js           → file_intel (structure + KB)\n"
            "  src/path/file.js:10-50     → file_lines (line range)\n"
            "  functionName               → get_function_body (search all files)\n"
            "  moduleName                 → module_intel\n\n"
            "Modes:\n"
            "  auto (default)             detect from target shape\n"
            "  before                     pre-edit briefing: KB constraints, callers, risks — MANDATORY before edits\n"
            "  fast=true                  skip slow adaptive-synthesis (~60-120s faster)\n"
            "\nExample: i/hme-read target=harmonicIntervalGuard mode=before"
        )

    # Propagate fast flag via env so deep-call-chain synthesis gates can see it
    # without threading fast= through every intermediate function signature.
    if fast:
        os.environ["HME_READ_FAST"] = "1"  # env-ok: transient per-call flag, not persistent config

    # Tool-layer BRIEF emission — agent-independent. When the agent calls
    # i/hme-read (or the Edit pre-hook auto-chains this), that IS a BRIEF.
    # Emit from the tool itself so BRIEFs don't depend on hook substrate or
    # proxy middleware being active. Stores both bare module AND abs path so
    # downstream hme_read_prior matching works regardless of form.
    try:
        _emit_brief_recorded(target.strip(), source=f"hme_read_{mode}")
    except Exception as _brief_err:
        logger.debug(f"read: brief emission failed: {_brief_err}")

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
