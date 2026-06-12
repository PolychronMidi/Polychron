"""Musical-role and rhythm-effect prose generators -- pure pattern matching, no LLM.

Extracted from evolution_next.py to reduce module size.
"""
def _describe_musical_role(name: str, path: str, narrative: str = "") -> tuple[str, str]:
    """Return (role, coupling_effect) prose for a module -- no LLM, pure pattern inference."""
    import re as _re
    name_l = name.lower()
    path_l = path.lower()
    is_crosslayer = "crosslayer" in path_l or "cross_layer" in path_l

    # Narrative hit: grab +/-100 chars around first mention
    narr_hit = ""
    if narrative:
        m = _re.search(rf'\b{_re.escape(name)}\b', narrative, _re.IGNORECASE)
        if m:
            s, e = max(0, m.start() - 60), min(len(narrative), m.end() + 100)
            narr_hit = narrative[s:e].replace('\n', ' ').strip()

    if any(k in name_l for k in ("climax", "peak", "apex")):
        role = "drives peak intensity arcs -- decides when the music crests"
        effect = "melodic freshness gates the climax window; a stale contour defers the peak until novelty returns"
    elif any(k in name_l for k in ("cadence", "cadent", "resolution")):
        role = "harmonic cadence gateway -- controls when and how layers resolve to consonance"
        effect = "melodic ascendRatio shifts the resolve threshold; descending phrases lower it (invite resolution), building phrases raise it (hold tension)"
    elif any(k in name_l for k in ("interval", "vertical", "collision", "unison")):
        role = "voice-interval collision detector -- penalizes unisons/octave stack between simultaneous layers"
        effect = "intervalFreshness scales the collision penalty; novel intervals earn tolerance, stale collisions are penalized harder"
    elif any(k in name_l for k in ("phase", "window", "lock", "sync")) and "phrase" not in name_l:
        role = "rhythmic phase synchronization window -- tracks when layers are approaching phase lock"
        effect = "contour directionBias shifts the phase threshold; descending contour widens the cadence window, ascending contour narrows it"
    elif any(k in name_l for k in ("downbeat", "accent", "metric", "beat")) and "predict" not in name_l:
        role = "emergent metric accent anchor -- reinforces downbeat position across layers"
        effect = "thematic recall strengthens downbeat affinity; fresh territory enables metric displacement experiments"
    elif any(k in name_l for k in ("predict", "predictor", "anticipat", "lookahead")):
        role = "look-ahead state predictor -- anticipates rhythmic/harmonic phase for preemptive decisions"
        effect = "melodic contour shape biases prediction confidence; rising contour predicts continuation, falling predicts resolution"
    elif any(k in name_l for k in ("contagion", "contag", "propagat", "spread")):
        role = "pattern propagation engine -- spreads stutter/rhythmic gestures across layers"
        effect = "contour coherence scales propagation strength; coherent phrases amplify contagion, counterpoint motion scatters it"
    elif any(k in name_l for k in ("groove", "transfer", "swing", "feel")):
        role = "groove transfer bridge -- broadcasts rhythmic feel from one layer to the other"
        effect = "intervalFreshness weights groove fidelity; fresh territory allows groove mutation, stale territory locks it in"
    elif any(k in name_l for k in ("rest", "breath", "silence")):
        role = "coordinates rests and silence across layers"
        effect = "phrase-completion signals anchor rests to melodic boundaries -- silence lands where contour resolves"
    elif any(k in name_l for k in ("fade", "decay", "release")):
        role = "governs fade dynamics and release shape"
        effect = "melodic arc depth scales fade onset; longer ascending phrases earn proportionally deeper release"
    elif any(k in name_l for k in ("entropy", "chaos", "scatter", "alien")):
        role = "injects controlled unpredictability into the signal"
        effect = "fresh melodic territory unlocks more entropy; over-visited intervals throttle it back"
    elif any(k in name_l for k in ("density", "crowd", "fill")):
        role = "manages note density and layer fullness"
        effect = "tessiture pressure adjusts density ceiling -- high register -> pullback, low register -> invitation to fill"
    elif any(k in name_l for k in ("roleswap", "role_swap", "swap", "switch")):
        role = "alternates lead/support roles between layers"
        effect = "melodic contour descent invites role swap evaluation; ascending contour locks the current lead"
    elif any(k in name_l for k in ("phrase", "arc", "form", "profil")):
        role = "shapes phrase trajectory and large-scale form"
        effect = "contour coherence biases toward legato arc curves; counterpoint motion biases toward fragmented arcs"
    elif any(k in name_l for k in ("tension", "harmonic", "dissonance")):
        role = "modulates harmonic tension and dissonance level"
        effect = "stale intervals trigger tension increase to force novelty; fresh territory allows tension resolution"
    elif any(k in name_l for k in ("rhythm", "tempo", "pulse", "rhythmic")):
        role = "shapes rhythmic character and pulse density"
        effect = "melodic descent invites rhythmic fill; phrase boundaries trigger metric softening"
    elif any(k in name_l for k in ("emit", "gate", "filter", "guard")):
        role = "controls note emission probability and gating"
        effect = "melodic freshness weight modulates per-beat gate -- novel intervals get amplified, overused ones suppressed"
    elif any(k in name_l for k in ("morph", "transform", "mutate", "warp")):
        role = "applies real-time transformations to the signal"
        effect = "contour coherence scales morph depth -- coherent phrases get subtle transforms, counterpoint gets radical ones"
    elif any(k in name_l for k in ("convergence", "detect", "sensor")):
        role = "detects and signals convergence states"
        effect = "melodic thematic recall modulates convergence threshold -- recurrence counts as structural coherence"
    elif any(k in name_l for k in ("feedback", "oscillat", "resonate")):
        role = "feeds signal back into the conductor loop"
        effect = "melodic contour direction biases feedback sign -- ascending curves amplify, descending curves dampen"
    elif any(k in name_l for k in ("motif", "echo", "mirror", "silhouette")):
        role = "motif memory and echo -- tracks thematic recurrence across the piece"
        effect = "thematicDensity gates motif recall; strong recall suppresses new motif injection, fresh territory invites new ones"
    elif any(k in name_l for k in ("complement", "articul", "mirror")):
        role = "articulation complement -- adds expressive nuance to the opposing layer"
        effect = "contour shape selects articulation type; ascending phrases get accented attacks, descending get tapered releases"
    elif any(k in name_l for k in ("gravity", "well", "attractor")):
        role = "temporal gravity well -- pulls note timing toward rhythmic anchor points"
        effect = "contourShape scales pull strength; rising contour amplifies gravity (strong metric pull), contrary motion scatters it"
    else:
        prefix = "cross-layer " if is_crosslayer else ""
        role = f"manages {prefix}{name} behavior"
        effect = "melodic context (contour/freshness/tessiture) scales key parameters toward musical phrasing"

    if narr_hit:
        role += f"  -> narrative: ...{narr_hit}..."
    return role, effect


def _describe_rhythm_effect(name: str, field: str) -> str:
    """Return a rhythm-coupling effect description for (module, field). No LLM."""
    name_l = name.lower()
    _field_map = {
        "hotspots": {
            "phase": "burst grid alignment tightens phase lock windows -- dense rhythmic moments invite layer convergence",
            "mirror": "hotspot density amplifies mirror intensity at burst positions -- textural reflection peaks during rhythmic clusters",
            "interval": "dense grid slots trigger deadband widening -- busy rhythmic moments allow more interval tolerance",
            "gravity": "hotspot positions strengthen temporal gravity wells -- beats cluster toward rhythmically dense anchors",
            "rest": "burst moments suppress rest synchronization -- rests are deferred during hotspot activity and invited at quiet gaps",
            "complement": "hotspot grid guides articulation accents -- complementary attacks land at burst positions",
            "silhouette": "rhythmic density amplifies silhouette contour -- dense passages produce sharper cross-layer shape",
            "cadence": "hotspot proximity shifts cadence resolve threshold -- convergent bursts trigger earlier harmonic resolution",
            "default": "burst grid positions gate key parameter -- dense rhythmic moments activate, sparse moments release",
        },
        "complexityEma": {
            "phase": "sustained rhythmic complexity widens phase tolerance -- intricate patterns permit looser synchronization",
            "mirror": "EMA-smoothed complexity scales mirror fidelity -- complex passages earn higher reflection accuracy",
            "interval": "cumulative complexity relaxes interval collision penalty -- sustained intricacy licenses harmonic density",
            "gravity": "complexity EMA adjusts gravity well depth -- complex runs deepen the pull toward anchor beats",
            "rest": "high complexity EMA defers rest synchronization -- intricate passages earn longer runs before shared rest",
            "default": "EMA-smoothed rhythmic complexity scales parameter amplitude -- sustained intricacy earns wider range",
        },
        "densitySurprise": {
            "phase": "unexpected density bursts trigger phase-lock evaluation -- surprise triggers realignment attempt",
            "mirror": "density surprise spikes mirror activation -- unexpected rhythmic density produces sudden textural echo",
            "interval": "surprise factor scales collision sensitivity -- unexpected density bursts heighten harmonic alertness",
            "default": "unexpected density deviation spikes parameter -- surprise triggers momentary sensitivity boost",
        },
        "density": {
            "default": "rhythmic density scales the parameter proportionally -- denser passages earn proportionally higher values",
        },
        "complexity": {
            "default": "per-beat rhythmic complexity scales the parameter -- intricate beats earn proportionally wider range",
        },
        "biasStrength": {
            "default": "rhythmic bias strength amplifies the coupling effect -- stronger emergent patterns increase influence",
        },
    }
    field_effects = _field_map.get(field, {"default": f"emergent {field} modulates key parameter"})
    for kw, desc in field_effects.items():
        if kw != "default" and kw in name_l:
            return desc
    return field_effects.get("default", f"emergentRhythm.{field} scales key parameter")
