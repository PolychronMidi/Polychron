"""Cooperation cluster computation and coupling network analysis."""
import os
from collections import defaultdict

from server import context as ctx
from .. import _track, _load_trace
from .coupling_data import (
    _pearson, _TRUST_FILE_ALIASES,
    _scan_coupling_state, _load_trust_scores,
    _detect_traced_modules, _detect_kb_covered_modules, _detect_documented_modules,
)


_clusters_cache: dict = {"key": None, "result": None}


def _compute_clusters(min_r: float = 0.35) -> tuple:
    """Compute cooperation clusters from trace data. Cached by trace mtime + min_r.
    Returns (clusters, corr, modules, n_beats, coupling_state, trust)."""
    trace_path = os.path.join(ctx.PROJECT_ROOT, "output", "metrics", "trace.jsonl")
    try:
        _mt = os.path.getmtime(trace_path) if os.path.exists(trace_path) else 0.0
    except OSError:
        _mt = 0.0
    _cache_key = (_mt, min_r)
    if _clusters_cache["key"] == _cache_key and _clusters_cache["result"] is not None:
        return _clusters_cache["result"]

    try:
        records = _load_trace(trace_path)
    except Exception as _err:
        logger.debug(f"unnamed-except coupling_clusters.py:31: {type(_err).__name__}: {_err}")
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
    result = clusters, corr, modules, n_beats, coupling_state, trust
    _clusters_cache["key"] = _cache_key
    _clusters_cache["result"] = result
    return result


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
            file_name = _TRUST_FILE_ALIASES.get(m_name, m_name)
            info = coupling_state.get(m_name, {}) or coupling_state.get(file_name, {})
            display_name = file_name if file_name != m_name else m_name
            has_m = bool(info.get("melodic"))
            has_r = bool(info.get("rhythm"))
            has_p = bool(info.get("phase"))
            _base = "[M+R]" if has_m and has_r else "[MEL]" if has_m else "[RHY]" if has_r else "[]"
            tag = _base[:-1] + "+P]" if has_p and _base != "[]" else ("[PHZ]" if has_p else _base)

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
    """Show the full melodic/rhythmic coupling topology for all crossLayer modules."""
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
        score_str = f"{score:.2f}" if score is not None else "n/a "
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
        out.append(f"## Uncoupled ({n_uncoupled} modules) -- by trust score (top = next priority)")
        for name, _, score_str, info in uncoupled:
            phase_mark = " [PHZ]" if info.get("phase") else ""
            out.append(f"  {name:<35} trust={score_str}{phase_mark}")
        out.append("")

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

    all_melodic_dims: dict[str, list] = defaultdict(list)
    for name, _, _, info in coupled_melodic + coupled_both:
        for d in info["melodic_dims"]:
            all_melodic_dims[d].append(name)

    if all_melodic_dims:
        out.append("## Melodic Dimension Coverage (all coupled modules)")
        for dim, users in sorted(all_melodic_dims.items(), key=lambda x: -len(x[1])):
            out.append(f"  {dim:<28} x{len(users):2}  {', '.join(users[:6])}")
        out.append("")

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

    if clusters:
        cl, corr, mods, nb, cs, tr = _compute_clusters()
        out.extend(_format_clusters(cl, corr, mods, nb, cs, tr))

    return "\n".join(out)


def cluster_finder(min_r: float = 0.35) -> str:
    """Cooperation cluster analysis."""
    cl, corr, mods, nb, cs, tr = _compute_clusters(min_r)
    return "\n".join(_format_clusters(cl, corr, mods, nb, cs, tr, min_r))
