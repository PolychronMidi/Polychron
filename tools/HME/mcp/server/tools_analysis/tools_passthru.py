"""HME passthrough tools — drop-in replacements for native Claude Code tools.

Absorbs find's routing: search modes → grep, structural modes → glob_search,
analysis modes → evolve. enrich='light' (default) for KB tags, 'full' for
deep briefing (callers, boundaries, session narrative).
"""
import os
import re
import subprocess
import time
import logging

from server import context as ctx
from . import _track, _budget_gate, BUDGET_TOOL, _filter_kb_relevance
from .synthesis_session import append_session_narrative, get_session_narrative

logger = logging.getLogger("HME")

# Circuit breaker: dedup identical queries within a short window.
_recent: dict[tuple, tuple[float, str]] = {}
_DEDUP_WINDOW_S = 60
_DEDUP_MAX = 50


def _dedup_check(key: tuple) -> str | None:
    cached = _recent.get(key)
    if cached and (time.monotonic() - cached[0]) < _DEDUP_WINDOW_S:
        age = int(time.monotonic() - cached[0])
        return cached[1] + f"\n\n(cached — {age}s ago)"
    return None


def _dedup_store(key: tuple, result: str) -> str:
    _recent[key] = (time.monotonic(), result)
    if len(_recent) > _DEDUP_MAX:
        cutoff = time.monotonic() - _DEDUP_WINDOW_S
        for k in [k for k, v in _recent.items() if v[0] < cutoff]:
            del _recent[k]
    return result


def _kb_light(query: str, top_k: int = 2) -> str:
    if ctx.project_engine is None:
        return ""
    hits = ctx.project_engine.search_knowledge(query, top_k=top_k)
    if not hits:
        return ""
    lines = ["## KB"]
    for k in hits:
        lines.append(f"  [{k['category']}] {k['title']}: {k['content'][:120]}...")
    return "\n".join(lines)


def _kb_full(query: str) -> str:
    if ctx.project_engine is None:
        return ""
    hits = ctx.project_engine.search_knowledge(query, top_k=5)
    filtered = _filter_kb_relevance(hits, query) if hits else []
    if not filtered:
        return ""
    lines = ["## KB Context (full)"]
    for k in filtered:
        lines.append(f"  [{k['category']}] **{k['title']}**")
        lines.append(f"    {k['content'][:300]}")
    narrative = get_session_narrative(max_entries=10)
    if narrative:
        lines.append("")
        lines.append(narrative)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# grep — absorbs find's search modes (callers, boundary, semantic, diagnose)
# ---------------------------------------------------------------------------

def _detect_search_intent(query: str) -> str:
    q = query.lower().strip()
    if re.match(r'^(callers? of|who calls|find callers)\s+', q):
        return "callers"
    if re.search(r'\bshould use\b|\bnot\b.*\binstead\b|\banti.?pattern\b|\bboundary\b', q):
        return "boundary"
    if re.search(r'[*+\[\]\\^$|]', query) and not re.search(r'[a-z]{8,}', q):
        return "grep"
    if ' ' not in query.strip() and re.match(r'^[a-zA-Z_]\w*$', query.strip()):
        return "grep"
    return "semantic"


@ctx.mcp.tool()
def grep(pattern: str, path: str = "", glob: str = "", type: str = "",
         output_mode: str = "content", context: int = 0,
         case_insensitive: bool = False, head_limit: int = 50,
         mode: str = "auto", enrich: str = "light") -> str:
    """Search with KB enrichment. Drop-in for native Grep + absorbs find().
    mode='auto' (default): regex/symbol → ripgrep, 'callers of X' → callers,
    'X should use Y' → boundary, natural language → semantic search.
    mode='grep'|'semantic'|'callers'|'boundary'|'diagnose' to force engine.
    enrich='light' (default): KB tags. enrich='full': deep KB + session narrative.
    output_mode: 'content'|'files_with_matches'|'count'. glob/type: file filters."""
    _track("grep")
    ctx.ensure_ready_sync()
    if not pattern:
        return "Error: pattern cannot be empty."

    append_session_narrative("grep", f"{mode}: {pattern[:80]}")
    dk = (pattern.strip(), mode, path)
    cached = _dedup_check(dk)
    if cached:
        return cached

    resolved_mode = mode if mode != "auto" else _detect_search_intent(pattern)
    enrich_fn = _kb_full if enrich == "full" else _kb_light

    # Routed modes (from find)
    if resolved_mode == "callers":
        symbol = re.sub(r'^(callers? of|who calls|find callers)\s+', '', pattern, flags=re.IGNORECASE).strip()
        from server.tools_search import find_callers as _fc
        result = _fc(symbol, path=path)
        kb = enrich_fn(symbol)
        return _dedup_store(dk, (kb + "\n\n" if kb else "") + result)

    if resolved_mode == "boundary":
        m = re.match(r'(\S+)\s+(?:should use|not|instead of|vs)\s+(\S+)', pattern, re.IGNORECASE)
        if m:
            from server.tools_search import find_anti_pattern as _fap
            return _dedup_store(dk, _fap(wrong_symbol=m.group(1), right_symbol=m.group(2), path=path))
        tokens = re.findall(r'[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*', pattern)
        symbols = [t for t in tokens if len(t) > 3 and t.lower() not in
                   {'should', 'using', 'instead', 'hardcoded', 'names', 'strings', 'not'}]
        if len(symbols) >= 2:
            from server.tools_search import find_anti_pattern as _fap
            return _dedup_store(dk, _fap(wrong_symbol=symbols[0], right_symbol=symbols[1], path=path))
        if len(symbols) == 1:
            from server.tools_search import grep as _internal_grep
            return _dedup_store(dk, _internal_grep(symbols[0], path=path or "src/", regex=False))
        return "Error: boundary mode needs 'wrong should use right' or symbol-like tokens."

    if resolved_mode == "diagnose":
        from .workflow_audit import diagnose_error as _de
        return _dedup_store(dk, _de(pattern))

    if resolved_mode == "semantic":
        from server.tools_search import search_code as _sc
        result = _sc(pattern, path=path, response_format="detailed")
        kb = enrich_fn(pattern)
        full = (kb + "\n\n" if kb else "") + result
        return _dedup_store(dk, _budget_gate(full))

    # Default: ripgrep passthrough
    return _dedup_store(dk, _rg_search(pattern, path, glob, type, output_mode,
                                        context, case_insensitive, head_limit, enrich_fn))


def _rg_search(pattern, path, glob_filter, file_type, output_mode,
               ctx_lines, case_insensitive, head_limit, enrich_fn):
    target = path
    if target and not os.path.isabs(target):
        target = os.path.join(ctx.PROJECT_ROOT, target)
    if not target:
        target = ctx.PROJECT_ROOT
    target = os.path.realpath(target)
    _root = os.path.realpath(ctx.PROJECT_ROOT)
    if not target.startswith(_root + os.sep) and target != _root:
        return f"Error: path is outside the project root."

    cmd = ["rg", "--no-heading"]
    if output_mode == "files_with_matches":
        cmd.append("-l")
    elif output_mode == "count":
        cmd.append("-c")
    else:
        cmd.append("-n")
    if case_insensitive:
        cmd.append("-i")
    if ctx_lines > 0 and output_mode == "content":
        cmd.extend(["-C", str(ctx_lines)])
    if glob_filter:
        cmd.extend(["--glob", glob_filter])
    if file_type:
        cmd.extend(["--type", file_type])
    cmd.extend([pattern, target])

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        raw = r.stdout.strip()
        if r.returncode == 2:
            err = r.stderr.strip()[:200] or "invalid pattern or argument"
            return f"Error: rg failed — {err}"
    except FileNotFoundError:
        return _grep_fallback(pattern, target, output_mode, head_limit)
    except Exception as e:
        return f"Error: {e}"

    if not raw:
        kb = enrich_fn(pattern)
        return (kb + "\n\n" if kb else "") + f"No matches for '{pattern}'"

    lines = raw.split("\n")
    shown = lines[:head_limit]
    parts = []
    kb = enrich_fn(pattern)
    if kb:
        parts.append(kb)
        parts.append("")
    parts.extend(l.replace(ctx.PROJECT_ROOT + "/", "") for l in shown)
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
        if r.returncode > 1:
            err = r.stderr.strip()[:200] or "grep error"
            return f"Error: grep failed — {err}"
        lines = r.stdout.strip().split("\n")
        if output_mode == "count":
            lines = [l for l in lines if not l.endswith(":0")]
        lines = [l.replace(ctx.PROJECT_ROOT + "/", "") for l in lines[:head_limit]]
        if not lines or lines == [""]:
            return f"No matches for '{pattern}'"
        return "\n".join(lines)
    except Exception as e:
        return f"Error: {e}"


# ---------------------------------------------------------------------------
# glob_search — absorbs find's structural modes (map, hierarchy, symbols, etc.)
# ---------------------------------------------------------------------------

@ctx.mcp.tool()
def glob_search(pattern: str, path: str = "", mode: str = "auto",
                enrich: str = "light") -> str:
    """File/symbol search with KB enrichment. Drop-in for native Glob + structural find modes.
    mode='auto' (default): glob pattern matching.
    mode='map': module directory map (pattern=directory).
    mode='hierarchy': type hierarchy for a symbol.
    mode='symbols': semantic symbol search.
    mode='lookup': exact symbol lookup.
    mode='rename': bulk rename preview (pattern='old→new').
    mode='xref': cross-language trace for a symbol.
    enrich='light' (default): KB tags per file. enrich='full': full module intel."""
    _track("glob")
    ctx.ensure_ready_sync()
    if not pattern:
        return "Error: pattern cannot be empty."

    append_session_narrative("glob", f"{mode}: {pattern[:80]}")

    if mode == "map":
        from .symbols import get_module_map as _gmm
        return _gmm(pattern or "")

    if mode == "hierarchy":
        from .symbols import type_hierarchy as _th
        return _th(pattern)

    if mode == "symbols":
        from .symbols import search_symbols as _ss
        return _ss(pattern)

    if mode == "lookup":
        from .symbols import lookup_symbol as _ls
        return _ls(pattern)

    if mode == "rename":
        parts = pattern.split("→") if "→" in pattern else pattern.split("->")
        if len(parts) == 2:
            from .symbols import bulk_rename_preview as _brp
            return _brp(parts[0].strip(), parts[1].strip())
        return "Error: rename needs 'old_name→new_name' format."

    if mode == "xref":
        from .symbols import cross_language_trace as _clt
        return _clt(pattern)

    # Default: filesystem glob
    import glob as _gl

    base = path
    if base and not os.path.isabs(base):
        base = os.path.join(ctx.PROJECT_ROOT, base)
    if not base:
        base = ctx.PROJECT_ROOT
    base = os.path.realpath(base)
    _root = os.path.realpath(ctx.PROJECT_ROOT)
    if not base.startswith(_root + os.sep) and base != _root:
        return f"Error: path is outside the project root."

    full_pattern = os.path.join(base, pattern) if not os.path.isabs(pattern) else pattern
    matches = sorted(_gl.glob(full_pattern, recursive=True))

    if not matches:
        return f"No files matching '{pattern}'"

    _GLOB_CAP = 500
    truncated = len(matches) > _GLOB_CAP
    matches = matches[:_GLOB_CAP]

    enrich_fn = _kb_full if enrich == "full" else _kb_light
    parts = []
    kb_modules_seen = set()
    _KB_LOOKUP_CAP = 50
    for m in matches:
        rel = m.replace(ctx.PROJECT_ROOT + "/", "")
        tag = ""
        if m.endswith(".js") and enrich != "none" and len(kb_modules_seen) < _KB_LOOKUP_CAP:
            module = os.path.basename(m).replace(".js", "")
            if module not in kb_modules_seen and ctx.project_engine is not None:
                hits = ctx.project_engine.search_knowledge(module, top_k=1)
                if hits:
                    tag = f"  [KB: {hits[0]['title'][:50]}]"
                    kb_modules_seen.add(module)
        parts.append(f"{rel}{tag}")

    header = f"{len(matches)} files" + (f" (capped at {_GLOB_CAP})" if truncated else "")
    if enrich == "full" and kb_modules_seen:
        full_kb = enrich_fn(list(kb_modules_seen)[0])
        if full_kb:
            header += "\n" + full_kb
    return header + "\n" + "\n".join(parts)


# ---------------------------------------------------------------------------
# edit — file editing with KB constraint surfacing
# ---------------------------------------------------------------------------

@ctx.mcp.tool()
def edit(file_path: str, old_string: str, new_string: str,
         replace_all: bool = False, enrich: str = "light") -> str:
    """File edit with KB constraint check. Drop-in for native Edit.
    Replaces old_string with new_string. replace_all for all occurrences.
    enrich='light' (default): KB constraint titles. enrich='full': full pre-edit briefing."""
    _track("edit")
    ctx.ensure_ready_sync()
    if not file_path:
        return "Error: file_path cannot be empty."
    if not old_string:
        return "Error: old_string cannot be empty."
    if old_string == new_string:
        return "Error: old_string and new_string are identical."

    abs_path = file_path
    if not os.path.isabs(abs_path):
        abs_path = os.path.join(ctx.PROJECT_ROOT, abs_path)
    abs_path = os.path.realpath(abs_path)
    if not abs_path.startswith(os.path.realpath(ctx.PROJECT_ROOT) + os.sep):
        return f"Error: file_path is outside the project root."
    if not os.path.isfile(abs_path):
        return f"Error: file not found: {abs_path}"

    parts = []
    module_name = re.sub(r'\.[^.]*$', '', os.path.basename(abs_path))

    if enrich == "full":
        from .workflow import before_editing as _be
        parts.append(_be(module_name))
        parts.append("")
    elif ctx.project_engine is not None:
        hits = ctx.project_engine.search_knowledge(module_name, top_k=2)
        if hits:
            parts.append("## KB")
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
