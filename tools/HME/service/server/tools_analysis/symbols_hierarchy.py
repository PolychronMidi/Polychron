"""HME symbol, structure, and trace tools."""
import os
import logging

from server import context as ctx
from server.helpers import get_context_budget, validate_project_path, fmt_score, fmt_sim_score, BUDGET_LIMITS
from . import _track
from lang_registry import ext_to_lang
from symbols import collect_all_symbols, find_callers as _find_callers, get_type_hierarchy as _get_type_hierarchy, preview_rename as _preview_rename
from .symbols import _get_architectural_globals  # noqa: F401
from structure import file_summary as _file_summary, module_map as _module_map, format_module_map as _format_module_map
from analysis import get_dependency_graph as _get_dep_graph, find_similar_code as _find_similar, trace_cross_language as _trace_cross_lang

logger = logging.getLogger("HME")

_GLOBALS_DTS_PATH = "src/types/globals.d.ts"
_GLOBALS_CACHE: list[str] | None = None




def type_hierarchy(type_name: str = "") -> str:
    """Show module dependency hierarchy. For TS/class projects: class/interface inheritance (extends/implements).
    For CommonJS IIFE projects (like this one): shows which IIFE globals each module depends on,
    surfacing the layered require chain and manager/helper relationships.
    With type_name, focuses on that specific module's direct dependencies and dependents."""
    result = _get_type_hierarchy(ctx.PROJECT_ROOT)
    types = result.get("types", {})

    # If formal type hierarchy exists (TypeScript classes/interfaces), use it directly
    if types:
        if type_name:
            if type_name not in types:
                matches = [n for n in types if type_name.lower() in n.lower()]
                if not matches:
                    return f"Type '{type_name}' not found."
                parts = [f"Partial matches for '{type_name}':"]
                for m in matches[:20]:
                    t = types[m]
                    parts.append(f"  [{t['kind']}] {m} ({t['file']}:{t['line']})")
                return "\n".join(parts)
            t = types[type_name]
            parts = [f"[{t['kind']}] {type_name} ({t['file']}:{t['line']})"]
            if t["extends"]:
                parts.append(f"  extends: {', '.join(t['extends'])}")
            if t["implements"]:
                parts.append(f"  implements: {', '.join(t['implements'])}")
            if t["extended_by"]:
                parts.append(f"  extended by: {', '.join(t['extended_by'])}")
            if t["implemented_by"]:
                parts.append(f"  implemented by: {', '.join(t['implemented_by'])}")
            return "\n".join(parts)
        roots = [n for n, t in types.items() if not t["extends"] and (t["extended_by"] or t["implemented_by"])]
        parts = [f"Type hierarchy: {len(types)} types, {len(result['edges'])} edges"]
        for r in sorted(roots)[:50]:
            t = types[r]
            parts.append(f"\n[{t['kind']}] {r}")
            for child in t.get("extended_by", []):
                parts.append(f"  <- {child} (extends)")
            for child in t.get("implemented_by", []):
                parts.append(f"  <- {child} (implements)")
        return "\n".join(parts)

    import re as _re
    import glob as _glob_mod

    arch_globals = _get_architectural_globals()
    if not arch_globals:
        return "No type hierarchy found and no globals.d.ts to build IIFE dependency map."

    # Build: module -> set of globals it directly references
    global_set = set(g.lower() for g in arch_globals)
    dep_graph: dict[str, set[str]] = {}  # module_name -> globals it uses
    rev_graph: dict[str, set[str]] = {}  # global -> modules that use it

    for js_file in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*.js"), recursive=True):
        if "index.js" in js_file or "/node_modules/" in js_file:
            continue
        basename = os.path.basename(js_file).replace(".js", "")
        try:
            content = open(js_file, encoding="utf-8", errors="ignore").read()
        except Exception as _err:
            logger.debug(f"unnamed-except symbols.py:246: {type(_err).__name__}: {_err}")
            continue
        # Find all global names referenced in this file (skip its own definition)
        used = set()
        for g in arch_globals:
            if g == basename:
                continue
            if _re.search(r'\b' + _re.escape(g) + r'\b', content):
                used.add(g)
        if used:
            dep_graph[basename] = used
            for g in used:
                rev_graph.setdefault(g, set()).add(basename)

    if not dep_graph:
        return "No IIFE dependency relationships found."

    if type_name:
        name_lower = type_name.lower()
        # Find as a module (something that depends on others)
        deps = dep_graph.get(type_name) or dep_graph.get(name_lower) or set()
        # Find as a depended-on global
        dependents = rev_graph.get(type_name) or rev_graph.get(name_lower) or set()
        parts = [f"## IIFE Module: '{type_name}'"]
        if deps:
            parts.append(f"\nDepends on ({len(deps)} globals):")
            for d in sorted(deps):
                parts.append(f"  -> {d}")
        else:
            parts.append("\nDepends on: (no tracked globals)")
        if dependents:
            parts.append(f"\nUsed by ({len(dependents)} modules):")
            for d in sorted(dependents):
                parts.append(f"  <- {d}")
        else:
            parts.append("\nUsed by: (nothing found)")
        return "\n".join(parts)

    # Full graph: show modules with most dependencies first (most interconnected)
    sorted_modules = sorted(dep_graph.items(), key=lambda x: -len(x[1]))
    parts = [f"## IIFE Module Dependency Map ({len(dep_graph)} modules)\n"]
    parts.append("Modules sorted by outbound dependency count (most coupled first):\n")
    for mod, deps in sorted_modules[:30]:
        n_users = len(rev_graph.get(mod, set()))
        parts.append(f"  {mod} -> [{len(deps)} deps, {n_users} users]: {', '.join(sorted(deps)[:6])}"
                     + (" ..." if len(deps) > 6 else ""))
    # Roots: globals with most dependents (most fundamental)
    parts.append(f"\n## Most Depended-On Globals (top 10):")
    top_depended = sorted(rev_graph.items(), key=lambda x: -len(x[1]))[:10]
    for g, users in top_depended:
        parts.append(f"  {g}: {len(users)} modules depend on it")

    # Manager/helper pairing: detect *Manager files and their *Helpers counterparts
    manager_pairs = []
    for js_file in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*Manager.js"), recursive=True):
        stem = os.path.basename(js_file).replace("Manager.js", "")
        # Search for matching *Helpers.js (plural suffix convention in this project)
        helpers_pat = os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{stem}*Helpers.js")
        helper_matches = _glob_mod.glob(helpers_pat, recursive=True)
        helper_name = os.path.basename(helper_matches[0]).replace(".js", "") if helper_matches else None
        mgr_name = os.path.basename(js_file).replace(".js", "")
        users_of_mgr = len(rev_graph.get(mgr_name, set()))
        manager_pairs.append((mgr_name, helper_name, users_of_mgr))

    if manager_pairs:
        parts.append(f"\n## Manager/Helper Pairs ({len(manager_pairs)} managers):")
        for mgr, hlp, users in sorted(manager_pairs, key=lambda x: -x[2]):
            hlp_str = f" + {hlp}" if hlp else " (no helpers file)"
            parts.append(f"  {mgr}{hlp_str} [{users} dependents]")

    # regardless of filename convention.
    defacto = []
    for js_file in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*.js"), recursive=True):
        rel = js_file.replace(ctx.PROJECT_ROOT + "/src/", "")
        parts_rel = rel.split("/")
        subsystem = parts_rel[0] if len(parts_rel) > 1 else "root"
        basename = os.path.basename(js_file).replace(".js", "")
        if basename == "index":
            continue
        n_users = len(rev_graph.get(basename, set()))
        defacto.append((basename, subsystem, n_users))
    # Compute per-subsystem median -- exclude single-use helpers (<=1 caller) and
    import statistics as _stats
    _helper_suffixes = ('Helpers', 'Config', 'Data', 'Values', 'Priors', 'Profiles', 'Scorers', 'Analyzers')
    sub_users: dict[str, list] = {}
    for name, sub, nu in defacto:
        if nu <= 1:
            continue  # single-use helpers skew median down; exclude from baseline
        if any(name.endswith(s) for s in _helper_suffixes):
            continue  # pure helper/config files are not representative modules
        sub_users.setdefault(sub, []).append(nu)
    sub_median = {sub: _stats.median(vals) for sub, vals in sub_users.items() if vals}
    named_managers = {mgr for mgr, _, _ in manager_pairs}
    defacto_hubs = [
        (name, sub, nu)
        for name, sub, nu in defacto
        if name not in named_managers
        and sub_median.get(sub, 0) > 0
        and nu >= 2 * sub_median.get(sub, 1)
        and nu >= 5
    ]
    defacto_hubs.sort(key=lambda x: -x[2])
    if defacto_hubs:
        parts.append(f"\n## De-facto Hubs by Caller Ratio (>2* subsystem median, not *Manager named):")
        for name, sub, nu in defacto_hubs[:15]:
            med = sub_median.get(sub, 0)
            parts.append(f"  {name} [{sub}] {nu} users (median={med:.0f}, ratio={nu/max(med,1):.1f}*)")

    # Subsystem rollup: group module dep counts by src/ subdirectory
    subsystem_totals: dict[str, dict] = {}
    for js_file in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "*.js"), recursive=True):
        rel = js_file.replace(ctx.PROJECT_ROOT + "/src/", "")
        parts_rel = rel.split("/")
        subsystem = parts_rel[0] if len(parts_rel) > 1 else "root"
        basename = os.path.basename(js_file).replace(".js", "")
        n_deps = len(dep_graph.get(basename, set()))
        n_users = len(rev_graph.get(basename, set()))
        if subsystem not in subsystem_totals:
            subsystem_totals[subsystem] = {"files": 0, "total_deps": 0, "total_users": 0}
        subsystem_totals[subsystem]["files"] += 1
        subsystem_totals[subsystem]["total_deps"] += n_deps
        subsystem_totals[subsystem]["total_users"] += n_users
    if subsystem_totals:
        parts.append(f"\n## Subsystem Rollup ({len(subsystem_totals)} subsystems):")
        for sub, stats in sorted(subsystem_totals.items(), key=lambda x: -x[1]["total_users"]):
            avg_deps = stats["total_deps"] / max(stats["files"], 1)
            parts.append(f"  {sub:<20} {stats['files']:3} files  avg_deps={avg_deps:.1f}  total_users={stats['total_users']}")

    return "\n".join(parts)


def cross_language_trace(symbol_name: str) -> str:
    """Trace a symbol's call chain. For Rust/WASM projects: Rust definition -> WASM bridge -> JS callers.
    For pure-JS CommonJS projects (like this one): IIFE global definition -> direct callers -> require chain.
    Also attaches KB constraints for the symbol and flags hot-path callers."""
    if not symbol_name.strip():
        return "Error: symbol_name cannot be empty."
    result = _trace_cross_lang(symbol_name, ctx.PROJECT_ROOT)

    # Rust/WASM path
    if result.get("rust_definition"):
        parts = [f"## Cross-language trace: '{symbol_name}'"]
        rd = result["rust_definition"]
        wasm_tag = " [wasm_bindgen]" if rd["is_wasm_export"] else ""
        parts.append(f"\nRust definition: {rd['file']}:{rd['line']}{wasm_tag}")
        if result["wasm_bridge"]:
            parts.append(f"\nWASM bridge ({len(result['wasm_bridge'])}):")
            for br in result["wasm_bridge"][:10]:
                parts.append(f"  {br['file']}:{br['line']} - {br['text'][:100]}")
        if result["ts_callers"]:
            parts.append(f"\nJS/TS callers ({len(result['ts_callers'])}):")
            for tc in result["ts_callers"][:20]:
                parts.append(f"  {tc['file']}:{tc['line']} - {tc['text'][:100]}")
        if result["chain"]:
            parts.append(f"\nCall chain:\n  " + "\n  -> ".join(result["chain"]))
        return "\n".join(parts)

    # Pure-JS CommonJS path: IIFE global -> callers -> require chain
    parts = [f"## JS Module Trace: '{symbol_name}'"]

    # 1. Find definition via symbol table
    if ctx.project_engine.symbol_table is not None:
        try:
            all_rows = ctx.project_engine.symbol_table.to_arrow().to_pylist()
            defs = [r for r in all_rows if r["name"].lower() == symbol_name.lower()]
            if defs:
                d = defs[0]
                rel = d["file"].replace(ctx.PROJECT_ROOT + "/", "")
                parts.append(f"\n**Definition:** {rel}:{d['line']} [{d['kind']}]")
                if d.get("signature"):
                    parts.append(f"  Signature: {d['signature'][:120]}")
            else:
                parts.append(f"\nDefinition: not in symbol index (may be an IIFE global)")
        except Exception as _err3:
            logger.debug(f'silent-except symbols.py:421: {type(_err3).__name__}: {_err3}')

    # 2. Direct callers (who uses this symbol in src/)
    callers = _find_callers(symbol_name, ctx.PROJECT_ROOT)
    callers = [r for r in callers if not r["file"].endswith(".md")]
    caller_files = sorted(set(r["file"].replace(ctx.PROJECT_ROOT + "/", "") for r in callers))

    _hot = {
        "src/play/processBeat.js", "src/play/crossLayerBeatRecord.js",
        "src/play/emitPickCrossLayerRecord.js", "src/play/playNotesEmitPick.js",
        "src/play/main.js",
    }
    hot_callers = [f for f in caller_files if f in _hot]

    if caller_files:
        label = f"  [{len(hot_callers)} HOT PATH]" if hot_callers else ""
        parts.append(f"\n**Direct callers** ({len(callers)} sites in {len(caller_files)} files){label}:")
        for f in caller_files[:20]:
            flag = " [HOT PATH -- per-beat]" if f in _hot else ""
            parts.append(f"  {f}{flag}")
        if len(caller_files) > 20:
            parts.append(f"  ... and {len(caller_files) - 20} more")
    else:
        parts.append("\nNo callers found in codebase (may be unused or loaded as side-effect).")

    # 3. Require chain: which index.js files pull this in?
    import re as _re
    require_pat = _re.compile(r"require\(['\"]([^'\"]+)['\"]")
    index_files = []
    import glob as _glob_mod
    for idx in _glob_mod.glob(os.path.join(ctx.PROJECT_ROOT, "src", "**", "index.js"), recursive=True):
        try:
            with open(idx, encoding="utf-8", errors="ignore") as _f:
                content = _f.read()
            if symbol_name.lower() in content.lower():
                rel = idx.replace(ctx.PROJECT_ROOT + "/", "")
                reqs = require_pat.findall(content)
                matching = [r for r in reqs if symbol_name.lower() in r.lower()]
                index_files.append((rel, matching))
        except Exception as _err:
            logger.debug(f"unnamed-except symbols.py:461: {type(_err).__name__}: {_err}")
            continue
    if index_files:
        parts.append(f"\n**Require chain** (index.js files loading this):")
        for rel, reqs in index_files[:8]:
            req_str = f" via {reqs[0]}" if reqs else ""
            parts.append(f"  {rel}{req_str}")

    # 4. Outgoing dependencies -- what architectural globals does this module read?
    # Complements callers (who reads me) with what I read from others.
    if ctx.project_engine.symbol_table is not None:
        try:
            all_rows_od = ctx.project_engine.symbol_table.to_arrow().to_pylist()
            defs_od = [r for r in all_rows_od if r["name"].lower() == symbol_name.lower()]
            if defs_od:
                def_file_od = defs_od[0]["file"]
                if os.path.isfile(def_file_od):
                    src_od = open(def_file_od, encoding="utf-8", errors="ignore").read()
                    arch_globals = _get_architectural_globals()
                    own_name = symbol_name.lower()
                    outgoing = [g for g in arch_globals
                                if g.lower() != own_name
                                and _re.search(r'\b' + _re.escape(g) + r'\b', src_od)]
                    if outgoing:
                        parts.append(f"\n**Outgoing dependencies** ({len(outgoing)} architectural globals read):")
                        for g in sorted(outgoing):
                            parts.append(f"  {g}")
        except Exception as _err4:
            logger.debug(f'silent-except symbols.py:488: {type(_err4).__name__}: {_err4}')

    # 5. Exported API (what methods does this module expose?)
    if ctx.project_engine.symbol_table is not None:
        try:
            all_rows = ctx.project_engine.symbol_table.to_arrow().to_pylist()
            # Find the defining file first
            defs = [r for r in all_rows if r["name"].lower() == symbol_name.lower()]
            if defs:
                def_file = defs[0]["file"]
                # All symbols in that file = exported API surface
                api = [r for r in all_rows if r["file"] == def_file
                       and r["name"].lower() != symbol_name.lower()
                       and r["kind"] in ("function", "method", "variable")]
                if api:
                    parts.append(f"\n**Exported API** ({len(api)} symbols in {def_file.replace(ctx.PROJECT_ROOT + '/', '')}):")
                    for sym in sorted(api, key=lambda x: x["line"])[:20]:
                        sig = f"  {sym['name']}: {sym['signature'][:80]}" if sym.get("signature") else f"  {sym['name']} [{sym['kind']}]"
                        parts.append(sig)
                    if len(api) > 20:
                        parts.append(f"  ... and {len(api) - 20} more")
        except Exception as _err5:
            logger.debug(f'silent-except symbols.py:510: {type(_err5).__name__}: {_err5}')

    # 6. KB constraints
    kb = ctx.project_engine.search_knowledge(symbol_name, top_k=3)
    if kb:
        parts.append(f"\n**KB constraints** ({len(kb)} entries):")
        for k in kb:
            parts.append(f"  [{k['category']}] {k['title']}")
            parts.append(f"    {k['content'][:100]}...")

    return "\n".join(parts)


