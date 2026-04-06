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
            }

    return results


def _load_trust_scores(project_root: str) -> dict:
    """Load latest per-module trust scores from trace-summary.json."""
    summary_path = os.path.join(project_root, "metrics", "trace-summary.json")
    if not os.path.isfile(summary_path):
        return {}
    try:
        with open(summary_path) as f:
            summary = json.load(f)
        dom = summary.get("trustDominance", {})
        if not isinstance(dom, dict):
            return {}
        systems = dom.get("dominantSystems", [])
        return {s["system"]: round(s.get("score", 0), 3)
                for s in systems if isinstance(s, dict) and "system" in s}
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
            tag = "[MEL]" if info.get("melodic") else "[---]"

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

    out = [f"# Coupling Network ({total} crossLayer modules)\n"]
    out.append(f"Melodic-coupled: {n_melodic_only + n_both} | "
               f"Rhythm-coupled: {n_rhythm_only + n_both} | "
               f"Both: {n_both} | Uncoupled: {n_uncoupled}")
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
            out.append(f"  {name:<35} trust={score_str}")
        out.append("")

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
        uncoupled_members: list[str] = []
        for m in cluster:
            file_name = _TRUST_FILE_ALIASES.get(m, m)
            info = coupling_state.get(m, {}) or coupling_state.get(file_name, {})
            if info.get("melodic"):
                coupled_dims.extend(info.get("melodic_dims", []))
            if info.get("rhythm"):
                rhythm_coupled_count += 1
            if not info.get("melodic") and not info.get("rhythm"):
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
    melodic/rhythmic dimensions sorted by coverage count (highest-yield next targets)."""
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
    return f"Unknown mode '{mode}'. Use 'full', 'network', 'antagonists', 'personalities', or 'gaps'."
