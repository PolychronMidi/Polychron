"""HME coupling intelligence — topology, clusters, and evolution rut detection."""
import json
import os
import re
from collections import defaultdict
import logging

from server import context as ctx
from . import _track, _load_trace

logger = logging.getLogger("HME")


# Trust system name → crossLayer file name aliases (names differ between trust registry and filesystem)
_TRUST_FILE_ALIASES: dict[str, str] = {
    "climaxEngine": "crossLayerClimaxEngine",
    "roleSwap": "dynamicRoleSwap",
    "restSync": "restSynchronizer",
    # R72: additional aliases discovered via cluster analysis
    "phaseLock": "rhythmicPhaseLock",
    "convergence": "convergenceDetector",
    "dynamicEnvelope": "crossLayerDynamicEnvelope",
    "rhythmicComplement": "rhythmicComplementEngine",
    "motifEcho": "motifEcho",  # same name, explicit for clarity
}
_FILE_TRUST_ALIASES: dict[str, str] = {v: k for k, v in _TRUST_FILE_ALIASES.items()}


def _pearson(xs: list, ys: list) -> float:
    """Compute Pearson correlation without numpy."""
    n = len(xs)
    if n < 10:
        return 0.0
    sx = sum(xs)
    sy = sum(ys)
    sx2 = sum(x * x for x in xs)
    sy2 = sum(y * y for y in ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    num = n * sxy - sx * sy
    denom_sq = (n * sx2 - sx ** 2) * (n * sy2 - sy ** 2)
    if denom_sq <= 0:
        return 0.0
    return num / (denom_sq ** 0.5)


def _scan_l0_topology(src_root: str) -> dict:
    """Scan ALL JS source files for L0.post / L0.getLast patterns.
    Resolves const CHANNEL = '...' assignments so variable-name channels are captured.
    Returns {channel: {producers: [module, ...], consumers: [module, ...]}}."""
    topology: dict = defaultdict(lambda: {"producers": [], "consumers": []})
    # Match string literal: L0.post/getLast/findClosest('channel', ...)
    _post_lit  = re.compile(r"L0\.post\(\s*['\"]([^'\"]+)['\"]")
    _get_lit   = re.compile(r"L0\.(?:getLast|findClosest|getAll|query|count|getBounds)\(\s*['\"]([^'\"]+)['\"]")
    # Match variable: L0.post(VARNAME, ...) where VARNAME is a plain identifier
    _post_var  = re.compile(r"L0\.post\(\s*([A-Z_][A-Z0-9_]*)\s*,")
    _get_var   = re.compile(r"L0\.(?:getLast|findClosest|getAll|query|count|getBounds)\(\s*([A-Z_][A-Z0-9_]*)\s*,")
    # Match const/let CHANNEL_VAR = 'value'
    _const_re  = re.compile(r"(?:const|let)\s+([A-Z_][A-Z0-9_]*)\s*=\s*['\"]([^'\"]+)['\"]")

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
            # Build local constant map for this file
            consts: dict[str, str] = {k: v for k, v in _const_re.findall(content)}
            # String literals
            for ch in _post_lit.findall(content):
                if module_name not in topology[ch]["producers"]:
                    topology[ch]["producers"].append(module_name)
            for ch in _get_lit.findall(content):
                if module_name not in topology[ch]["consumers"]:
                    topology[ch]["consumers"].append(module_name)
            # Variable references — resolve via consts
            for var in _post_var.findall(content):
                ch = consts.get(var)
                if ch and module_name not in topology[ch]["producers"]:
                    topology[ch]["producers"].append(module_name)
            for var in _get_var.findall(content):
                ch = consts.get(var)
                if ch and module_name not in topology[ch]["consumers"]:
                    topology[ch]["consumers"].append(module_name)
    return dict(topology)


def channel_topology(start_channel: str = "") -> str:
    """Show the L0 channel signal graph. No argument → full channel map (producers + consumers for
    every channel). With start_channel → cascade trace: follow the signal from that channel through
    its consumers and their downstream output channels up to 3 hops deep."""
    ctx.ensure_ready_sync()
    _track("channel_topology")
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    topo = _scan_l0_topology(src_root)
    if not topo:
        return "No L0.post/getLast patterns found in src/."

    # Musical semantics for L0 channel names — what each signal carries
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

    if not start_channel.strip():
        # Full channel map sorted by total activity (producers + consumers)
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
        # Broadcast hubs (channels with many consumers — high broadcast impact)
        hubs = [(ch, len(d["consumers"])) for ch, d in topo.items() if len(d["consumers"]) >= 4]
        if hubs:
            out.append("## Broadcast Hubs  (>=4 consumers)")
            for ch, n_c in sorted(hubs, key=lambda x: -x[1]):
                out.append(f"  {ch:<30} -> {n_c} consumers")
            out.append("")
        # Dead-end channels — dynamic detection
        # Infrastructure channels that are consumed by non-JS systems (MIDI, audio, UI)
        _INFRA_CHANNELS = {"rest-sync", "section-quality", "binaural", "instrument", "note"}
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
        # Orphan channels — consumed but never posted (stale consumers)
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

    # Cascade trace from start_channel
    ch = start_channel.strip()
    if ch not in topo:
        return (f"Channel '{ch}' not found. Known channels: "
                + ", ".join(sorted(topo.keys())[:20]) + " ...")

    sem = _CHANNEL_SEMANTICS.get(ch, "")
    sem_s = f"  -- {sem}" if sem else ""
    out = [f"# L0 Cascade: {ch}{sem_s}\n"]
    visited_channels: set = set()

    def _show_level(channels: list, depth: int) -> None:
        if depth > 3 or not channels:
            return
        indent = "  " * depth
        for c in sorted(set(channels) - visited_channels):
            visited_channels.add(c)
            data = topo.get(c, {})
            prods = data.get("producers", [])
            cons  = data.get("consumers", [])
            loop_s = " ⟳" if set(prods) & set(cons) else ""
            out.append(f"{indent}▸ {c}  [posted by: {', '.join(sorted(prods)) or '?'}]{loop_s}")
            if cons:
                out.append(f"{indent}  consumers: {', '.join(sorted(cons))}")
                # Find output channels of each consumer
                downstream: list = []
                for consumer in cons:
                    for other_ch, other_data in topo.items():
                        if consumer in other_data.get("producers", []) and other_ch != c:
                            downstream.append(other_ch)
                if downstream and depth < 3:
                    out.append(f"{indent}  → downstream channels: {', '.join(sorted(set(downstream)))}")
                    _show_level(list(set(downstream)), depth + 1)
            out.append("")

    _show_level([ch], 0)
    return "\n".join(out)


def _scan_coupling_state(src_root: str) -> dict:
    """Return per-module coupling state for all crossLayer JS files."""
    cl_dir = os.path.join(src_root, "crossLayer")
    results = {}
    if not os.path.isdir(cl_dir):
        return results

    for dirpath, _, filenames in os.walk(cl_dir):
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

            melodic_coupled = "emergentMelodicEngine" in content
            # Detect rhythmic coupling via emergentRhythmEngine reference OR
            # L0.getLast('emergentRhythm') pattern (R69+ coupling style)
            rhythm_coupled = (
                "emergentRhythmEngine" in content
                or "L0.getLast('emergentRhythm'" in content
                or 'L0.getLast("emergentRhythm"' in content
            )
            # Detect phase coupling: reads rhythmicPhaseLock.getMode() (R78+)
            phase_coupled = "rhythmicPhaseLock.getMode()" in content

            melodic_dims: list[str] = []
            if melodic_coupled:
                # Match: melodicCtxXX.contourShape, melodicCtx?.counterpoint etc.
                dims = re.findall(r'melodicCtx\w*\s*(?:\?\.|\.)(\w+)', content)
                melodic_dims = sorted(d for d in set(dims)
                                      if d not in {"call", "getContext", "getMelodicWeights",
                                                   "getContourAscendBias", "nudgeNoveltyWeight"})

            _KNOWN_RHYTHM_FIELDS = {"density", "complexity", "biasStrength", "densitySurprise", "hotspots", "complexityEma"}
            rhythm_dims: list[str] = []
            if rhythm_coupled:
                # Old style: rhythmCtx variable (direct emergentRhythmEngine access)
                dims = re.findall(r'rhythmCtx\w*\s*(?:\?\.|\.)(\w+)', content)
                # New style: rhythmEntry variable (L0.getLast pattern, R69+)
                dims += re.findall(r'rhythmEntry\w*\.(\w+)', content)
                # Legacy: emergentEntry variable (pre-R69 naming, e.g. convergenceDetector R50)
                dims += re.findall(r'emergentEntry\w*\.(\w+)', content)
                rhythm_dims = sorted(d for d in set(dims) if d in _KNOWN_RHYTHM_FIELDS)

            results[module_name] = {
                "path": fpath,
                "melodic": melodic_coupled,
                "melodic_dims": melodic_dims,
                "rhythm": rhythm_coupled,
                "rhythm_dims": rhythm_dims,
                "phase": phase_coupled,
            }

    return results


def _load_trust_scores(project_root: str) -> dict:
    """Load ALL per-module trust scores from trace-summary.json.
    Uses trustScoreAbs (full avg scores for all systems), falling back to
    trustDominance.dominantSystems (top 3 only)."""
    summary_path = os.path.join(project_root, "metrics", "trace-summary.json")
    if not os.path.isfile(summary_path):
        return {}
    try:
        with open(summary_path) as f:
            summary = json.load(f)
        # Primary: trustScoreAbs has ALL systems with avg scores
        score_abs = summary.get("trustScoreAbs", {})
        if isinstance(score_abs, dict) and score_abs:
            return {name: round(data.get("avg", 0), 3)
                    for name, data in score_abs.items()
                    if isinstance(data, dict)}
        # Fallback: trustDominance (top 3 only)
        dom = summary.get("trustDominance", {})
        if isinstance(dom, dict):
            systems = dom.get("dominantSystems", [])
            return {s["system"]: round(s.get("score", 0), 3)
                    for s in systems if isinstance(s, dict) and "system" in s}
        return {}
    except Exception:
        return {}


def _detect_traced_modules(project_root: str) -> set:
    """Return set of module names that appear in trace.jsonl trust data."""
    trace_path = os.path.join(project_root, "metrics", "trace.jsonl")
    found: set = set()
    if not os.path.isfile(trace_path):
        return found
    try:
        with open(trace_path, encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i > 20:
                    break  # sample first 20 beats
                rec = json.loads(line)
                for sys_name in rec.get("trust", {}):
                    found.add(sys_name)
                    if sys_name in _TRUST_FILE_ALIASES:
                        found.add(_TRUST_FILE_ALIASES[sys_name])  # resolve to file-based name
    except Exception:
        pass
    return found


def _detect_kb_covered_modules(project_root: str) -> set:
    """Return set of module names mentioned in KB entries."""
    found: set = set()
    try:
        all_entries = ctx.project_engine.search_knowledge("module", top_k=100)
        for entry in all_entries:
            text = (entry.get("title", "") + " " + entry.get("content", "")[:300]).lower()
            # Match camelCase module names in KB text
            for m in re.findall(r'[a-z][a-zA-Z]{8,}', text):
                found.add(m)
    except Exception:
        pass
    return found


def _detect_documented_modules(project_root: str) -> set:
    """Return set of module names mentioned in ARCHITECTURE.md or TUNING_MAP.md."""
    found: set = set()
    for doc in ["doc/ARCHITECTURE.md", "doc/TUNING_MAP.md"]:
        path = os.path.join(project_root, doc)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                content = f.read().lower()
            for m in re.findall(r'[a-z][a-zA-Z]{8,}', content):
                found.add(m)
        except Exception:
            pass
    return found


def _compute_clusters(min_r: float = 0.35) -> tuple:
    """Compute cooperation clusters from trace data. Returns (clusters, corr, modules, n_beats, coupling_state, trust)."""
    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    try:
        records = _load_trace(trace_path)
    except Exception:
        return None, {}, [], 0, {}, {}

    if len(records) < 50:
        return None, {}, [], 0, {}, {}

    n_beats = len(records)
    beat_scores: list[dict] = []
    for rec in records:
        bd = {}
        trust_data = rec.get("trust", {})
        for sys_name, data in trust_data.items():
            if isinstance(data, dict):
                s = data.get("score")
                if isinstance(s, (int, float)):
                    bd[sys_name] = float(s)
        beat_scores.append(bd)

    module_counts: dict[str, int] = defaultdict(int)
    for bd in beat_scores:
        for m_name in bd:
            module_counts[m_name] += 1
    active_modules = [m_name for m_name, c in module_counts.items() if c >= n_beats * 0.8]

    if len(active_modules) < 4:
        return None, {}, active_modules, n_beats, {}, {}

    raw: dict[str, list] = {m_name: [] for m_name in active_modules}
    for bd in beat_scores:
        for m_name in active_modules:
            raw[m_name].append(bd.get(m_name))

    series: dict[str, list[float]] = {}
    for m_name, vals in raw.items():
        present = [v for v in vals if v is not None]
        mean = sum(present) / len(present) if present else 0.5
        series[m_name] = [v if v is not None else mean for v in vals]

    modules = list(series.keys())
    nm = len(modules)

    corr: dict[tuple, float] = {}
    for i in range(nm):
        for j in range(i + 1, nm):
            a, b = modules[i], modules[j]
            r = _pearson(series[a], series[b])
            corr[(a, b)] = r
            corr[(b, a)] = r

    coop_adj: dict[str, set] = {m_name: set() for m_name in modules}
    for i in range(nm):
        for j in range(i + 1, nm):
            a, b = modules[i], modules[j]
            r = corr.get((a, b), 0)
            if r >= min_r:
                coop_adj[a].add(b)
                coop_adj[b].add(a)

    visited: set = set()
    clusters: list[list] = []
    for start in modules:
        if start in visited:
            continue
        cluster = []
        stack = [start]
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            cluster.append(node)
            stack.extend(coop_adj[node] - visited)
        if len(cluster) >= 2:
            clusters.append(cluster)

    trust = _load_trust_scores(ctx.PROJECT_ROOT)
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    coupling_state = _scan_coupling_state(src_root)

    def avg_trust(c: list) -> float:
        scores = [trust.get(m_name, 0.0) for m_name in c]
        return sum(scores) / len(scores) if scores else 0.0

    clusters.sort(key=avg_trust, reverse=True)
    return clusters, corr, modules, n_beats, coupling_state, trust


def _format_clusters(clusters, corr, modules, n_beats, coupling_state, trust, min_r=0.35) -> list[str]:
    """Format cluster analysis as output lines."""
    out = [f"## Cooperation Clusters  (r>={min_r}, {len(modules)} modules, {n_beats} beats)\n"]

    if clusters is None:
        out.append("  *Insufficient trace data for cluster analysis.*")
        return out

    out.append(f"Found {len(clusters)} cluster(s)\n")

    def avg_trust(c: list) -> float:
        scores = [trust.get(m_name, 0.0) for m_name in c]
        return sum(scores) / len(scores) if scores else 0.0

    for idx, cluster in enumerate(clusters[:5]):
        at = avg_trust(cluster)
        cluster_sorted = sorted(cluster, key=lambda m_name: trust.get(m_name, 0.0), reverse=True)

        out.append(f"### Cluster {idx + 1}  avg_trust={at:.2f}  ({len(cluster)} members)")
        for m_name in cluster_sorted:
            t = trust.get(m_name)
            t_str = f"{t:.2f}" if t is not None else "  ?"
            # Resolve trust-name aliases to file-based coupling state (e.g. climaxEngine → crossLayerClimaxEngine)
            file_name = _TRUST_FILE_ALIASES.get(m_name, m_name)
            info = coupling_state.get(m_name, {}) or coupling_state.get(file_name, {})
            display_name = file_name if file_name != m_name else m_name
            has_m = bool(info.get("melodic"))
            has_r = bool(info.get("rhythm"))
            has_p = bool(info.get("phase"))
            _base = "[M+R]" if has_m and has_r else "[MEL]" if has_m else "[RHY]" if has_r else "[---]"
            tag = _base[:-1] + "+P]" if has_p and _base != "[---]" else ("[PHZ]" if has_p else _base)

            others = [o for o in cluster if o != m_name]
            top2 = sorted(others, key=lambda o: corr.get((m_name, o), 0), reverse=True)[:2]
            r_strs = "  ".join(f"r={corr.get((m_name, o), 0):+.2f}->{o}" for o in top2)

            out.append(f"  {tag} {display_name:<35} trust={t_str}  {r_strs}")

        targets = [_TRUST_FILE_ALIASES.get(m_name, m_name) for m_name in cluster_sorted
                   if not (coupling_state.get(m_name, {}) or coupling_state.get(_TRUST_FILE_ALIASES.get(m_name, m_name), {})).get("melodic")
                   and not (coupling_state.get(m_name, {}) or coupling_state.get(_TRUST_FILE_ALIASES.get(m_name, m_name), {})).get("rhythm")]
        if targets:
            out.append(f"  >> Uncoupled: {', '.join(targets[:8])}")

        centroid = cluster_sorted[0]
        antagonists = [(m_name, corr.get((centroid, m_name), 0)) for m_name in modules if m_name not in cluster]
        antagonists = sorted(antagonists, key=lambda x: x[1])[:3]
        ant_str = "  ".join(f"{m_name}({r:+.2f})" for m_name, r in antagonists if r < -0.20)
        if ant_str:
            out.append(f"  << Antagonists to {centroid}: {ant_str}")

        out.append("")

    return out


def coupling_network(clusters: bool = False) -> str:
    """Show the full melodic/rhythmic coupling topology for all crossLayer modules.
    Internal helper — call via coupling_intel(mode='network') or coupling_intel(mode='full')."""
    ctx.ensure_ready_sync()
    _track("coupling_network")

    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    coupling = _scan_coupling_state(src_root)
    trust = _load_trust_scores(ctx.PROJECT_ROOT)

    coupled_melodic = []
    coupled_rhythm = []
    coupled_both = []
    uncoupled = []

    for name, info in sorted(coupling.items()):
        score = trust.get(name)
        score_str = f"{score:.2f}" if score is not None else "  ?"
        entry = (name, score or 0.0, score_str, info)
        if info["melodic"] and info["rhythm"]:
            coupled_both.append(entry)
        elif info["melodic"]:
            coupled_melodic.append(entry)
        elif info["rhythm"]:
            coupled_rhythm.append(entry)
        else:
            uncoupled.append(entry)

    for lst in [coupled_melodic, coupled_rhythm, coupled_both, uncoupled]:
        lst.sort(key=lambda x: -x[1])

    total = len(coupling)
    n_melodic_only = len(coupled_melodic)
    n_rhythm_only = len(coupled_rhythm)
    n_both = len(coupled_both)
    n_any = n_melodic_only + n_rhythm_only + n_both
    n_uncoupled = len(uncoupled)

    n_phase = sum(1 for _, _, _, info in coupled_melodic + coupled_rhythm + coupled_both + uncoupled if info.get("phase"))
    out = [f"# Coupling Network ({total} crossLayer modules)\n"]
    out.append(f"Melodic-coupled: {n_melodic_only + n_both} | "
               f"Rhythm-coupled: {n_rhythm_only + n_both} | "
               f"Both: {n_both} | Phase-coupled: {n_phase} | Uncoupled: {n_uncoupled}")
    out.append(f"Coverage: {n_any / total:.0%} have at least one engine coupling\n")

    if coupled_both:
        out.append("## Dual-Coupled (melodic + rhythmic)")
        for name, _, score_str, info in coupled_both:
            dims_m = ", ".join(info["melodic_dims"]) or "?"
            dims_r = ", ".join(info["rhythm_dims"]) or "?"
            out.append(f"  {name:<35} trust={score_str}  M=[{dims_m}]  R=[{dims_r}]")
        out.append("")

    if coupled_melodic:
        out.append("## Melodically Coupled (emergentMelodicEngine)")
        for name, _, score_str, info in coupled_melodic:
            dims = ", ".join(info["melodic_dims"]) or "?"
            out.append(f"  {name:<35} trust={score_str}  dims=[{dims}]")
        out.append("")

    if coupled_rhythm:
        out.append("## Rhythmically Coupled (emergentRhythmEngine)")
        for name, _, score_str, info in coupled_rhythm:
            dims = ", ".join(info["rhythm_dims"]) or "?"
            out.append(f"  {name:<35} trust={score_str}  dims=[{dims}]")
        out.append("")

    if uncoupled:
        out.append(f"## Uncoupled ({n_uncoupled} modules) — by trust score (top = next priority)")
        for name, _, score_str, info in uncoupled:
            phase_mark = " [PHZ]" if info.get("phase") else ""
            out.append(f"  {name:<35} trust={score_str}{phase_mark}")
        out.append("")

    # Phase coupling section (R78+ — rhythmicPhaseLock.getMode() consumers)
    phase_coupled_all = [(name, score or 0.0, score_str, info)
                         for name, score, score_str, info in coupled_melodic + coupled_rhythm + coupled_both + uncoupled
                         if info.get("phase")]
    if phase_coupled_all:
        out.append(f"## Phase-Coupled (rhythmicPhaseLock.getMode(), R78+, {len(phase_coupled_all)} modules)")
        for name, _, score_str, _ in sorted(phase_coupled_all, key=lambda x: -x[1]):
            out.append(f"  {name:<35} trust={score_str}")
        out.append("")
    else:
        out.append("## Phase-Coupled: none yet (add rhythmicPhaseLock.getMode() reads to link phase mode)\n")

    # Dimension coverage audit — which melodic dimensions are under-used?
    all_melodic_dims: dict[str, list] = defaultdict(list)
    for name, _, _, info in coupled_melodic + coupled_both:
        for d in info["melodic_dims"]:
            all_melodic_dims[d].append(name)

    if all_melodic_dims:
        out.append("## Melodic Dimension Coverage (all coupled modules)")
        for dim, users in sorted(all_melodic_dims.items(), key=lambda x: -len(x[1])):
            out.append(f"  {dim:<28} x{len(users):2}  {', '.join(users[:6])}")
        out.append("")

    # Blind spot audit — flag uncoupled modules with missing KB/trace/docs
    trace_modules = _detect_traced_modules(ctx.PROJECT_ROOT)
    kb_modules = _detect_kb_covered_modules(ctx.PROJECT_ROOT)
    doc_modules = _detect_documented_modules(ctx.PROJECT_ROOT)

    blind_spots: list[tuple[str, list[str]]] = []
    for name, _, score_str, _ in uncoupled:
        gaps = []
        if name not in trace_modules:
            gaps.append("no-trace")
        if name not in kb_modules:
            gaps.append("no-KB")
        if name not in doc_modules:
            gaps.append("no-docs")
        if gaps:
            blind_spots.append((name, gaps))

    if blind_spots:
        out.append(f"## Blind Spots ({len(blind_spots)} uncoupled modules with intelligence gaps)")
        for name, gaps in sorted(blind_spots, key=lambda x: -len(x[1])):
            out.append(f"  {name:<35} [{', '.join(gaps)}]")
        out.append("")

    # Cluster analysis (optional, loads trace data)
    if clusters:
        cl, corr, mods, nb, cs, tr = _compute_clusters()
        out.extend(_format_clusters(cl, corr, mods, nb, cs, tr))

    return "\n".join(out)


def cluster_finder(min_r: float = 0.35) -> str:
    """Internal: cooperation cluster analysis. Use coupling_network(clusters=True) instead."""
    cl, corr, mods, nb, cs, tr = _compute_clusters(min_r)
    return "\n".join(_format_clusters(cl, corr, mods, nb, cs, tr, min_r))


def _get_bridge_cache() -> dict:
    """Session cache for get_top_bridges — keyed by (trace_mtime, coupling_state_hash).
    Eliminates redundant _compute_clusters() calls when before_editing + module_intel both invoke bridges."""
    if not hasattr(ctx, "_bridge_cache"):
        ctx._bridge_cache = {}
    return ctx._bridge_cache


def get_top_bridges(n: int = 3) -> list:
    """Return top N antagonist bridge opportunities as structured dicts for injection into other tools.
    Each dict: {pair_a, pair_b, r, arch_a, arch_b, field, eff_a, eff_b, why, already_bridged}.
    Results cached per trace.jsonl mtime to avoid repeated O(n^2) Pearson computation."""
    try:
        # Cache key: trace file mtime (changes per pipeline run) + coupling state mtime
        trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
        trace_mtime = os.path.getmtime(trace_path) if os.path.isfile(trace_path) else 0
        src_root_b = os.path.join(ctx.PROJECT_ROOT, "src")
        # Use crossLayer dir mtime as a proxy for coupling state freshness
        cl_dir = os.path.join(src_root_b, "crossLayer")
        cl_mtime = os.path.getmtime(cl_dir) if os.path.isdir(cl_dir) else 0
        cache_key = (trace_mtime, cl_mtime, n)
        _bridge_cache = _get_bridge_cache()
        if cache_key in _bridge_cache:
            return _bridge_cache[cache_key]

        clusters, corr, modules, n_beats, coupling_state, trust = _compute_clusters()
        if not corr:
            return []
        src_root = os.path.join(ctx.PROJECT_ROOT, "src")
        if not coupling_state:
            coupling_state = _scan_coupling_state(src_root)
        ALL_RHYTHM_FIELDS = ["densitySurprise", "hotspots", "complexityEma", "biasStrength", "complexity", "density"]
        ALL_MELODIC_DIMS  = ["contourShape", "registerMigrationDir", "tessituraLoad", "thematicDensity",
                             "counterpoint", "intervalFreshness", "ascendRatio", "freshnessEma"]
        rhythm_field_users: dict = defaultdict(list)
        melodic_dim_users: dict = defaultdict(list)
        for name, info in coupling_state.items():
            for f in info.get("rhythm_dims", []):
                rhythm_field_users[f].append(name)
            for d in info.get("melodic_dims", []):
                melodic_dim_users[d].append(name)
        _ARCHETYPES_B = {
            "entropy": ("chaos", "spikes entropy"), "silhouette": ("form", "sharpens tracking"),
            "gravity": ("timing", "strengthens gravity"), "mirror": ("balance", "amplifies contrast"),
            "complement": ("balance", "boosts complement"), "cadence": ("pulse", "tightens cadence"),
            "convergence": ("pulse", "raises merge probability"), "phase": ("phase", "tightens phase lock"),
            "envelope": ("dynamics", "raises amplitude"), "climax": ("arc", "accelerates climax"),
            "role": ("dynamics", "lowers swap threshold"), "groove": ("transfer", "boosts groove"),
            "stutter": ("articulation", "raises contagion"), "vertical": ("harmony", "raises collision penalty"),
            "velocity": ("dynamics", "scales interference"), "motif": ("memory", "boosts echo"),
            "articulation": ("articulation", "scales contrast"), "feedback": ("resonance", "amplifies feedback"),
            "rest": ("breath", "widens rest window"), "harmonic": ("harmony", "narrows novelty hunting"),
        }
        _FIELD_GUIDE_B: dict = {
            "densitySurprise": {"chaos_up": "spikes entropy at surprise", "order_up": "sharpens form tracking",
                                "bridge_why": "surprise events drive chaos spike AND structural sharpening simultaneously"},
            "hotspots": {"chaos_up": "raise entropy at density peaks", "order_up": "intensify suggestion weight",
                         "bridge_why": "dense grid positions pull all geometry inward while entropy erupts"},
            "complexityEma": {"chaos_up": "amplify entropy modulation rate", "order_up": "slow tracking (stable arc = stable form)",
                              "bridge_why": "complexity memory: chaos accelerates, form stabilises — slow-fast coupling"},
            "ascendRatio": {"chaos_up": "rising phrases → spike entropy", "order_up": "ascending arc tightens structural hold",
                            "bridge_why": "ascending momentum: chaos rides the climb, structure braces for landing"},
            "freshnessEma": {"chaos_up": "novel intervals → raise entropy target", "order_up": "novel intervals demand structural anchoring",
                             "bridge_why": "melodic novelty: chaos diversifies into the unknown, form holds the ground"},
            "registerMigrationDir": {"chaos_up": "upward migration amplifies entropy", "order_up": "register shift raises swap/role opportunity",
                                     "bridge_why": "register transition: entropy leaps into new territory, roles reorganise"},
        }
        def _arch(name: str) -> tuple:
            n_low = name.lower()
            for key, val in _ARCHETYPES_B.items():
                if key.lower() in n_low:
                    return val
            return ("module", f"modulates {name}")
        def _score(field: str, used_a: bool, used_b: bool) -> float:
            if used_a or used_b:
                return -1.0
            return 1.0 / (1 + len(rhythm_field_users.get(field, [])) + len(melodic_dim_users.get(field, [])))
        def _recipe(arch_a: tuple, arch_b: tuple, field: str) -> tuple:
            g = _FIELD_GUIDE_B.get(field, {})
            chaos_types = {"chaos", "resonance", "articulation", "transfer"}
            a_chaos = arch_a[0] in chaos_types
            b_chaos = arch_b[0] in chaos_types
            if a_chaos and not b_chaos:
                return g.get("chaos_up", arch_a[1]), g.get("order_up", arch_b[1])
            if b_chaos and not a_chaos:
                return g.get("order_up", arch_a[1]), g.get("chaos_up", arch_b[1])
            return f"{arch_a[1]} scales with {field}", f"{arch_b[1]} inverts with {field}"
        seen: set = set()
        pairs: list = []
        for (a, b), r in corr.items():
            key = tuple(sorted([a, b]))
            if key not in seen and r < -0.30:
                seen.add(key)
                pairs.append((a, b, r))
        pairs.sort(key=lambda x: x[2])
        results = []
        for a, b, r in pairs[:n * 2]:  # over-sample, filter down to n
            fa = _TRUST_FILE_ALIASES.get(a, a); fb = _TRUST_FILE_ALIASES.get(b, b)
            ia = coupling_state.get(a, {}) or coupling_state.get(fa, {})
            ib = coupling_state.get(b, {}) or coupling_state.get(fb, {})
            used_a = set(ia.get("rhythm_dims", [])) | set(ia.get("melodic_dims", []))
            used_b = set(ib.get("rhythm_dims", [])) | set(ib.get("melodic_dims", []))
            already = sorted(used_a & used_b)
            arch_a = _arch(fa); arch_b = _arch(fb)
            all_f = ALL_RHYTHM_FIELDS + ALL_MELODIC_DIMS
            scored = sorted([(f, _score(f, f in used_a, f in used_b)) for f in all_f],
                            key=lambda x: -x[1])
            if not scored or scored[0][1] <= 0:
                continue
            top_f, _ = scored[0]
            eff_a, eff_b = _recipe(arch_a, arch_b, top_f)
            why = _FIELD_GUIDE_B.get(top_f, {}).get("bridge_why", "shared signal drives constructive opposition")
            results.append({"pair_a": a, "pair_b": b, "r": r, "arch_a": arch_a[0], "arch_b": arch_b[0],
                            "field": top_f, "eff_a": eff_a, "eff_b": eff_b, "why": why,
                            "already_bridged": already})
            if len(results) >= n:
                break
        _bridge_cache[cache_key] = results
        return results
    except Exception:
        return []


def antagonism_leverage(pair_limit: int = 6) -> str:
    """Analyse each top antagonist pair and recommend a shared coupling field that
    would amplify their creative opposition constructively. For each pair shows:
    existing dims, candidate bridge fields (used by neither), and a concrete
    opposing-response recipe with musical rationale."""
    ctx.ensure_ready_sync()
    _track("antagonism_leverage")

    clusters, corr, modules, n_beats, coupling_state, trust = _compute_clusters()
    if not corr:
        return "No trace data available. Run pipeline first."

    # Field coverage: how many modules already use each field (lower = more distinctive)
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    if not coupling_state:
        coupling_state = _scan_coupling_state(src_root)

    ALL_RHYTHM_FIELDS = ["densitySurprise", "hotspots", "complexityEma", "biasStrength", "complexity", "density"]
    ALL_MELODIC_DIMS  = ["contourShape", "registerMigrationDir", "tessituraLoad", "thematicDensity",
                         "counterpoint", "intervalFreshness", "ascendRatio", "freshnessEma"]

    rhythm_field_users: dict[str, list[str]] = defaultdict(list)
    melodic_dim_users:  dict[str, list[str]] = defaultdict(list)
    for name, info in coupling_state.items():
        for f in info.get("rhythm_dims", []):
            rhythm_field_users[f].append(name)
        for d in info.get("melodic_dims", []):
            melodic_dim_users[d].append(name)

    # Module "archetype" inference for musical effect descriptions
    _ARCHETYPES = {
        "entropy": ("chaos", "spikes entropy target"),
        "silhouette": ("form", "sharpens structural tracking"),
        "gravity": ("timing", "strengthens gravity wells"),
        "mirror": ("balance", "amplifies texture contrast"),
        "complement": ("balance", "boosts complement weight"),
        "cadence": ("pulse", "compresses cadence window"),
        "convergence": ("pulse", "raises merge probability"),
        "phase": ("phase", "tightens phase lock threshold"),
        "envelope": ("dynamics", "raises dynamic amplitude"),
        "climax": ("arc", "accelerates climax approach"),
        "role": ("dynamics", "lowers swap threshold"),
        "groove": ("transfer", "boosts groove transfer rate"),
        "stutter": ("articulation", "raises stutter contagion"),
        "vertical": ("harmony", "raises interval collision penalty"),
        "velocity": ("dynamics", "scales velocity interference"),
        "motif": ("memory", "boosts echo probability"),
        "articulation": ("articulation", "scales contrast strength"),
        "feedback": ("resonance", "amplifies feedback depth"),
        "rest": ("breath", "widens rest synchronization window"),
        "harmonic": ("harmony", "narrows novelty hunting"),
        "phaseLock": ("phase", "tightens phase lock threshold"),
        "dynamicEnvelope": ("dynamics", "raises dynamic amplitude"),
        "rhythmicComplement": ("balance", "boosts complement density"),
    }

    def _archetype(name: str) -> tuple[str, str]:
        n = name.lower()
        for key, val in _ARCHETYPES.items():
            if key.lower() in n:
                return val
        return ("module", f"modulates {name} behaviour")

    # Field→opposing-effects table: (chaos_response, order_response, neutral_response)
    _FIELD_GUIDE: dict[str, dict] = {
        "densitySurprise": {
            "signal": "unexpected density deviation (0–1)",
            "chaos_up":   "spike entropy / loosen constraint",
            "chaos_dn":   "amplify chaos further",
            "order_up":   "sharpen tracking / compress structure",
            "order_dn":   "dampen chaotic spread",
            "bridge_why": "surprise events should simultaneously increase chaos AND tighten structure — push-pull creates alien tension",
        },
        "hotspots": {
            "signal": "fraction of active grid slots (0–1)",
            "chaos_up":   "raise entropy target at density peaks",
            "chaos_dn":   "diversify pitch vocabulary",
            "order_up":   "strengthen gravity / intensify suggestion weight",
            "order_dn":   "suppress competing signals when grid is full",
            "bridge_why": "dense rhythmic moments should pull all geometry inward while structure firms up",
        },
        "complexityEma": {
            "signal": "long-term rhythmic complexity EMA (0–1)",
            "chaos_up":   "amplify entropy modulation rate",
            "chaos_dn":   "suppress entropy when complexity is stable",
            "order_up":   "slow tracking responsiveness (stable arc = stable form)",
            "order_dn":   "allow looser structure when complexity is low",
            "bridge_why": "complexity memory creates complementary slow-fast coupling: chaos accelerates, form stabilises",
        },
        "biasStrength": {
            "signal": "emergent rhythm bias confidence (0–1)",
            "chaos_up":   "amplify entropy injection on strong bias",
            "chaos_dn":   "raise disorder when rhythm is un-biased",
            "order_up":   "raise form correction gain on strong bias",
            "order_dn":   "loosen structure when bias is weak",
            "bridge_why": "rhythmic bias confidence drives both agents: order follows the pulse, chaos rebels against it",
        },
        "complexity": {
            "signal": "per-beat rhythmic complexity (0–1)",
            "chaos_up":   "raise entropy target with beat complexity",
            "chaos_dn":   "inject disorder during complex passages",
            "order_up":   "tighten silhouette smoothing (more complex = needs more structure)",
            "order_dn":   "relax structure during simple passages",
            "bridge_why": "complexity drives complementary responses: entropy opens up while form holds the container",
        },
        "density": {
            "signal": "normalised note density (0–1)",
            "chaos_up":   "raise entropy at high density",
            "chaos_dn":   "lower entropy at low density",
            "order_up":   "strengthen structural correction at high density",
            "order_dn":   "relax structural hold at low density",
            "bridge_why": "density is the shared currency: chaos and order both amplify around density peaks, pulling in opposite musical directions",
        },
        # melodic dims
        "contourShape": {
            "signal": "melodic contour direction (rising/flat/falling)",
            "chaos_up":   "rising contour raises entropy target",
            "chaos_dn":   "falling contour damps entropy",
            "order_up":   "rising contour sharpens form tracking",
            "order_dn":   "falling contour relaxes structure",
            "bridge_why": "melodic arc is a natural shared conductor: chaos and order both respond to the rise/fall",
        },
        "tessituraLoad": {
            "signal": "tessitura pressure 0–1 (extreme register)",
            "chaos_up":   "register extremes raise entropy target",
            "chaos_dn":   "settled register allows lower entropy",
            "order_up":   "extreme register demands stronger structural correction",
            "order_dn":   "settled register relaxes corrections",
            "bridge_why": "register extremity is both exciting and structurally stressful — dual coupling captures that tension",
        },
        "ascendRatio": {
            "signal": "fraction of ascending melodic intervals (0–1)",
            "chaos_up":   "rising phrases signal exploratory territory → spike entropy",
            "chaos_dn":   "descending phrases → settle entropy down",
            "order_up":   "ascending arc requires tighter structural hold (building toward peak)",
            "order_dn":   "descending arc → relax structural correction",
            "bridge_why": "ascending melodic momentum drives constructive opposition: chaos rides the climb, structure braces for landing",
        },
        "freshnessEma": {
            "signal": "EMA of melodic interval novelty (0=familiar, 1=novel)",
            "chaos_up":   "novel intervals signal uncharted territory → raise entropy target",
            "chaos_dn":   "familiar intervals → reduce entropy (settled ground)",
            "order_up":   "novel intervals demand stronger structural anchoring (unfamiliar = need for container)",
            "order_dn":   "familiar intervals → relax structural hold",
            "bridge_why": "melodic novelty triggers dual response: chaos diversifies into the unknown while form holds the ground beneath it",
        },
        "registerMigrationDir": {
            "signal": "register migration direction (ascending/descending/stable encoded as 1/−1/0)",
            "chaos_up":   "upward register migration amplifies entropy (new register = new possibilities)",
            "chaos_dn":   "downward migration settles entropy",
            "order_up":   "register shift raises swap/role threshold — liminal moments = role opportunity",
            "order_dn":   "stable register relaxes role assignments",
            "bridge_why": "register migration is a liminal transition: entropy leaps into new territory while roles/structure reorganise around the shift",
        },
    }

    def _field_score(field: str, used_by_a: bool, used_by_b: bool) -> float:
        """Lower uniqueness = higher score (virgin bridge preferred). Penalise already-used."""
        if used_by_a or used_by_b:
            return -1.0  # already used by one partner
        users = len(rhythm_field_users.get(field, [])) + len(melodic_dim_users.get(field, []))
        # Virgin field bonus; fewer total users = higher score
        return 1.0 / (1 + users)

    # Action-specific archetypes: use module action label instead of generic chaos/order description.
    # "articulation" and "transfer" modules have distinct behaviors (stutter spread, groove transfer)
    # that don't match the generic "spike entropy" chaos description.
    _ACTION_SPECIFIC_ARCHETYPES = {"articulation", "transfer", "breath", "resonance"}

    def _opposing_recipe(arch_a: tuple, arch_b: tuple, field: str) -> tuple[str, str]:
        """Return (effect_a, effect_b) for a constructive antagonism bridge."""
        g = _FIELD_GUIDE.get(field, {})
        chaos_types = {"chaos", "resonance", "articulation", "transfer"}
        # Secondary archetype groups for nuanced effect direction
        opening_types = {"dynamics", "timing", "memory", "transfer"}  # open up on signal
        closing_types = {"harmony", "pulse", "phase", "breath"}       # tighten on signal
        a_is_chaos = arch_a[0] in chaos_types
        b_is_chaos = arch_b[0] in chaos_types
        # Breath/pulse archetypes INVERT: they suppress when the chaos side rises
        _invert_archetypes = {"breath", "pulse", "phase"}

        _LABEL_INVERSIONS = {
            "widens": "suppresses", "opens": "closes",
            "expands": "contracts", "boosts": "reduces",
        }

        def _action_eff(arch: tuple, field: str, invert: bool = False) -> str:
            if arch[0] in _ACTION_SPECIFIC_ARCHETYPES:
                label = arch[1]
                if invert:
                    for fwd, rev in _LABEL_INVERSIONS.items():
                        label = label.replace(fwd, rev)
                    return f"{label} ↓ at high {field} (suppresses during chaos rise)"
                return f"{label} ↑ at high {field}"
            return ""

        if a_is_chaos and not b_is_chaos:
            # a opens/spikes, b tightens/sharpens
            eff_a = _action_eff(arch_a, field) or g.get("chaos_up") or f"{arch_a[1]} ↑ on high {field}"
            b_inverts = arch_b[0] in _invert_archetypes
            eff_b = _action_eff(arch_b, field, invert=b_inverts) or g.get("order_up") or f"{arch_b[1]} tightens on high {field}"
            return eff_a, eff_b
        if b_is_chaos and not a_is_chaos:
            # b opens/spikes, a tightens/sharpens
            a_inverts = arch_a[0] in _invert_archetypes
            eff_a = _action_eff(arch_a, field, invert=a_inverts) or g.get("order_up") or f"{arch_a[1]} tightens on high {field}"
            eff_b = _action_eff(arch_b, field) or g.get("chaos_up") or f"{arch_b[1]} ↑ on high {field}"
            return eff_a, eff_b
        # Both opening or both closing — create constructive complementarity
        # One partner amplifies on signal, the other SUPPRESSES (inverse response)
        a_opens = arch_a[0] in opening_types
        b_opens = arch_b[0] in opening_types
        if a_opens and not b_opens:
            return f"{arch_a[1]} scales UP with {field}", f"{arch_b[1]} scales DOWN with {field}"
        if b_opens and not a_opens:
            return f"{arch_a[1]} scales DOWN with {field}", f"{arch_b[1]} scales UP with {field}"
        # Truly same type: use signal direction to assign opposing phase
        return f"{arch_a[1]} ↑ at high {field}", f"{arch_b[1]} ↓ at high {field} (inverse)"

    # Collect top antagonist pairs
    seen: set = set()
    antagonists: list = []
    for (a, b), r in corr.items():
        key = tuple(sorted([a, b]))
        if key not in seen and r < -0.30:
            seen.add(key)
            antagonists.append((a, b, r))
    antagonists.sort(key=lambda x: x[2])

    out = [f"# Antagonism Leverage Analysis  ({len(antagonists)} strong pairs, {n_beats} beats)\n"]
    out.append("For each antagonist pair: candidate bridge fields that couple BOTH modules")
    out.append("to the SAME rhythmic/melodic signal with OPPOSING musical responses.\n")

    for a, b, r in antagonists[:pair_limit]:
        file_a = _TRUST_FILE_ALIASES.get(a, a)
        file_b = _TRUST_FILE_ALIASES.get(b, b)
        info_a = coupling_state.get(a, {}) or coupling_state.get(file_a, {})
        info_b = coupling_state.get(b, {}) or coupling_state.get(file_b, {})
        used_a = set(info_a.get("rhythm_dims", [])) | set(info_a.get("melodic_dims", []))
        used_b = set(info_b.get("rhythm_dims", [])) | set(info_b.get("melodic_dims", []))
        already_bridged = used_a & used_b  # fields BOTH use — may already be bridged
        ta = trust.get(a)
        tb = trust.get(b)
        ta_s = f"{ta:.2f}" if ta is not None else "?"
        tb_s = f"{tb:.2f}" if tb is not None else "?"
        arch_a = _archetype(file_a)
        arch_b = _archetype(file_b)
        bar = "◀" * min(int(abs(r) * 10), 8)
        out.append(f"## r={r:+.3f} {bar}  {a} (t={ta_s}) ↔ {b} (t={tb_s})")
        out.append(f"   archetypes: [{arch_a[0]}] vs [{arch_b[0]}]")
        out.append(f"   {a} dims: [{', '.join(sorted(used_a)) or 'none'}]")
        out.append(f"   {b} dims: [{', '.join(sorted(used_b)) or 'none'}]")
        if already_bridged:
            out.append(f"   Already bridged on: {', '.join(sorted(already_bridged))}")

        # Score candidate bridge fields
        all_fields = ALL_RHYTHM_FIELDS + ALL_MELODIC_DIMS
        scored = []
        for f in all_fields:
            score = _field_score(f, f in used_a, f in used_b)
            if score > 0:
                scored.append((f, score))
        scored.sort(key=lambda x: -x[1])

        if scored:
            out.append(f"   Bridge candidates (unused by both):")
            for field, score in scored[:4]:
                g = _FIELD_GUIDE.get(field, {})
                eff_a, eff_b = _opposing_recipe(arch_a, arch_b, field)
                why = g.get("bridge_why", "shared signal drives constructive opposition")
                sig = g.get("signal", field)
                users_n = len(rhythm_field_users.get(field, [])) + len(melodic_dim_users.get(field, []))
                out.append(f"   ▸ {field:<22} [{sig}]  ({users_n} existing users)")
                out.append(f"       {a}: {eff_a}")
                out.append(f"       {b}: {eff_b}")
                out.append(f"       why: {why}")
        else:
            out.append(f"   No virgin bridge fields — all signals already used by one partner.")
        out.append("")

    # Summary: most leverageable modules (appear in multiple antagonist pairs, high trust)
    ant_count: dict[str, int] = defaultdict(int)
    for a, b, _ in antagonists:
        ant_count[a] += 1
        ant_count[b] += 1
    out.append("## Most Leverageable Modules  (most antagonisms × highest trust)")
    for name in sorted(ant_count, key=lambda n: (-ant_count[n], -(trust.get(n) or 0)))[:6]:
        t = trust.get(name)
        t_s = f"{t:.2f}" if t is not None else "?"
        file_n = _TRUST_FILE_ALIASES.get(name, name)
        info = coupling_state.get(name, {}) or coupling_state.get(file_n, {})
        used = set(info.get("rhythm_dims", [])) | set(info.get("melodic_dims", []))
        out.append(f"  {name:<30} {ant_count[name]} pairs  trust={t_s}  dims=[{', '.join(sorted(used)) or 'none'}]")

    return "\n".join(out)


def antagonist_map() -> str:
    """Show all negative correlation pairs (r < -0.20). Internal helper — call via coupling_intel(mode='antagonists')."""
    ctx.ensure_ready_sync()
    _track("antagonist_map")

    clusters, corr, modules, n_beats, coupling_state, trust = _compute_clusters()
    if not corr:
        return "No trace data available for antagonist analysis. Run pipeline first."

    seen: set = set()
    antagonists: list = []
    for (a, b), r in corr.items():
        key = tuple(sorted([a, b]))
        if key not in seen and r < -0.20:
            seen.add(key)
            antagonists.append((a, b, r))
    antagonists.sort(key=lambda x: x[2])

    if not antagonists:
        return "No significant antagonist pairs found (r < -0.20)."

    out = [f"# Antagonist Map ({len(antagonists)} pairs with r < -0.20, {n_beats} beats)\n"]
    out.append("Creative tensions are the dark matter of xenolinguistic texture.")
    out.append("These modules resist each other — their friction produces the alien quality.\n")

    for a, b, r in antagonists[:20]:
        ta = trust.get(a)
        tb = trust.get(b)
        ta_str = f"t={ta:.2f}" if ta is not None else "t=?"
        tb_str = f"t={tb:.2f}" if tb is not None else "t=?"
        bar = "◀" * min(int(abs(r) * 10), 8)
        out.append(f"  r={r:+.3f} {bar}  {a} ({ta_str}) ↔ {b} ({tb_str})")

    from collections import Counter
    cnt: Counter = Counter()
    for a, b, r in antagonists:
        if abs(r) >= 0.30:
            cnt[a] += 1
            cnt[b] += 1
    if cnt:
        out.append(f"\n## Most Antagonistic Modules (in ≥1 strong tension pair)")
        for name, count in cnt.most_common(8):
            t = trust.get(name)
            t_str = f"{t:.2f}" if t is not None else "?"
            out.append(f"  {name:<35} {count} antagonisms  trust={t_str}")

    return "\n".join(out)


def cluster_personality() -> str:
    """Musical biography of each cooperation cluster. Internal helper — call via coupling_intel(mode='personalities')."""
    ctx.ensure_ready_sync()
    _track("cluster_personality")

    clusters, corr, modules, n_beats, coupling_state, trust = _compute_clusters()
    if clusters is None:
        return "No cluster data available. Run pipeline first."

    out = [f"# Cluster Personalities ({len(clusters)} emergent organisms, {n_beats} beats)\n"]

    for idx, cluster in enumerate(clusters[:5]):
        cluster_sorted = sorted(cluster, key=lambda m: trust.get(m, 0.0), reverse=True)
        avg_t = sum(trust.get(m, 0.0) for m in cluster) / len(cluster)
        leader = cluster_sorted[0]

        coupled_dims: list[str] = []
        rhythm_coupled_count = 0
        melodic_only_members: list[str] = []
        uncoupled_members: list[str] = []
        for m in cluster:
            file_name = _TRUST_FILE_ALIASES.get(m, m)
            info = coupling_state.get(m, {}) or coupling_state.get(file_name, {})
            has_m = bool(info.get("melodic"))
            has_r = bool(info.get("rhythm"))
            if has_m:
                coupled_dims.extend(info.get("melodic_dims", []))
            if has_r:
                rhythm_coupled_count += 1
            if has_m and not has_r:
                melodic_only_members.append(file_name)
            elif not has_m and not has_r:
                uncoupled_members.append(file_name)

        unique_dims = sorted(set(coupled_dims))

        max_r = 0.0
        bond_pair = ("", "")
        for i, a in enumerate(cluster):
            for b in cluster[i + 1:]:
                r = corr.get((a, b), 0.0)
                if r > max_r:
                    max_r = r
                    bond_pair = (a, b)

        antagonist_list = [(m, corr.get((leader, m), 0.0)) for m in modules if m not in cluster]
        antagonist_list.sort(key=lambda x: x[1])
        top_ant = antagonist_list[0] if antagonist_list and antagonist_list[0][1] < -0.20 else None

        out.append(f"## Organism {idx + 1}: {leader.upper()} cluster "
                   f"({len(cluster)} members, avg_trust={avg_t:.2f})")
        out.append(f"  Members: {', '.join(cluster_sorted)}")
        if unique_dims:
            out.append(f"  Melodic dims: [{', '.join(unique_dims[:8])}]")
        out.append(f"  Rhythm-coupled: {rhythm_coupled_count}/{len(cluster)} members")
        if melodic_only_members:
            out.append(f"  Melody-only (rhythm gap): {', '.join(melodic_only_members[:8])}")
        if uncoupled_members:
            out.append(f"  Fully uncoupled: {', '.join(uncoupled_members[:6])}")
        if bond_pair[0]:
            out.append(f"  Tightest bond: {bond_pair[0]} ↔ {bond_pair[1]} (r={max_r:.3f})")
        if top_ant:
            out.append(f"  Primary antagonist: {top_ant[0]} (r={top_ant[1]:.3f})")
        out.append("")

    return "\n".join(out)


def dimension_gap_finder() -> str:
    """Find underused melodic/rhythmic signal dimensions. Internal helper — call via coupling_intel(mode='gaps')."""
    ctx.ensure_ready_sync()
    _track("dimension_gap_finder")

    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    coupling = _scan_coupling_state(src_root)
    trust = _load_trust_scores(ctx.PROJECT_ROOT)

    dim_usage: dict[str, list[str]] = defaultdict(list)
    rhythm_field_usage: dict[str, list[str]] = defaultdict(list)
    for name, info in coupling.items():
        for d in info.get("melodic_dims", []):
            dim_usage[d].append(name)
        for d in info.get("rhythm_dims", []):
            rhythm_field_usage[d].append(name)

    ALL_MELODIC_DIMS = [
        "ascendRatio", "contourShape", "counterpoint", "directionBias",
        "freshnessEma", "intervalFreshness", "registerMigrationDir",
        "tessituraLoad", "thematicDensity",
    ]
    ALL_RHYTHM_FIELDS = ["density", "complexity", "biasStrength", "densitySurprise", "hotspots", "complexityEma"]

    out = ["# Dimension Gap Finder\n"]
    out.append("## Melodic Dimension Coverage")
    all_melodic = sorted(set(list(dim_usage.keys()) + ALL_MELODIC_DIMS), key=lambda d: len(dim_usage.get(d, [])))
    for dim in all_melodic:
        users = dim_usage.get(dim, [])
        bar = "█" * len(users) if users else "░"
        gap = "  ← UNDERUSED" if len(users) < 3 else ""
        out.append(f"  {dim:<28} x{len(users):2}  {bar}{gap}")
        if 0 < len(users) < 3:
            out.append(f"    only: {', '.join(users)}")

    out.append("\n## Rhythmic Field Coverage")
    for field in ALL_RHYTHM_FIELDS:
        users = rhythm_field_usage.get(field, [])
        bar = "█" * len(users) if users else "░"
        gap = "  ← UNDERUSED" if len(users) < 3 else ""
        out.append(f"  {field:<28} x{len(users):2}  {bar}{gap}")

    underused_melodic = [d for d in ALL_MELODIC_DIMS if len(dim_usage.get(d, [])) < 3]
    underused_rhythm = [f for f in ALL_RHYTHM_FIELDS if len(rhythm_field_usage.get(f, [])) < 3]

    if underused_melodic or underused_rhythm:
        out.append(f"\n## Highest-Yield Targets")
        if underused_melodic:
            out.append(f"  Underused melodic dims: {', '.join(underused_melodic)}")
        if underused_rhythm:
            out.append(f"  Underused rhythm fields: {', '.join(underused_rhythm)}")

        uncoupled = [(n, trust.get(n, 0.0)) for n, info in coupling.items()
                     if not info.get("melodic") and not info.get("rhythm")]
        uncoupled.sort(key=lambda x: -x[1])
        if uncoupled:
            out.append(f"  Top uncoupled modules: {', '.join(n for n, _ in uncoupled[:6])}")

    return "\n".join(out)


def bridge_ledger() -> str:
    """Bridge completion ledger — for each top antagonist pair, shows how many KB-confirmed
    bridges exist across rounds vs how many are still proposed. Answers 'how saturated is this pair?'"""
    try:
        bridges = get_top_bridges(n=8)
    except Exception as e:
        return f"Bridge ledger unavailable: {e}"
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
    except Exception:
        all_kb = []

    def _pair_kb_refs(a: str, b: str) -> list[dict]:
        """KB entries that mention both modules in the pair."""
        refs = []
        for k in all_kb:
            body = (k.get("title", "") + " " + k.get("content", "")).lower()
            if a.lower() in body and b.lower() in body:
                refs.append(k)
        return refs

    _FIELD_WORDS = {
        "complexityema", "densitysurprise", "freshnessema", "ascendratio", "tessituraload",
        "hotspots", "biasstrength", "thematicDensity", "intervalfreshness", "counterpoint",
        "contourshape", "registermigrationdir", "complexity", "density",
    }

    out = ["# Bridge Completion Ledger\n",
           "For each antagonist pair: confirmed KB bridges (implemented across rounds) vs proposed.\n"]

    seen_pairs: set = set()
    for b in bridges:
        pair_key = tuple(sorted([b["pair_a"], b["pair_b"]]))
        if pair_key in seen_pairs:
            continue
        seen_pairs.add(pair_key)
        a_name = _TRUST_FILE_ALIASES.get(b["pair_a"], b["pair_a"])
        b_name = _TRUST_FILE_ALIASES.get(b["pair_b"], b["pair_b"])
        kb_refs = _pair_kb_refs(a_name, b_name)
        confirmed_fields = set()
        confirmed_rounds = []
        for k in kb_refs:
            body = (k.get("title", "") + " " + k.get("content", "")).lower()
            for f in _FIELD_WORDS:
                if f in body:
                    confirmed_fields.add(f)
            title = k.get("title", "")
            round_match = __import__("re").search(r"R(\d+)", title)
            if round_match:
                confirmed_rounds.append(f"R{round_match.group(1)}")
        already = set(x.lower() for x in b.get("already_bridged", []))
        proposed = b.get("field", "")
        saturation = len(already | confirmed_fields)
        out.append(f"## {a_name} [{b['arch_a']}] ↔ {b_name} [{b['arch_b']}]  r={b['r']:+.3f}")
        out.append(f"  KB rounds mentioning this pair: {', '.join(sorted(set(confirmed_rounds))) or 'none'}")
        out.append(f"  Confirmed bridged fields: {', '.join(sorted(already | confirmed_fields)) or 'none'}")
        out.append(f"  Next proposed bridge: `{proposed}` ({'DONE' if proposed.lower() in (already | confirmed_fields) else 'open'})")
        out.append(f"  Saturation: {saturation} field(s) bridged")
        out.append("")

    return "\n".join(out)


@ctx.mcp.tool()
def coupling_intel(mode: str = "full") -> str:
    """Unified coupling intelligence hub. Replaces coupling_network + antagonist_map +
    cluster_personality + dimension_gap_finder. mode='full' (default): all four views in one
    call — topology, antagonist tensions, cluster biographies, dimension gaps. Use 'full' before
    planning a new coupling round: you get the complete picture in one shot.
    mode='network': coupling topology only (which modules are coupled to which engines, dims used,
    uncoupled sorted by trust). mode='antagonists': negative-correlation pairs (creative tensions,
    dark matter of alien texture). mode='personalities': cluster biographies (each cluster as
    emergent organism — members, dims, tightest bond, primary antagonist). mode='gaps': underused
    melodic/rhythmic dimensions sorted by coverage count (highest-yield next targets).
    mode='leverage': for each top antagonist pair, recommend the bridge field that creates
    maximum constructive opposition — with concrete opposing-response recipes and musical rationale.
    mode='channels': full L0 channel map — every channel with its producers, consumers, and loop
    detection. mode='cascade:channelName': cascade trace from a specific L0 channel — follow the
    signal through consumers and their downstream outputs up to 3 hops deep.
    mode='ledger': bridge completion ledger — confirmed KB bridges vs proposed, per pair."""
    ctx.ensure_ready_sync()
    _track("coupling_intel")
    if mode == "full":
        parts = [coupling_network(clusters=True), antagonist_map(), cluster_personality(), dimension_gap_finder()]
        return "\n\n---\n\n".join(parts)
    if mode == "network":
        return coupling_network(clusters=True)
    if mode == "antagonists":
        return antagonist_map()
    if mode == "personalities":
        return cluster_personality()
    if mode == "gaps":
        return dimension_gap_finder()
    if mode == "leverage":
        return antagonism_leverage()
    if mode == "channels":
        return channel_topology()
    if mode.startswith("cascade:"):
        return channel_topology(mode[len("cascade:"):])
    if mode == "ledger":
        return bridge_ledger()
    return f"Unknown mode '{mode}'. Use 'full', 'network', 'antagonists', 'personalities', 'gaps', 'leverage', 'channels', 'cascade:channelName', or 'ledger'."
