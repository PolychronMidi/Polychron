"""Antagonism bridge intelligence — leverage analysis, bridge cache, field guides, and design synthesis."""
import glob as _glob_mod
import logging
import os
import re
from collections import defaultdict

from server import context as ctx
from . import _track

logger = logging.getLogger("HME")
from .coupling_data import (
    _TRUST_FILE_ALIASES,
    _scan_coupling_state, _load_trust_scores,
    ALL_RHYTHM_FIELDS, ALL_MELODIC_DIMS,
)
from .coupling_clusters import _compute_clusters

# Module archetype inference for musical effect descriptions
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

# Field -> opposing-effects guide
_FIELD_GUIDE: dict[str, dict] = {
    "densitySurprise": {
        "signal": "unexpected density deviation (0-1)",
        "chaos_up":   "spike entropy / loosen constraint",
        "chaos_dn":   "amplify chaos further",
        "order_up":   "sharpen tracking / compress structure",
        "order_dn":   "dampen chaotic spread",
        "bridge_why": "surprise events should simultaneously increase chaos AND tighten structure -- push-pull creates alien tension",
    },
    "hotspots": {
        "signal": "fraction of active grid slots (0-1)",
        "chaos_up":   "raise entropy target at density peaks",
        "chaos_dn":   "diversify pitch vocabulary",
        "order_up":   "strengthen gravity / intensify suggestion weight",
        "order_dn":   "suppress competing signals when grid is full",
        "bridge_why": "dense rhythmic moments should pull all geometry inward while structure firms up",
    },
    "complexityEma": {
        "signal": "long-term rhythmic complexity EMA (0-1)",
        "chaos_up":   "amplify entropy modulation rate",
        "chaos_dn":   "suppress entropy when complexity is stable",
        "order_up":   "slow tracking responsiveness (stable arc = stable form)",
        "order_dn":   "allow looser structure when complexity is low",
        "bridge_why": "complexity memory creates complementary slow-fast coupling: chaos accelerates, form stabilises",
    },
    "biasStrength": {
        "signal": "emergent rhythm bias confidence (0-1)",
        "chaos_up":   "amplify entropy injection on strong bias",
        "chaos_dn":   "raise disorder when rhythm is un-biased",
        "order_up":   "raise form correction gain on strong bias",
        "order_dn":   "loosen structure when bias is weak",
        "bridge_why": "rhythmic bias confidence drives both agents: order follows the pulse, chaos rebels against it",
    },
    "complexity": {
        "signal": "per-beat rhythmic complexity (0-1)",
        "chaos_up":   "raise entropy target with beat complexity",
        "chaos_dn":   "inject disorder during complex passages",
        "order_up":   "tighten silhouette smoothing (more complex = needs more structure)",
        "order_dn":   "relax structure during simple passages",
        "bridge_why": "complexity drives complementary responses: entropy opens up while form holds the container",
    },
    "density": {
        "signal": "normalised note density (0-1)",
        "chaos_up":   "raise entropy at high density",
        "chaos_dn":   "lower entropy at low density",
        "order_up":   "strengthen structural correction at high density",
        "order_dn":   "relax structural hold at low density",
        "bridge_why": "density is the shared currency: chaos and order both amplify around density peaks, pulling in opposite musical directions",
    },
    "contourShape": {
        "signal": "melodic contour direction (rising/flat/falling)",
        "chaos_up":   "rising contour raises entropy target",
        "chaos_dn":   "falling contour damps entropy",
        "order_up":   "rising contour sharpens form tracking",
        "order_dn":   "falling contour relaxes structure",
        "bridge_why": "melodic arc is a natural shared conductor: chaos and order both respond to the rise/fall",
    },
    "tessituraLoad": {
        "signal": "tessitura pressure 0-1 (extreme register)",
        "chaos_up":   "register extremes raise entropy target",
        "chaos_dn":   "settled register allows lower entropy",
        "order_up":   "extreme register demands stronger structural correction",
        "order_dn":   "settled register relaxes corrections",
        "bridge_why": "register extremity is both exciting and structurally stressful -- dual coupling captures that tension",
    },
    "ascendRatio": {
        "signal": "fraction of ascending melodic intervals (0-1)",
        "chaos_up":   "rising phrases signal exploratory territory -> spike entropy",
        "chaos_dn":   "descending phrases -> settle entropy down",
        "order_up":   "ascending arc requires tighter structural hold (building toward peak)",
        "order_dn":   "descending arc -> relax structural correction",
        "bridge_why": "ascending melodic momentum drives constructive opposition: chaos rides the climb, structure braces for landing",
    },
    "freshnessEma": {
        "signal": "EMA of melodic interval novelty (0=familiar, 1=novel)",
        "chaos_up":   "novel intervals signal uncharted territory -> raise entropy target",
        "chaos_dn":   "familiar intervals -> reduce entropy (settled ground)",
        "order_up":   "novel intervals demand stronger structural anchoring (unfamiliar = need for container)",
        "order_dn":   "familiar intervals -> relax structural hold",
        "bridge_why": "melodic novelty triggers dual response: chaos diversifies into the unknown while form holds the ground beneath it",
    },
    "registerMigrationDir": {
        "signal": "register migration direction (ascending/descending/stable encoded as 1/-1/0)",
        "chaos_up":   "upward register migration amplifies entropy (new register = new possibilities)",
        "chaos_dn":   "downward migration settles entropy",
        "order_up":   "register shift raises swap/role threshold -- liminal moments = role opportunity",
        "order_dn":   "stable register relaxes role assignments",
        "bridge_why": "register migration is a liminal transition: entropy leaps into new territory while roles/structure reorganise around the shift",
    },
}


def _archetype(name: str) -> tuple[str, str]:
    n = name.lower()
    for key, val in _ARCHETYPES.items():
        if key.lower() in n:
            return val
    return ("module", f"modulates {name} behaviour")


def _get_bridge_cache() -> dict:
    """Session cache for get_top_bridges."""
    if not hasattr(ctx, "_bridge_cache"):
        ctx._bridge_cache = {}
    return ctx._bridge_cache


def get_top_bridges(n: int = 3, threshold: float = -0.30) -> list:
    """Return top N antagonist bridge opportunities as structured dicts.
    Each dict: {pair_a, pair_b, r, arch_a, arch_b, field, eff_a, eff_b, why, already_bridged}.
    threshold: r-value cutoff (default -0.30 for global views; pass -0.20 for module-specific
    lookups to surface weaker-but-real virgin tensions like feedbackOscillator↔motifEcho)."""
    try:
        trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
        trace_mtime = os.path.getmtime(trace_path) if os.path.isfile(trace_path) else 0
        src_root_b = os.path.join(ctx.PROJECT_ROOT, "src")
        cl_dir = os.path.join(src_root_b, "crossLayer")
        cl_mtime = os.path.getmtime(cl_dir) if os.path.isdir(cl_dir) else 0
        cache_key = (trace_mtime, cl_mtime, n, threshold)
        _bridge_cache = _get_bridge_cache()
        if cache_key in _bridge_cache:
            return _bridge_cache[cache_key]

        clusters, corr, modules, n_beats, coupling_state, trust = _compute_clusters()
        if not corr:
            return []
        src_root = os.path.join(ctx.PROJECT_ROOT, "src")
        if not coupling_state:
            coupling_state = _scan_coupling_state(src_root)

        rhythm_field_users: dict = defaultdict(list)
        melodic_dim_users: dict = defaultdict(list)
        for name, info in coupling_state.items():
            for f in info.get("rhythm_dims", []):
                rhythm_field_users[f].append(name)
            for d in info.get("melodic_dims", []):
                melodic_dim_users[d].append(name)

        # Compact archetype/recipe helpers (get_top_bridges version)
        _ARCHETYPES_B = {k: v for k, v in _ARCHETYPES.items()}

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
            g = _FIELD_GUIDE.get(field, {})
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
            if key not in seen and r < threshold:
                seen.add(key)
                pairs.append((a, b, r))
        pairs.sort(key=lambda x: x[2])

        results = []
        for a, b, r in pairs[:n * 2]:
            fa = _TRUST_FILE_ALIASES.get(a, a)
            fb = _TRUST_FILE_ALIASES.get(b, b)
            ia = coupling_state.get(a, {}) or coupling_state.get(fa, {})
            ib = coupling_state.get(b, {}) or coupling_state.get(fb, {})
            used_a = set(ia.get("rhythm_dims", [])) | set(ia.get("melodic_dims", []))
            used_b = set(ib.get("rhythm_dims", [])) | set(ib.get("melodic_dims", []))
            already = sorted(used_a & used_b)
            arch_a = _arch(fa)
            arch_b = _arch(fb)
            all_f = ALL_RHYTHM_FIELDS + ALL_MELODIC_DIMS
            scored = sorted([(f, _score(f, f in used_a, f in used_b)) for f in all_f],
                            key=lambda x: -x[1])
            if not scored or scored[0][1] <= 0:
                continue
            top_f, _ = scored[0]
            eff_a, eff_b = _recipe(arch_a, arch_b, top_f)
            why = _FIELD_GUIDE.get(top_f, {}).get("bridge_why", "shared signal drives constructive opposition")
            results.append({"pair_a": a, "pair_b": b, "r": r, "arch_a": arch_a[0], "arch_b": arch_b[0],
                            "field": top_f, "eff_a": eff_a, "eff_b": eff_b, "why": why,
                            "already_bridged": already})
            if len(results) >= n:
                break
        _bridge_cache[cache_key] = results
        return results
    except Exception as _err:
        logger.debug(f"unnamed-except coupling_bridges.py:246: {type(_err).__name__}: {_err}")
        return []


def antagonism_leverage(pair_limit: int = 6) -> str:
    """Analyse each top antagonist pair and recommend a shared coupling field that
    would amplify their creative opposition constructively."""
    ctx.ensure_ready_sync()
    _track("antagonism_leverage")

    clusters, corr, modules, n_beats, coupling_state, trust = _compute_clusters()
    if not corr:
        return "No trace data available. Run pipeline first."

    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    if not coupling_state:
        coupling_state = _scan_coupling_state(src_root)

    rhythm_field_users: dict[str, list[str]] = defaultdict(list)
    melodic_dim_users:  dict[str, list[str]] = defaultdict(list)
    for name, info in coupling_state.items():
        for f in info.get("rhythm_dims", []):
            rhythm_field_users[f].append(name)
        for d in info.get("melodic_dims", []):
            melodic_dim_users[d].append(name)

    def _field_score(field: str, used_by_a: bool, used_by_b: bool) -> float:
        if used_by_a or used_by_b:
            return -1.0
        users = len(rhythm_field_users.get(field, [])) + len(melodic_dim_users.get(field, []))
        return 1.0 / (1 + users)

    _ACTION_SPECIFIC_ARCHETYPES = {"articulation", "transfer", "breath", "resonance"}

    _LABEL_INVERSIONS = {
        "widens": "suppresses", "opens": "closes",
        "expands": "contracts", "boosts": "reduces",
    }

    def _opposing_recipe(arch_a: tuple, arch_b: tuple, field: str) -> tuple[str, str]:
        g = _FIELD_GUIDE.get(field, {})
        chaos_types = {"chaos", "resonance", "articulation", "transfer"}
        opening_types = {"dynamics", "timing", "memory", "transfer"}
        closing_types = {"harmony", "pulse", "phase", "breath"}
        a_is_chaos = arch_a[0] in chaos_types
        b_is_chaos = arch_b[0] in chaos_types
        _invert_archetypes = {"breath", "pulse", "phase"}

        def _action_eff(arch: tuple, fld: str, invert: bool = False) -> str:
            if arch[0] in _ACTION_SPECIFIC_ARCHETYPES:
                label = arch[1]
                if invert:
                    for fwd, rev in _LABEL_INVERSIONS.items():
                        label = label.replace(fwd, rev)
                    return f"{label} down at high {fld} (suppresses during chaos rise)"
                return f"{label} up at high {fld}"
            return ""

        if a_is_chaos and not b_is_chaos:
            eff_a = _action_eff(arch_a, field) or g.get("chaos_up") or f"{arch_a[1]} up on high {field}"
            b_inverts = arch_b[0] in _invert_archetypes
            eff_b = _action_eff(arch_b, field, invert=b_inverts) or g.get("order_up") or f"{arch_b[1]} tightens on high {field}"
            return eff_a, eff_b
        if b_is_chaos and not a_is_chaos:
            a_inverts = arch_a[0] in _invert_archetypes
            eff_a = _action_eff(arch_a, field, invert=a_inverts) or g.get("order_up") or f"{arch_a[1]} tightens on high {field}"
            eff_b = _action_eff(arch_b, field) or g.get("chaos_up") or f"{arch_b[1]} up on high {field}"
            return eff_a, eff_b
        a_opens = arch_a[0] in opening_types
        b_opens = arch_b[0] in opening_types
        if a_opens and not b_opens:
            return f"{arch_a[1]} scales UP with {field}", f"{arch_b[1]} scales DOWN with {field}"
        if b_opens and not a_opens:
            return f"{arch_a[1]} scales DOWN with {field}", f"{arch_b[1]} scales UP with {field}"
        return f"{arch_a[1]} up at high {field}", f"{arch_b[1]} down at high {field} (inverse)"

    seen: set = set()
    antagonists: list = []
    for (a, b), r in corr.items():
        key = tuple(sorted([a, b]))
        if key not in seen and r < -0.30:
            seen.add(key)
            antagonists.append((a, b, r))
    antagonists.sort(key=lambda x: x[2])

    # Build KB round index for staleness tracking
    _kb_pair_rounds: dict[str, list[str]] = defaultdict(list)
    try:
        all_kb = ctx.project_engine.list_knowledge_full() or []
        for entry in all_kb:
            title = (entry.get("title", "") or "").lower()
            content = (entry.get("content", "") or "").lower()
            text = title + " " + content
            # Extract round number from title (e.g., "R85: ...")
            import re as _re_kb
            round_match = _re_kb.search(r'\bR(\d+)\b', entry.get("title", "") or "")
            round_label = f"R{round_match.group(1)}" if round_match else None
            if not round_label:
                continue
            # Check which pairs are mentioned
            for a_name, b_name, _ in antagonists[:pair_limit]:
                a_low = a_name.lower().replace("_", "")
                b_low = b_name.lower().replace("_", "")
                if (a_low in text or _TRUST_FILE_ALIASES.get(a_name, "").lower() in text) and \
                   (b_low in text or _TRUST_FILE_ALIASES.get(b_name, "").lower() in text):
                    pair_key = f"{a_name}:{b_name}"
                    if round_label not in _kb_pair_rounds[pair_key]:
                        _kb_pair_rounds[pair_key].append(round_label)
    except Exception as _err1:
        logger.debug(f'silent-except coupling_bridges.py:354: {type(_err1).__name__}: {_err1}')

    # Get latest round number for staleness computation
    _latest_round = 0
    try:
        journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
        if os.path.isfile(journal_path):
            import re as _re_j
            with open(journal_path, encoding="utf-8") as _jf:
                first_match = _re_j.search(r'\bR(\d+)\b', _jf.read(500))
                if first_match:
                    _latest_round = int(first_match.group(1))
    except Exception as _err2:
        logger.debug(f'silent-except coupling_bridges.py:367: {type(_err2).__name__}: {_err2}')

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
        already_bridged = used_a & used_b
        ta = trust.get(a)
        tb = trust.get(b)
        ta_s = f"{ta:.2f}" if ta is not None else "?"
        tb_s = f"{tb:.2f}" if tb is not None else "?"
        arch_a = _archetype(file_a)
        arch_b = _archetype(file_b)
        bar = "<" * min(int(abs(r) * 10), 8)
        n_bridged = len(already_bridged)
        saturation = "VIRGIN" if n_bridged == 0 else (f"SATURATED ({n_bridged})" if n_bridged >= 3 else f"{n_bridged} bridged")
        out.append(f"## r={r:+.3f} {bar}  {a} (t={ta_s}) <-> {b} (t={tb_s})  [{saturation}]")
        out.append(f"   archetypes: [{arch_a[0]}] vs [{arch_b[0]}]")
        # KB staleness annotation
        pair_key = f"{a}:{b}"
        kb_rounds = _kb_pair_rounds.get(pair_key, [])
        if kb_rounds:
            last_round_num = max(int(r_str[1:]) for r_str in kb_rounds if r_str[1:].isdigit())
            rounds_ago = _latest_round - last_round_num if _latest_round else 0
            staleness = "" if rounds_ago <= 3 else f" ⚠ {rounds_ago} rounds stale" if rounds_ago <= 10 else f" 🔴 {rounds_ago} rounds stale — may need re-evaluation"
            out.append(f"   KB history: {', '.join(sorted(kb_rounds))}{staleness}")
        else:
            out.append(f"   KB history: none — unexplored pair (high discovery potential)")
        out.append(f"   {a} dims: [{', '.join(sorted(used_a)) or 'none'}]")
        out.append(f"   {b} dims: [{', '.join(sorted(used_b)) or 'none'}]")
        if already_bridged:
            out.append(f"   Already bridged on: {', '.join(sorted(already_bridged))}")

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
                base_why = g.get("bridge_why", "shared signal drives constructive opposition")
                why = f"{a} <-> {b}: {base_why}"
                sig = g.get("signal", field)
                users_n = len(rhythm_field_users.get(field, [])) + len(melodic_dim_users.get(field, []))
                out.append(f"   > {field:<22} [{sig}]  ({users_n} existing users)")
                out.append(f"       {a}: {eff_a}")
                out.append(f"       {b}: {eff_b}")
                out.append(f"       why: {why}")
        else:
            out.append(f"   No virgin bridge fields -- all signals already used by one partner.")
        out.append("")

    ant_count: dict[str, int] = defaultdict(int)
    for a, b, _ in antagonists:
        ant_count[a] += 1
        ant_count[b] += 1
    out.append("## Most Leverageable Modules  (most antagonisms x highest trust)")
    for name in sorted(ant_count, key=lambda n: (-ant_count[n], -(trust.get(n) or 0)))[:6]:
        t = trust.get(name)
        t_s = f"{t:.2f}" if t is not None else "?"
        file_n = _TRUST_FILE_ALIASES.get(name, name)
        info = coupling_state.get(name, {}) or coupling_state.get(file_n, {})
        used = set(info.get("rhythm_dims", [])) | set(info.get("melodic_dims", []))
        out.append(f"  {name:<30} {ant_count[name]} pairs  trust={t_s}  dims=[{', '.join(sorted(used)) or 'none'}]")

    return "\n".join(out)


def _read_module_src(module_name: str, max_chars: int = 2000) -> str:
    """Read module source for bridge design context."""
    for pattern in [
        os.path.join(ctx.PROJECT_ROOT, "src", "**", f"{module_name}.js"),
        os.path.join(ctx.PROJECT_ROOT, "tools", "**", f"{module_name}.py"),
    ]:
        matches = _glob_mod.glob(pattern, recursive=True)
        if matches:
            try:
                with open(matches[0], encoding="utf-8", errors="ignore") as f:
                    return f.read()[:max_chars]
            except Exception as _err3:
                logger.debug(f'silent-except coupling_bridges.py:460: {type(_err3).__name__}: {_err3}')
    return f"(source for {module_name} not found)"


def _algorithmic_fallback(b: dict, pair_a: str, pair_b: str) -> str:
    """Generate a bridge design from the field guide when synthesis fails."""
    field = b["field"]
    g = _FIELD_GUIDE.get(field, {})
    signal = g.get("signal", field)
    lines = [
        f"  Field: `{field}` ({signal})",
        f"  {pair_a}: {b['eff_a']}",
        f"  {pair_b}: {b['eff_b']}",
        f"  Rationale: {b['why']}",
    ]
    return "\n".join(lines)


_DESIGN_KEYS = ("FIELD", "A_READS", "A_EFFECT", "A_CODE", "A_INSERT_AFTER", "A_APPLY_TO",
                 "B_READS", "B_EFFECT", "B_CODE", "B_INSERT_AFTER", "B_APPLY_TO", "MUSICAL_WHY")


def _parse_design(raw: str) -> str:
    """Extract structured FIELD/CODE/etc. lines from model output, discarding reasoning."""
    lines = raw.split("\n")
    extracted: dict[str, str] = {}
    for line in lines:
        for key in _DESIGN_KEYS:
            if line.strip().startswith(key + ":"):
                extracted[key] = line.strip()[len(key) + 1:].strip()
                break

    if len(extracted) >= 4:
        out = []
        for key in _DESIGN_KEYS:
            if key in extracted:
                out.append(f"  {key}: {extracted[key]}")
        return "\n".join(out)
    return ""


def design_bridges(top_n: int = 3) -> str:
    """Propose specific antagonism bridge designs for top unsaturated pairs.

    For each pair: reads both module sources, analyzes existing coupling dimensions,
    and uses local code model to propose the specific dimension, direction,
    code insertion point, and musical rationale.
    """
    from .synthesis import _local_think, _LOCAL_MODEL, compress_for_claude

    bridges = get_top_bridges(n=top_n * 2, threshold=-0.30)
    unsaturated = [b for b in bridges if len(b.get("already_bridged", [])) < 3][:top_n]

    if not unsaturated:
        return "# Bridge Design\n\nNo unsaturated antagonist pairs available."

    parts = ["# Bridge Design Proposals\n"]

    coupling_state = _scan_coupling_state(os.path.join(ctx.PROJECT_ROOT, "src"))

    for b in unsaturated:
        pair_a = _TRUST_FILE_ALIASES.get(b["pair_a"], b["pair_a"])
        pair_b = _TRUST_FILE_ALIASES.get(b["pair_b"], b["pair_b"])

        src_a = _read_module_src(pair_a)
        src_b = _read_module_src(pair_b)

        state_a = coupling_state.get(pair_a, coupling_state.get(b["pair_a"], {}))
        state_b = coupling_state.get(pair_b, coupling_state.get(b["pair_b"], {}))
        dims_a = sorted(set(state_a.get("melodic_dims", []) + state_a.get("rhythm_dims", [])))
        dims_b = sorted(set(state_b.get("melodic_dims", []) + state_b.get("rhythm_dims", [])))
        already = b.get("already_bridged", [])

        raw_context = (
            f"MODULE A: {pair_a} (archetype: {b['arch_a']})\n"
            f"  Coupled dimensions: {', '.join(dims_a) or 'none'}\n"
            f"  Already bridged with B on: {', '.join(already) or 'none'}\n"
            f"  Source:\n{src_a}\n\n"
            f"MODULE B: {pair_b} (archetype: {b['arch_b']})\n"
            f"  Coupled dimensions: {', '.join(dims_b) or 'none'}\n"
            f"  Already bridged with A on: {', '.join(already) or 'none'}\n"
            f"  Source:\n{src_b}\n\n"
            f"Pearson r = {b['r']:+.3f} (negative = antagonist)\n"
            f"Algorithmic suggestion: bridge on `{b['field']}`\n"
            f"  A effect: {b['eff_a']}\n"
            f"  B effect: {b['eff_b']}\n"
            f"  Rationale: {b['why']}\n"
        )

        prompt = (
            raw_context + "\n"
            "TASK: Design ONE antagonism bridge. "
            "Both modules must read the SAME field with OPPOSING effects.\n"
            "Do NOT use a field in the 'Already bridged' list.\n\n"
            "Respond with ONLY these labeled lines:\n"
            "FIELD: <field name from melodicCtx or rhythmCtx>\n"
            "A_EFFECT: <1 line: effect on module A>\n"
            "A_CODE: <JS const, e.g. const mod = ctx.field === 'rising' ? 0.03 : -0.02;>\n"
            "A_APPLY_TO: <variable to add the modifier to>\n"
            "B_EFFECT: <1 line: OPPOSING effect on module B>\n"
            "B_CODE: <JS const with OPPOSITE sign>\n"
            "B_APPLY_TO: <variable to add the modifier to>\n"
            "MUSICAL_WHY: <1 sentence>\n"
        )

        design = _local_think(
            prompt, max_tokens=600, model=_LOCAL_MODEL,
            system="You are a code generator. Output ONLY labeled lines, no reasoning.",
            temperature=0.2,
        )

        bridged_label = f"{len(already)} bridged" if already else "VIRGIN"
        parts.append(f"## {pair_a} <-> {pair_b}  (r={b['r']:+.3f}, {bridged_label})")

        parsed = _parse_design(design) if design else ""
        if parsed:
            parts.append(parsed)
        elif design:
            compressed = compress_for_claude(
                design, max_chars=500,
                hint=(f"Extract from this bridge design: 1) which signal field, "
                      f"2) JS code for {pair_a}, 3) JS code for {pair_b}, "
                      f"4) why the opposing effects create musical interest. "
                      f"Output 4 bullet points only, no reasoning.")
            )
            if compressed and len(compressed.strip()) > 20:
                parts.append(f"  {compressed}")
            else:
                parts.append(_algorithmic_fallback(b, pair_a, pair_b))
        else:
            parts.append(_algorithmic_fallback(b, pair_a, pair_b))
        parts.append("")

    return "\n".join(parts)


def forge_bridges(top_n: int = 2) -> str:
    """Generate verified bridge proposals as lab sketches with executable monkey-patch code.

    For each unsaturated antagonist pair: reads both module sources, generates a complete
    lab sketch via code model, and returns it ready to paste into lab/sketches.js.
    """
    from .synthesis import _local_think, _LOCAL_MODEL

    bridges = get_top_bridges(n=top_n * 2, threshold=-0.30)
    unsaturated = [b for b in bridges if len(b.get("already_bridged", [])) < 3][:top_n]

    if not unsaturated:
        return "# Bridge Forge\n\nNo unsaturated antagonist pairs available."

    parts = ["# Bridge Forge: Verified Skill Recipes\n"]

    for b in unsaturated:
        pair_a = _TRUST_FILE_ALIASES.get(b["pair_a"], b["pair_a"])
        pair_b = _TRUST_FILE_ALIASES.get(b["pair_b"], b["pair_b"])
        already = b.get("already_bridged", [])

        src_a = _read_module_src(pair_a, max_chars=2000)
        src_b = _read_module_src(pair_b, max_chars=2000)

        prompt = (
            f"Generate a Polychron lab sketch that bridges two antagonist modules.\n\n"
            f"MODULE A: {pair_a}\n{src_a[:1500]}\n\n"
            f"MODULE B: {pair_b}\n{src_b[:1500]}\n\n"
            f"Pearson r = {b['r']:+.3f} (negative = antagonist)\n"
            f"Already bridged on: {', '.join(already) or 'none'}\n"
            f"Suggested field: {b['field']}\n"
            f"A should: {b['eff_a']}\n"
            f"B should: {b['eff_b']}\n"
            f"Why: {b['why']}\n\n"
            f"Write a lab sketch JS object with:\n"
            f"  name: 'forge-{pair_a}-{pair_b}'\n"
            f"  postBoot() that monkey-patches SPECIFIC METHODS on both modules\n"
            f"  NEVER replace an entire global (e.g. 'entropyRegulator = ...')\n"
            f"  ALWAYS wrap specific methods: save original, call original, modify result\n"
            f"  Pattern: const orig = module.method; module.method = function(...) {{ const r = orig.call(this,...); /* modify r */ return r; }}\n"
            f"  Both sides read the SAME conductor signal field\n"
            f"  OPPOSING effects (one boosts, one dampens)\n"
            f"  Small effect sizes (+/-0.02 to +/-0.08), clamped\n"
            f"  Access globals directly (no require/import)\n"
            f"  Do NOT use fields: [{', '.join(already)}]\n\n"
            f"Format:\n{{\n  name: 'forge-...',\n"
            f"  overrides: {{ SECTIONS: {{ min: 4, max: 4 }}, PHRASES_PER_SECTION: {{ min: 3, max: 3 }} }},\n"
            f"  postBoot() {{\n    // monkey-patch code here\n  }}\n}}\n"
            f"Output ONLY the JS object. No markdown fences. No explanation."
        )

        sketch = _local_think(
            prompt, max_tokens=1200, model=_LOCAL_MODEL,
            system="You are a JavaScript code generator for a music composition system. Output ONLY valid JS code.",
            temperature=0.3,
        )

        bridged_label = f"{len(already)} bridged" if already else "VIRGIN"
        parts.append(f"## {pair_a} <-> {pair_b}  (r={b['r']:+.3f}, {bridged_label})")

        if sketch:
            sketch = sketch.strip()
            if sketch.startswith("```"):
                sketch = "\n".join(sketch.split("\n")[1:])
            if sketch.endswith("```"):
                sketch = "\n".join(sketch.split("\n")[:-1])
            sketch = sketch.strip()

            # API validation: check that module.method references in sketch exist in symbol table
            import re as _re
            method_refs = _re.findall(r'\b(\w+)\.(\w+)\s*\(', sketch)
            unknown_refs = []
            module_methods: dict[str, list[str]] = {}
            if ctx.project_engine.symbol_table is not None:
                try:
                    all_rows = ctx.project_engine.symbol_table.to_arrow().to_pylist()
                    known_symbols = {r["name"].lower() for r in all_rows}
                    for mod, method in method_refs:
                        if mod.lower() in (pair_a.lower(), pair_b.lower()):
                            if method.lower() not in known_symbols and not method.startswith("_"):
                                unknown_refs.append(f"{mod}.{method}()")
                    # Collect valid exported methods per module for re-prompt
                    for mod_name in (pair_a, pair_b):
                        valid_methods = [
                            r["name"] for r in all_rows
                            if r.get("file", "").endswith(f"{mod_name}.js")
                            and r.get("kind", "") in ("function", "method", "property")
                        ]
                        if valid_methods:
                            module_methods[mod_name] = valid_methods
                except Exception as _err4:
                    logger.debug(f'silent-except coupling_bridges.py:687: {type(_err4).__name__}: {_err4}')

            # Re-prompt if too many unknown API calls — inject valid symbol list as constraint
            if len(unknown_refs) > 2 and ctx.project_engine.symbol_table is not None:
                api_constraints = []
                for mod_name, methods in module_methods.items():
                    api_constraints.append(f"{mod_name} exports: {', '.join(methods[:20])}")
                if api_constraints:
                    corrected_prompt = (
                        prompt
                        + f"\n\nCRITICAL: Use ONLY these verified exported methods:\n"
                        + "\n".join(api_constraints)
                        + f"\n\nDo NOT call any other methods on {pair_a} or {pair_b}."
                    )
                    corrected_sketch = _local_think(
                        corrected_prompt, max_tokens=1200, model=_LOCAL_MODEL,
                        system="You are a JavaScript code generator for a music composition system. Output ONLY valid JS code.",
                        temperature=0.2,
                    )
                    if corrected_sketch:
                        corrected_sketch = corrected_sketch.strip()
                        if corrected_sketch.startswith("```"):
                            corrected_sketch = "\n".join(corrected_sketch.split("\n")[1:])
                        if corrected_sketch.endswith("```"):
                            corrected_sketch = "\n".join(corrected_sketch.split("\n")[:-1])
                        corrected_sketch = corrected_sketch.strip()
                        # Re-validate corrected sketch
                        corrected_refs = _re.findall(r'\b(\w+)\.(\w+)\s*\(', corrected_sketch)
                        all_rows2 = ctx.project_engine.symbol_table.to_arrow().to_pylist()
                        known2 = {r["name"].lower() for r in all_rows2}
                        still_unknown = [
                            f"{m}.{fn}()" for m, fn in corrected_refs
                            if m.lower() in (pair_a.lower(), pair_b.lower())
                            and fn.lower() not in known2 and not fn.startswith("_")
                        ]
                        sketch = corrected_sketch
                        unknown_refs = still_unknown
                        parts.append(f"  _(Re-prompted with valid symbol list — {len(still_unknown)} unverified remaining)_")

            parts.append(f"\n```javascript\n{sketch}\n```\n")
            if unknown_refs:
                parts.append(f"  ⚠ **API WARNING**: {len(unknown_refs)} unverified method call(s): {', '.join(unknown_refs[:5])}")
                parts.append(f"    Verify these methods exist before running the sketch.")
            parts.append(f"  Add to `lab/sketches.js` array, then: `node lab/run.js forge-{pair_a}-{pair_b}`")
            parts.append(f"  If STABLE: integrate bridge code into src/{pair_a}.js and src/{pair_b}.js")
        else:
            parts.append(_algorithmic_fallback(b, pair_a, pair_b))
        parts.append("")

    parts.append("## Forge Workflow")
    parts.append("  1. Copy sketch into lab/sketches.js array")
    parts.append("  2. Run: node lab/run.js forge-NAME")
    parts.append("  3. Listen to lab/output/forge-NAME.wav")
    parts.append("  4. If STABLE: integrate bridge code into src/ modules")
    parts.append("  5. learn() the verified bridge as a calibration anchor")

    return "\n".join(parts)
