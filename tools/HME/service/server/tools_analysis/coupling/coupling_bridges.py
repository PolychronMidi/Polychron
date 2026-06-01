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
    lookups to surface weaker-but-real virgin tensions like feedbackOscillator<->motifEcho)."""
    try:
        trace_path = os.path.join(ctx.PROJECT_ROOT, "src", "output", "metrics", "trace.jsonl")
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



# Re-export -- antagonism_leverage extracted to sibling.
from .coupling_antagonism import antagonism_leverage  # noqa: F401, E402

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



# Re-exports -- design/forge extracted.
from .coupling_design_bridges import design_bridges, forge_bridges  # noqa: F401, E402
