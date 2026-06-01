"""HME reasoning -- think tool and blast_radius analysis."""
import os
import logging

from server import context as ctx
from symbols import find_callers as _find_callers
from .synthesis import (
    _local_think, _reasoning_think, _THINK_SYSTEM,
    _two_stage_think, _parallel_two_stage_think,
    store_think_history, get_think_history_context,
    _read_module_source,
)
from .synthesis_cascade import _cascade_synthesis, _assess_complexity, _fuzzy_find_modules

logger = logging.getLogger("HME")




def blast_radius(symbol_name: str, max_depth: int = 3) -> str:
    """Trace the full transitive dependency chain of a symbol: who calls it, who calls those callers, etc. Deeper than impact_analysis."""
    ctx.ensure_ready_sync()
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    visited = set()
    layers = []
    current = [symbol_name]
    for depth in range(max_depth):
        next_layer = []
        layer_results = []
        for sym in current:
            if sym in visited:
                continue
            visited.add(sym)
            callers = _find_callers(sym, ctx.PROJECT_ROOT)
            for r in callers:
                rel = r["file"].replace(ctx.PROJECT_ROOT + "/", "")
                if not rel.startswith("src/"):
                    continue
                caller_file = os.path.basename(r["file"]).replace(".js", "").replace(".ts", "")
                if caller_file not in visited and caller_file != sym:
                    next_layer.append(caller_file)
                    layer_results.append(f"  {r['file'].replace(ctx.PROJECT_ROOT + '/', '')}:{r['line']} ({sym})")
        if layer_results:
            layers.append((depth + 1, layer_results))
        current = list(set(next_layer))
        if not current:
            break
    if not layers:
        # Fallback: symbol may be a property/field name, not an IIFE global.
        # Try grep to find usages as a property reference.
        from server.search_basic import grep as _grep_fn
        grep_result = _grep_fn(symbol_name, path="src/", regex=False, files_only=True)
        if grep_result and "No matches" not in grep_result:
            return (f"# Blast Radius: {symbol_name}\n\n"
                    f"'{symbol_name}' is not an IIFE global -- falling back to grep.\n"
                    f"Found as property/field reference:\n\n{grep_result}")
        return f"No callers found for '{symbol_name}'. Blast radius = 0."
    parts = [f"# Blast Radius: {symbol_name}\n"]
    total = 0
    for depth, results in layers:
        total += len(results)
        parts.append(f"## Depth {depth} ({len(results)} sites)")
        for r in results[:15]:
            parts.append(r)
        if len(results) > 15:
            parts.append(f"  ... and {len(results) - 15} more")
        parts.append("")
    # KB constraints
    kb_hits = ctx.project_engine.search_knowledge(symbol_name, top_k=2)
    if kb_hits:
        parts.append("## KB Constraints")
        for k in kb_hits:
            parts.append(f"  [{k['category']}] {k['title']}")
    import re as _re
    source = _read_module_source(symbol_name, max_chars=10000)
    l0_consumers = []
    if source:
        posted_channels = _re.findall(r"L0\.post\(['\"]([^'\"]+)['\"]", source)
        if posted_channels:
            # Scan src/ for L0 consumers of these channels
            read_pats = [_re.compile(r"L0\." + method + r"\(\s*['\"]" + ch + r"['\"]")
                         for ch in set(posted_channels)
                         for method in ("getLast", "query", "findClosest", "count", "getBounds")]
            src_root = os.path.join(ctx.PROJECT_ROOT, "src")
            for dp, _, fnames in os.walk(src_root):
                for fn in fnames:
                    if not fn.endswith(".js"):
                        continue
                    fp = os.path.join(dp, fn)
                    try:
                        with open(fp, encoding="utf-8", errors="ignore") as _f:
                            content = _f.read()
                    except Exception as _err:
                        logger.debug(f"unnamed-except reasoning_think.py:415: {type(_err).__name__}: {_err}")
                        continue
                    rel = fp.replace(ctx.PROJECT_ROOT + "/", "")
                    for pat in read_pats:
                        m_obj = pat.search(content)
                        if m_obj:
                            ch_name = _re.search(r"['\"]([^'\"]+)['\"]", m_obj.group()).group(1)
                            l0_consumers.append(f"  {rel} (via L0 '{ch_name}')")
                            break
    if l0_consumers:
        parts.append(f"\n## L0 Channel Consumers ({len(l0_consumers)} sites)")
        for lc in l0_consumers:
            parts.append(lc)
        total += len(l0_consumers)

    parts.append(f"\nTotal blast radius: {total} sites across {len(layers)} depth levels"
                 + (f" + {len(l0_consumers)} L0 consumers" if l0_consumers else ""))
    all_files = set()
    for _, results in layers:
        for r in results:
            f = r.strip().split(":")[0]
            all_files.add(f)
    for lc in l0_consumers:
        f = lc.strip().split(":")[0].split(" (via")[0]
        all_files.add(f)
    parts.append(f"Files affected: {len(all_files)}")

    if total > 0:
        depth_summary = "; ".join(f"depth {d}: {len(r)} sites" for d, r in layers)
        user_text = (
            f"Symbol changed: {symbol_name}\n"
            f"Blast radius: {total} call sites in {len(all_files)} files ({depth_summary})\n\n"
            "In 3 points: (1) which callers at depth 1 are highest-risk to break, "
            "(2) what integration tests or validation steps are most important, "
            "(3) any cascade effects to watch for in deeper layers."
        )
        synthesis = _reasoning_think(user_text, max_tokens=1024, system=_THINK_SYSTEM)
        if synthesis:
            from .synthesis.synthesis_inference import compress_for_claude
            synthesis = compress_for_claude(synthesis, max_chars=800, hint=f"blast radius risk for {symbol_name}")
            parts.append(f"\n## Change Risk *(adaptive)*")
            parts.append(synthesis)
        else:
            logger.warning(f"blast_radius({symbol_name!r}): adaptive synthesis unavailable")

    return "\n".join(parts)
