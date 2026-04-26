"""HME coupling subpackage -- unified router and public mode functions,
lives in __init__.py so the subpackage exposes the hub API directly
(avoiding the sys.modules alias that breaks importlib.reload).

Split into focused modules:
  coupling_data.py     -- trust scores, coupling state, module detection, Pearson
  coupling_channels.py -- L0 channel topology and cascade tracing
  coupling_clusters.py -- cooperation clusters and coupling network
  coupling_bridges.py  -- antagonism bridge intelligence and leverage analysis
"""
import logging
import re
from collections import Counter, defaultdict

from server import context as ctx
from .. import _track

logger = logging.getLogger("HME")

# Re-export everything that other modules import from the subpackage.
from .coupling_data import (  # noqa: F401
    _pearson, _TRUST_FILE_ALIASES, _FILE_TRUST_ALIASES,
    _scan_coupling_state, _load_trust_scores,
    ALL_RHYTHM_FIELDS, ALL_MELODIC_DIMS,
)
from .coupling_channels import _scan_l0_topology, channel_topology  # noqa: F401
from .coupling_clusters import (  # noqa: F401
    _compute_clusters, coupling_network, cluster_finder,
)
from .coupling_bridges import (  # noqa: F401
    get_top_bridges, antagonism_leverage, _get_bridge_cache,
)


def antagonist_map() -> str:
    """Show all negative correlation pairs (r < -0.20)."""
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
    out.append("These modules resist each other -- their friction produces the alien quality.\n")

    for a, b, r in antagonists[:20]:
        ta = trust.get(a)
        tb = trust.get(b)
        ta_str = f"t={ta:.2f}" if ta is not None else "t=?"
        tb_str = f"t={tb:.2f}" if tb is not None else "t=?"
        bar = "<" * min(int(abs(r) * 10), 8)
        out.append(f"  r={r:+.3f} {bar}  {a} ({ta_str}) <-> {b} ({tb_str})")

    cnt: Counter = Counter()
    for a, b, r in antagonists:
        if abs(r) >= 0.30:
            cnt[a] += 1
            cnt[b] += 1
    if cnt:
        out.append(f"\n## Most Antagonistic Modules (in >=1 strong tension pair)")
        for name, count in cnt.most_common(8):
            t = trust.get(name)
            t_str = f"{t:.2f}" if t is not None else "?"
            out.append(f"  {name:<35} {count} antagonisms  trust={t_str}")

    return "\n".join(out)


def cluster_personality() -> str:
    """Musical biography of each cooperation cluster."""
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
            out.append(f"  Tightest bond: {bond_pair[0]} <-> {bond_pair[1]} (r={max_r:.3f})")
        if top_ant:
            out.append(f"  Primary antagonist: {top_ant[0]} (r={top_ant[1]:.3f})")
        out.append("")

    return "\n".join(out)


def dimension_gap_finder() -> str:
    """Find underused melodic/rhythmic signal dimensions."""
    ctx.ensure_ready_sync()
    _track("dimension_gap_finder")

    from .coupling_data import _scan_coupling_state, _load_trust_scores
    import os
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

    ALL_MELODIC = [
        "ascendRatio", "contourShape", "counterpoint", "directionBias",
        "freshnessEma", "intervalFreshness", "registerMigrationDir",
        "tessituraLoad", "thematicDensity",
    ]

    out = ["# Dimension Gap Finder\n"]
    out.append("## Melodic Dimension Coverage")
    all_melodic = sorted(set(list(dim_usage.keys()) + ALL_MELODIC), key=lambda d: len(dim_usage.get(d, [])))
    for dim in all_melodic:
        users = dim_usage.get(dim, [])
        bar = "x" * len(users) if users else "-"
        gap = "  <- UNDERUSED" if len(users) < 3 else ""
        out.append(f"  {dim:<28} x{len(users):2}  {bar}{gap}")
        if 0 < len(users) < 3:
            out.append(f"    only: {', '.join(users)}")

    out.append("\n## Rhythmic Field Coverage")
    for field in ALL_RHYTHM_FIELDS:
        users = rhythm_field_usage.get(field, [])
        bar = "x" * len(users) if users else "-"
        gap = "  <- UNDERUSED" if len(users) < 3 else ""
        out.append(f"  {field:<28} x{len(users):2}  {bar}{gap}")

    underused_melodic = [d for d in ALL_MELODIC if len(dim_usage.get(d, [])) < 3]
    underused_rhythm = [f for f in ALL_RHYTHM_FIELDS if len(rhythm_field_usage.get(f, [])) < 3]

    if underused_melodic or underused_rhythm:
        out.append(f"\n## Highest-Yield Targets")
        if underused_melodic:
            out.append(f"  Underused melodic dims: {', '.join(underused_melodic)}")
        if underused_rhythm:
            out.append(f"  Underused rhythm fields: {', '.join(underused_rhythm)}")

        uncoupled_mods = [(n, trust.get(n, 0.0)) for n, info in coupling.items()
                         if not info.get("melodic") and not info.get("rhythm")]
        uncoupled_mods.sort(key=lambda x: -x[1])
        if uncoupled_mods:
            out.append(f"  Top uncoupled modules: {', '.join(n for n, _ in uncoupled_mods[:6])}")

    return "\n".join(out)


def bridge_ledger() -> str:
    """Bridge completion ledger -- confirmed bridges vs proposed, per pair."""
    try:
        bridges = get_top_bridges(n=8)
    except Exception as e:
        return f"Bridge ledger unavailable: {e}"
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
    except Exception as _err:
        logger.debug(f"unnamed-except coupling/__init__.py bridge_ledger: {type(_err).__name__}: {_err}")
        all_kb = []

    def _pair_kb_refs(a: str, b: str) -> list[dict]:
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
            round_match = re.search(r"R(\d+)", title)
            if round_match:
                confirmed_rounds.append(f"R{round_match.group(1)}")
        already = set(x.lower() for x in b.get("already_bridged", []))
        proposed = b.get("field", "")
        out.append(f"## {a_name} [{b['arch_a']}] <-> {b_name} [{b['arch_b']}]  r={b['r']:+.3f}")
        out.append(f"  KB rounds mentioning this pair: {', '.join(sorted(set(confirmed_rounds))) or 'none'}")
        out.append(f"  Confirmed bridged fields: {', '.join(sorted(already)) or 'none'}")
        out.append(f"  Next proposed bridge: `{proposed}` ({'DONE' if proposed.lower() in already else 'open'})")
        out.append(f"  Saturation: {len(already)} field(s) bridged")
        out.append("")

    return "\n".join(out)


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
        return "\n\n\n\n".join(parts)
    if mode == "network":
        return coupling_network(clusters=True)
    if mode == "clusters":
        return cluster_finder()
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
    return f"Unknown mode '{mode}'. Use 'full', 'network', 'clusters', 'antagonists', 'personalities', 'gaps', 'leverage', 'channels', 'cascade:channelName', or 'ledger'."
