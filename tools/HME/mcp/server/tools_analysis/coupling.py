"""HME coupling intelligence — topology, clusters, and evolution rut detection."""
import json
import os
import re
from collections import defaultdict
import logging

from server import context as ctx
from . import _track, _load_trace

logger = logging.getLogger("HME")


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
            rhythm_coupled = "emergentRhythmEngine" in content

            melodic_dims: list[str] = []
            if melodic_coupled:
                # Match: melodicCtxXX.contourShape, melodicCtx?.counterpoint etc.
                dims = re.findall(r'melodicCtx\w*\s*(?:\?\.|\.)(\w+)', content)
                melodic_dims = sorted(d for d in set(dims)
                                      if d not in {"call", "getContext", "getMelodicWeights",
                                                   "getContourAscendBias", "nudgeNoveltyWeight"})

            rhythm_dims: list[str] = []
            if rhythm_coupled:
                dims = re.findall(r'rhythmCtx\w*\s*(?:\?\.|\.)(\w+)', content)
                rhythm_dims = sorted(d for d in set(dims) if d not in {"call"})

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


@ctx.mcp.tool()
def coupling_network() -> str:
    """Show the full melodic/rhythmic coupling topology for all crossLayer modules.
    Reveals which modules read emergentMelodicEngine or emergentRhythmEngine, which
    signal dimensions they use (contourShape, counterpoint, thematicDensity, etc.),
    and which are uncoupled sorted by trust score as evolution priority. One-call
    replacement for 10+ module_story calls when deciding what to couple next."""
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

    return "\n".join(out)


@ctx.mcp.tool()
def cluster_finder(min_r: float = 0.35) -> str:
    """Find cooperation clusters: groups of crossLayer modules whose trust scores
    consistently rise and fall together across beats. Surfaces uncoupled modules
    within high-trust clusters as top coupling candidates — coupled cluster-mates
    can pull the uncoupled module into the same musical logic. min_r sets the
    Pearson correlation threshold for cluster membership (default 0.35)."""
    ctx.ensure_ready_sync()
    _track("cluster_finder")

    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    try:
        records = _load_trace(trace_path)
    except Exception as e:
        return f"No trace data: {e}"

    if len(records) < 50:
        return "Insufficient trace data (need 50+ beats)."

    n_beats = len(records)

    # Collect aligned per-beat scores: beat_scores[beat_idx][module] = score
    beat_scores: list[dict] = []
    for rec in records:
        bd = {}
        trust = rec.get("trust", {})
        for sys_name, data in trust.items():
            if isinstance(data, dict):
                s = data.get("score")
                if isinstance(s, (int, float)):
                    bd[sys_name] = float(s)
        beat_scores.append(bd)

    # Modules present in >80% of beats
    module_counts: dict[str, int] = defaultdict(int)
    for bd in beat_scores:
        for m in bd:
            module_counts[m] += 1
    active_modules = [m for m, c in module_counts.items() if c >= n_beats * 0.8]

    if len(active_modules) < 4:
        return f"Too few active modules ({len(active_modules)}) — need 4+ with 80%+ beat coverage."

    # Build aligned series, filling missing values with per-module mean
    raw: dict[str, list] = {m: [] for m in active_modules}
    for bd in beat_scores:
        for m in active_modules:
            raw[m].append(bd.get(m))  # None = missing

    # Fill missing with mean
    series: dict[str, list[float]] = {}
    for m, vals in raw.items():
        present = [v for v in vals if v is not None]
        mean = sum(present) / len(present) if present else 0.5
        series[m] = [v if v is not None else mean for v in vals]

    modules = list(series.keys())
    nm = len(modules)

    # Compute all pairwise Pearson correlations
    corr: dict[tuple, float] = {}
    for i in range(nm):
        for j in range(i + 1, nm):
            a, b = modules[i], modules[j]
            r = _pearson(series[a], series[b])
            corr[(a, b)] = r
            corr[(b, a)] = r

    # Build adjacency for cooperation (r >= min_r) and competition (r <= -min_r)
    coop_adj: dict[str, set] = {m: set() for m in modules}
    for i in range(nm):
        for j in range(i + 1, nm):
            a, b = modules[i], modules[j]
            r = corr.get((a, b), 0)
            if r >= min_r:
                coop_adj[a].add(b)
                coop_adj[b].add(a)

    # Find connected components (cooperation clusters)
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
        scores = [trust.get(m, 0.0) for m in c]
        return sum(scores) / len(scores) if scores else 0.0

    clusters.sort(key=avg_trust, reverse=True)

    out = [f"# Cooperation Clusters  (r≥{min_r}, {nm} modules, {n_beats} beats)\n"]
    out.append(f"Found {len(clusters)} cooperation clusters\n")

    for idx, cluster in enumerate(clusters[:10]):
        at = avg_trust(cluster)
        # Sort cluster by trust
        cluster_sorted = sorted(cluster, key=lambda m: trust.get(m, 0.0), reverse=True)

        out.append(f"## Cluster {idx + 1}  avg_trust={at:.2f}  ({len(cluster)} members)")
        for m in cluster_sorted:
            t = trust.get(m)
            t_str = f"{t:.2f}" if t is not None else "  ?"
            info = coupling_state.get(m, {})
            if info.get("melodic") and info.get("rhythm"):
                tag = "[M+R]"
            elif info.get("melodic"):
                tag = "[MEL]"
            elif info.get("rhythm"):
                tag = "[RHY]"
            else:
                tag = "[---]"

            # Top 2 intra-cluster correlations
            others = [o for o in cluster if o != m]
            top2 = sorted(others, key=lambda o: corr.get((m, o), 0), reverse=True)[:2]
            r_strs = "  ".join(f"r={corr.get((m, o), 0):+.2f}→{o}" for o in top2)

            out.append(f"  {tag} {m:<35} trust={t_str}  {r_strs}")

        # Highlight uncoupled members with trust > 0.35
        targets = [m for m in cluster_sorted
                   if not coupling_state.get(m, {}).get("melodic")
                   and not coupling_state.get(m, {}).get("rhythm")
                   and trust.get(m, 0) > 0.35]
        if targets:
            out.append(f"  ⚡ Uncoupled targets: {', '.join(targets)}")

        # Show strongest antagonists (competitive with cluster centroid)
        centroid = cluster_sorted[0]  # highest-trust member
        antagonists = [(m, corr.get((centroid, m), 0)) for m in modules if m not in cluster]
        antagonists = sorted(antagonists, key=lambda x: x[1])[:3]
        ant_str = "  ".join(f"{m}({r:+.2f})" for m, r in antagonists if r < -0.20)
        if ant_str:
            out.append(f"  ⚔ Antagonists to {centroid}: {ant_str}")

        out.append("")

    return "\n".join(out)
