"""Antagonism bridge intelligence -- leverage analysis, bridge cache, field guides, and design synthesis."""
import glob as _glob_mod
import logging
import os
import re
from collections import defaultdict

from server import context as ctx
from .. import _track

logger = logging.getLogger("HME")

_PROJECT_ROOT_FALLBACK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", ".."))
METRICS_DIR = os.environ.get("METRICS_DIR", os.path.join(ctx.PROJECT_ROOT or _PROJECT_ROOT_FALLBACK, "output", "metrics"))
from .coupling_data import (
    _TRUST_FILE_ALIASES,
    _scan_coupling_state, _load_trust_scores,
    ALL_RHYTHM_FIELDS, ALL_MELODIC_DIMS,
)
from .coupling_clusters import _compute_clusters
from .coupling_bridges import (  # noqa: F401
    _archetype, _algorithmic_fallback, _parse_design, _read_module_src, get_top_bridges,
)

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




def design_bridges(top_n: int = 3) -> str:
    """Propose specific antagonism bridge designs for top unsaturated pairs.

    For each pair: reads both module sources, analyzes existing coupling dimensions,
    and uses local code model to propose the specific dimension, direction,
    code insertion point, and musical rationale.
    """
    from ..synthesis import _local_think, _LOCAL_MODEL, compress_for_claude

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
    from ..synthesis import _local_think, _LOCAL_MODEL

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
                        parts.append(f"  _(Re-prompted with valid symbol list -- {len(still_unknown)} unverified remaining)_")

            parts.append(f"\n```javascript\n{sketch}\n```\n")
            if unknown_refs:
                parts.append(f"  [!] **API WARNING**: {len(unknown_refs)} unverified method call(s): {', '.join(unknown_refs[:5])}")
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
