"""L0 channel topology scanning and cascade tracing."""
import os
import re
from collections import defaultdict

from server import context as ctx
from . import _track

# Musical semantics for L0 channel names
_CHANNEL_SEMANTICS: dict[str, str] = {
    "emergentRhythm": "grid density/complexity from accumulated rhythmic events",
    "emergentMelody": "contour/freshness/tessiture/counterpoint melodic context",
    "motifEcho": "imitative counterpoint: delay, interval, voice pairs",
    "stutterContagion": "stutter spread across voices — rhythmic infection",
    "emergentDownbeat": "spontaneous accent from event accumulation",
    "feedbackLoop": "oscillatory feedback between modules",
    "onset": "note attack timing and velocity",
    "cadenceAlignment": "phrase-boundary tension resolution timing",
    "regimeTransition": "regime change events with direction",
    "densitySurprise": "unexpected density deviations per beat",
    "hotspots": "per-pair coupling hotspot pressure",
    "convergence": "system convergence state and rate",
    "beatPhase": "current position within the beat cycle",
    "harmonicFunction": "harmonic analysis (tonic/dominant/etc)",
    "underusedPitchClasses": "pitch classes needing more representation",
    "harmonic-journey-eval": "harmonic distance from home key",
    "rest-sync": "rest synchronization between layers",
    "section-quality": "per-section quality metrics",
    "binaural": "binaural beat frequency and phase",
    "instrument": "instrument selection and assignment",
    "note": "individual note events",
    "explainability": "diagnostic explanations for decisions",
    "channel-coherence": "channel signal consistency metric",
    "chord": "chord progression events",
}

# Infrastructure channels consumed by non-JS systems (MIDI, audio, UI)
_INFRA_CHANNELS = {"rest-sync", "section-quality", "binaural", "instrument", "note"}


def _load_l0_channels(src_root: str) -> dict:
    """Parse l0Channels.js to build {propertyKey: 'channelValue'} map."""
    l0c_path = os.path.join(src_root, "time", "l0Channels.js")
    try:
        with open(l0c_path, encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return {}
    pat = re.compile(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*[\'"]([^\'"]+)[\'"]')
    return {k: v for k, v in pat.findall(content)}


def _scan_l0_topology(src_root: str) -> dict:
    """Scan ALL JS source files for L0.post / L0.getLast patterns.
    Returns {channel: {producers: [module, ...], consumers: [module, ...]}}."""
    topology: dict = defaultdict(lambda: {"producers": [], "consumers": []})
    _post_lit  = re.compile(r"L0\.post\(\s*['\"]([^'\"]+)['\"]")
    _get_lit   = re.compile(r"L0\.(?:getLast|findClosest|getAll|query|count|getBounds)\(\s*['\"]([^'\"]+)['\"]")
    _post_var  = re.compile(r"L0\.post\(\s*([A-Z_][A-Z0-9_]*)\s*,")
    _get_var   = re.compile(r"L0\.(?:getLast|findClosest|getAll|query|count|getBounds)\(\s*([A-Z_][A-Z0-9_]*)\s*,")
    _const_re  = re.compile(r"(?:const|let)\s+([A-Z_][A-Z0-9_]*)\s*=\s*['\"]([^'\"]+)['\"]")
    # Patterns for L0_CHANNELS.key property access (the dominant style in this codebase)
    _post_l0ch = re.compile(r"L0\.post\(\s*L0_CHANNELS\.([a-zA-Z_][a-zA-Z0-9_]*)")
    _get_l0ch  = re.compile(r"L0\.(?:getLast|findClosest|getAll|query|count|getBounds)\(\s*L0_CHANNELS\.([a-zA-Z_][a-zA-Z0-9_]*)")
    l0_channels = _load_l0_channels(src_root)

    for dirpath, _, filenames in os.walk(src_root):
        for fname in filenames:
            if not fname.endswith(".js") or fname == "index.js":
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception:
                continue
            module_name = fname.replace(".js", "")
            consts: dict[str, str] = {k: v for k, v in _const_re.findall(content)}
            for ch in _post_lit.findall(content):
                if module_name not in topology[ch]["producers"]:
                    topology[ch]["producers"].append(module_name)
            for ch in _get_lit.findall(content):
                if module_name not in topology[ch]["consumers"]:
                    topology[ch]["consumers"].append(module_name)
            for var in _post_var.findall(content):
                ch = consts.get(var)
                if ch and module_name not in topology[ch]["producers"]:
                    topology[ch]["producers"].append(module_name)
            for var in _get_var.findall(content):
                ch = consts.get(var)
                if ch and module_name not in topology[ch]["consumers"]:
                    topology[ch]["consumers"].append(module_name)
            for key in _post_l0ch.findall(content):
                ch = l0_channels.get(key)
                if ch and module_name not in topology[ch]["producers"]:
                    topology[ch]["producers"].append(module_name)
            for key in _get_l0ch.findall(content):
                ch = l0_channels.get(key)
                if ch and module_name not in topology[ch]["consumers"]:
                    topology[ch]["consumers"].append(module_name)
    return dict(topology)


def channel_topology(start_channel: str = "") -> str:
    """Show the L0 channel signal graph or cascade trace from a specific channel."""
    ctx.ensure_ready_sync()
    _track("channel_topology")
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    topo = _scan_l0_topology(src_root)
    if not topo:
        return "No L0.post/getLast patterns found in src/."

    if not start_channel.strip():
        return _format_full_channel_map(topo)

    return _format_cascade_trace(topo, start_channel.strip())


def _format_full_channel_map(topo: dict) -> str:
    """Full channel map sorted by total activity."""
    out = [f"# L0 Channel Map  ({len(topo)} channels)\n"]
    sorted_chs = sorted(topo.items(),
                        key=lambda kv: len(kv[1]["producers"]) + len(kv[1]["consumers"]),
                        reverse=True)
    for ch, data in sorted_chs:
        prods = data["producers"]
        cons  = data["consumers"]
        loops = set(prods) & set(cons)
        loop_s = f"  LOOP: {', '.join(sorted(loops))}" if loops else ""
        sem = _CHANNEL_SEMANTICS.get(ch, "")
        sem_s = f"  -- {sem}" if sem else ""
        out.append(f"## {ch}  ({len(prods)} producers, {len(cons)} consumers){loop_s}{sem_s}")
        if prods:
            out.append(f"  POST: {', '.join(sorted(prods))}")
        if cons:
            out.append(f"  READ: {', '.join(sorted(cons))}")
        out.append("")

    hubs = [(ch, len(d["consumers"])) for ch, d in topo.items() if len(d["consumers"]) >= 4]
    if hubs:
        out.append("## Broadcast Hubs  (>=4 consumers)")
        for ch, n_c in sorted(hubs, key=lambda x: -x[1]):
            out.append(f"  {ch:<30} -> {n_c} consumers")
        out.append("")

    dead_ends = [
        (ch, d["producers"])
        for ch, d in topo.items()
        if d["producers"] and not d["consumers"]
        and ch not in _INFRA_CHANNELS
    ]
    if dead_ends:
        out.append("## Signal Dead-ends  (posted but NEVER consumed -- prime evolution targets)")
        out.append("Adding consumers creates new coupling paths.\n")
        for ch, prods in sorted(dead_ends, key=lambda x: x[0]):
            sem = _CHANNEL_SEMANTICS.get(ch, "unknown signal type")
            out.append(f"  {ch:<30} posted by: {', '.join(sorted(prods))}")
            out.append(f"    carries: {sem}")
        out.append("")

    orphans = [
        (ch, d["consumers"])
        for ch, d in topo.items()
        if d["consumers"] and not d["producers"]
    ]
    if orphans:
        out.append("## Orphan Channels  (consumed but never posted -- stale reads or missed producers)")
        for ch, cons in sorted(orphans, key=lambda x: x[0]):
            out.append(f"  {ch:<30} read by: {', '.join(sorted(cons))}")
    return "\n".join(out)


def _count_direct_callers(module_name: str) -> int:
    """Count how many files directly import/call a module (not via L0)."""
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    # Match the module name as a function call or property access
    pat = re.compile(r'\b' + re.escape(module_name) + r'\b')
    count = 0
    for dirpath, _, filenames in os.walk(src_root):
        for fname in filenames:
            if not fname.endswith(".js") or fname == "index.js":
                continue
            # Don't count self-references
            if fname.replace(".js", "") == module_name:
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, encoding="utf-8", errors="ignore") as f:
                    if pat.search(f.read()):
                        count += 1
            except Exception:
                continue
    return count


def _format_cascade_trace(topo: dict, ch: str) -> str:
    """Cascade trace from a specific channel up to 3 hops deep."""
    if ch not in topo:
        return (f"Channel '{ch}' not found. Known channels: "
                + ", ".join(sorted(topo.keys())[:20]) + " ...")

    sem = _CHANNEL_SEMANTICS.get(ch, "")
    sem_s = f"  -- {sem}" if sem else ""
    out = [f"# L0 Cascade: {ch}{sem_s}\n"]
    visited_channels: set = set()

    # For the top-level channel, show producer bypass analysis
    prods_top = topo[ch].get("producers", [])
    cons_top = topo[ch].get("consumers", [])
    if prods_top:
        for prod in prods_top:
            direct = _count_direct_callers(prod)
            l0_cons = len(cons_top)
            if direct > l0_cons * 2:
                out.append(f"  ⚡ BYPASS ALERT: {prod} has {direct} direct callers but "
                           f"only {l0_cons} L0 consumers on '{ch}'")
                out.append(f"     {direct - l0_cons} modules bypass L0 — signal not observable\n")

    def _show_level(channels: list, depth: int) -> None:
        if depth > 3 or not channels:
            return
        indent = "  " * depth
        for c in sorted(set(channels) - visited_channels):
            visited_channels.add(c)
            data = topo.get(c, {})
            prods = data.get("producers", [])
            cons  = data.get("consumers", [])
            loop_s = " loop" if set(prods) & set(cons) else ""
            out.append(f"{indent}> {c}  [posted by: {', '.join(sorted(prods)) or '?'}]{loop_s}")
            if cons:
                out.append(f"{indent}  consumers: {', '.join(sorted(cons))}")
                downstream: list = []
                for consumer in cons:
                    for other_ch, other_data in topo.items():
                        if consumer in other_data.get("producers", []) and other_ch != c:
                            downstream.append(other_ch)
                if downstream and depth < 3:
                    out.append(f"{indent}  -> downstream channels: {', '.join(sorted(set(downstream)))}")
                    _show_level(list(set(downstream)), depth + 1)
            out.append("")

    _show_level([ch], 0)
    return "\n".join(out)
