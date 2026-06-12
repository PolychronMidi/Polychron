"""Antagonism bridge intelligence -- leverage analysis, bridge cache, field guides, and design synthesis."""
import glob as _glob_mod
import logging
import os
import re
from collections import defaultdict

from hme_env import ENV
from server import context as ctx
from .. import _track

logger = logging.getLogger("HME")

_PROJECT_ROOT_FALLBACK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", ".."))
METRICS_DIR = ENV.require("METRICS_DIR")
from .coupling_data import (
    _TRUST_FILE_ALIASES,
    _scan_coupling_state, _load_trust_scores,
    ALL_RHYTHM_FIELDS, ALL_MELODIC_DIMS,
)
from .coupling_clusters import _compute_clusters
from .coupling_bridges import _archetype  # noqa: F401

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
    # Load metaprofile-active.json once outside the loop. Two substrate-level
    _antag_thresh = -0.30
    _antag_disabled = False
    try:
        from ...synthesis.synthesis_config import load_json
        _mp = load_json(os.path.join(METRICS_DIR, "metaprofile-active.json"))
        if _mp:
            if "coupling" in _mp:
                _antag_thresh = _mp["coupling"].get("antagonismThreshold", -0.30)
            _disabled_list = _mp.get("disableControllers")
            if isinstance(_disabled_list, list) and "antagonism_bridges" in _disabled_list:
                _antag_disabled = True
    except Exception as _mp_err:
        logger.debug(f"metaprofile load: {type(_mp_err).__name__}: {_mp_err}")
    if _antag_disabled:
        logger.info("antagonism_bridges disabled by active metaprofile -- skipping bridge proposals")
        return "antagonism_bridges disabled by active metaprofile (no bridges proposed)"
    for (a, b), r in corr.items():
        key = tuple(sorted([a, b]))
        if key not in seen and r < _antag_thresh:
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

    # Get latest round number for staleness computation.
    _latest_round = 0
    try:
        from .. import _activity_latest_round, _journal_latest_archived_round
        _latest_round = _activity_latest_round() or _journal_latest_archived_round() or 0
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
            staleness = "" if rounds_ago <= 3 else f" [!] {rounds_ago} rounds stale" if rounds_ago <= 10 else f" [!] {rounds_ago} rounds stale -- may need re-evaluation"
            out.append(f"   KB history: {', '.join(sorted(kb_rounds))}{staleness}")
        else:
            out.append(f"   KB history: none -- unexplored pair (high discovery potential)")
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


