"""HME evolution intelligence — next-evolution suggestions via algorithmic cluster ranking."""
import json
import os
import logging

from server import context as ctx
from . import _track, _load_trace

logger = logging.getLogger("HME")


def _rank_by_cluster_pull(coupling_state: dict, trace_records: list, top_n: int = 8) -> list:
    """Rank uncoupled modules by correlation strength with melodically-coupled neighbors.

    Returns list of (module_name, pull_score) sorted descending. pull_score is the
    mean |r| across all coupled modules with |r| >= 0.25 — a direct measure of
    how strongly the coupled network is 'pulling' this module into shared musical logic.
    """
    from .coupling import _pearson

    coupled = {name for name, info in coupling_state.items() if info.get("melodic")}
    uncoupled = {name for name, info in coupling_state.items() if not info.get("melodic")}

    if not trace_records or not coupled or not uncoupled:
        return [(m, 0.0) for m in sorted(uncoupled)[:top_n]]

    n = len(trace_records)

    # Build per-module score series from trace trust data
    raw: dict[str, list] = {}
    for rec in trace_records:
        trust = rec.get("trust", {})
        for mod in coupled | uncoupled:
            data = trust.get(mod)
            if isinstance(data, dict):
                s = data.get("score")
                raw.setdefault(mod, []).append(float(s) if isinstance(s, (int, float)) else None)
            else:
                raw.setdefault(mod, []).append(None)

    # Fill missing values with per-module mean; skip modules with < 50 data points
    series: dict[str, list[float]] = {}
    for mod, vals in raw.items():
        present = [v for v in vals if v is not None]
        if len(present) < 50:
            continue
        mean = sum(present) / len(present)
        series[mod] = [v if v is not None else mean for v in vals]

    # Score each uncoupled module: mean |r| with coupled neighbors >= 0.25
    scores: dict[str, float] = {}
    for unc in uncoupled:
        if unc not in series:
            continue
        pull_vals = []
        for cop in coupled:
            if cop not in series:
                continue
            r = _pearson(series[unc], series[cop])
            if abs(r) >= 0.25:
                pull_vals.append(abs(r))
        if pull_vals:
            scores[unc] = sum(pull_vals) / len(pull_vals)

    return sorted(scores.items(), key=lambda x: -x[1])[:top_n]


def evolution_momentum() -> str:
    """Strategic momentum view of the evolution arc. Called internally by suggest_evolution."""
    ctx.ensure_ready_sync()
    _track("evolution_momentum")
    import re as _re

    # --- 1. Parse journal.md for round verdicts ---
    journal_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "journal.md")
    if not os.path.isfile(journal_path):
        return "No journal.md found at metrics/journal.md"

    with open(journal_path, encoding="utf-8") as _f:
        journal_text = _f.read()

    rounds = _re.findall(r'## R(\d+)', journal_text)
    verdict_map: dict[str, str] = {}
    for m in _re.finditer(r'## R(\d+).*?\*\*Verdict:\*\*\s*([^\n|]+)', journal_text, _re.DOTALL):
        round_n, verdict = m.group(1), m.group(2).strip().lower()
        verdict_map[round_n] = verdict

    # --- 2. Categorize all KB entries by round + type ---
    _MELODIC_PAT = _re.compile(
        r'\b(melodic coupling|emergentMelodicEngine|contourShape|counterpoint|'
        r'thematicDensity|tessituraPressure|phraseBreath|restSynchronizer.*melodic|'
        r'phraseArcProfiler.*melodic)\b', _re.IGNORECASE
    )
    _RHYTHM_PAT = _re.compile(
        r'\b(rhythmic coupling|emergentRhythmEngine|rhythmCtx|rhythm.*couple)\b', _re.IGNORECASE
    )
    _HME_PAT = _re.compile(
        r'\b(HME|mcp\.tool|suggest_evolution|coupling_network|drama_map|'
        r'evolution_momentum|cluster_finder|consolidat)\b', _re.IGNORECASE
    )
    _PERCEPT_PAT = _re.compile(
        r'\b(perceptual|EnCodec|CLAP|CB0|sectionIntent|perceptualTension|'
        r'verdictPredict)\b', _re.IGNORECASE
    )
    _ARCH_PAT = _re.compile(
        r'\b(architecture|refactor|firewall|boundary|migration|extract|'
        r'consolidat|hypermeta)\b', _re.IGNORECASE
    )

    all_kb = ctx.project_engine.list_knowledge_full()
    momentum_by_round: dict[str, list[str]] = {}  # round_str → list of categories
    dimension_by_round: dict[str, list[str]] = {}  # round_str → list of melodic dims used
    _ROUND_PAT = _re.compile(r'\bR(\d+)\b')
    _DIM_PAT = _re.compile(r'\b(contourShape|counterpoint|thematicDensity|tessituraPressure|'
                            r'intervalFreshness|contourCoherence|phraseBreath)\b', _re.IGNORECASE)

    for entry in all_kb:
        text = entry.get("title", "") + " " + entry.get("content", "")[:400]
        round_match = _ROUND_PAT.search(text)
        if not round_match:
            continue
        round_n = round_match.group(1)
        cat = "other"
        if _MELODIC_PAT.search(text):
            cat = "melodic_coupling"
        elif _RHYTHM_PAT.search(text):
            cat = "rhythmic_coupling"
        elif _PERCEPT_PAT.search(text):
            cat = "perceptual"
        elif _ARCH_PAT.search(text):
            cat = "architecture"
        elif _HME_PAT.search(text):
            cat = "hme_tool"
        momentum_by_round.setdefault(round_n, []).append(cat)
        if _MELODIC_PAT.search(text):
            dims = [d.lower() for d in _DIM_PAT.findall(text)]
            if dims:
                dimension_by_round.setdefault(round_n, []).extend(dims)

    # --- 3. Build timeline ---
    out = ["# Evolution Momentum\n"]
    all_rounds = sorted(set(rounds + list(momentum_by_round.keys())), key=int)

    if all_rounds:
        # Group consecutive rounds with same dominant category
        current_cat = None
        run_start = None
        run_entries: list[str] = []
        timeline_parts: list[str] = []
        for r in all_rounds:
            cats = momentum_by_round.get(r, [])
            dominant = max(set(cats), key=cats.count) if cats else "unknown"
            verdict = verdict_map.get(r, "?")
            verdict_short = "✓" if any(k in verdict for k in ("stable", "evolved", "legendary")) else ("✗" if any(k in verdict for k in ("drift", "refut")) else "?")
            run_entries.append(f"R{r}[{verdict_short}]")
            if dominant != current_cat:
                if current_cat and run_start:
                    timeline_parts.append(f"  R{run_start}–R{all_rounds[all_rounds.index(r)-1]}: {current_cat} ({len(run_entries)-1} rounds)")
                current_cat = dominant
                run_start = r
                run_entries = [f"R{r}[{verdict_short}]"]
        if current_cat and run_start:
            timeline_parts.append(f"  R{run_start}–R{all_rounds[-1]}: **{current_cat}** ← current")

        out.append("## Evolution Arc")
        out.extend(timeline_parts)
        out.append(f"\nTotal rounds in journal: {len(all_rounds)} | KB entries: {len(all_kb)}")
        out.append("")

    # --- 4. Subsystem receptivity from journal ---
    # Split into lines for ±5-line window search (subsystem name and verdict rarely co-occur on same line)
    journal_lines = journal_text.splitlines()
    subsystem_counts: dict[str, dict[str, int]] = {}
    _VERDICT_PAT = _re.compile(r'\b(STABLE|EVOLVED|LEGENDARY|stable|evolved|legendary)\b')
    for sub in ["crossLayer", "conductor", "fx", "composers", "rhythm", "time", "play"]:
        total_mentions = len(_re.findall(rf'\b{sub}\b', journal_text, _re.IGNORECASE))
        confirmed = 0
        sub_pat = _re.compile(rf'\b{sub}\b', _re.IGNORECASE)
        for i, line in enumerate(journal_lines):
            if sub_pat.search(line):
                # Look in ±5 line window for a verdict
                window_start = max(0, i - 5)
                window_end = min(len(journal_lines), i + 6)
                window_text = "\n".join(journal_lines[window_start:window_end])
                if _VERDICT_PAT.search(window_text):
                    confirmed += 1
        subsystem_counts[sub] = {"confirmed": confirmed, "mentions": total_mentions}

    if any(v["mentions"] > 0 for v in subsystem_counts.values()):
        out.append("## Subsystem Receptivity (confirmed verdicts / total mentions)")
        for sub, counts in sorted(subsystem_counts.items(), key=lambda x: -x[1]["mentions"]):
            if counts["mentions"] < 3:
                continue
            rate = counts["confirmed"] / counts["mentions"] if counts["mentions"] > 0 else 0
            bar = "█" * int(rate * 10) + "░" * (10 - int(rate * 10))
            out.append(f"  {sub:<15} {bar} {counts['confirmed']}/{counts['mentions']}")
        out.append("")

    # --- 5. Dimension rut detection ---
    all_dims: list[str] = []
    for dims in dimension_by_round.values():
        all_dims.extend(dims)

    recent_rounds = all_rounds[-6:] if len(all_rounds) >= 6 else all_rounds
    recent_dims: list[str] = []
    for r in recent_rounds:
        recent_dims.extend(dimension_by_round.get(r, []))

    if all_dims:
        from collections import Counter
        all_counts = Counter(all_dims)
        recent_counts = Counter(recent_dims)
        all_dim_names = sorted(all_counts.keys())

        out.append(f"## Melodic Dimension Usage (last {len(recent_rounds)} rounds vs. all-time)")
        for dim in sorted(all_dim_names, key=lambda d: -all_counts[d]):
            recent_n = recent_counts.get(dim, 0)
            total_n = all_counts[dim]
            recency_flag = " ◄ RECENT RUT" if recent_n >= 3 else (" ◄ UNTOUCHED RECENTLY" if total_n > 0 and recent_n == 0 else "")
            out.append(f"  {dim:<28} all-time: {total_n:2d}  recent: {recent_n:2d}{recency_flag}")
        out.append("")

        # Identify the least-used dimension in recent rounds (opportunity)
        untouched = [d for d in all_dim_names if recent_counts.get(d, 0) == 0 and all_counts[d] > 0]
        if untouched:
            out.append(f"**Dimension opportunity:** {', '.join(untouched)} — used historically but absent in last {len(recent_rounds)} rounds")
            out.append("")

    return "\n".join(out)


def _describe_musical_role(name: str, path: str, narrative: str = "") -> tuple[str, str]:
    """Return (role, coupling_effect) prose for a module — no LLM, pure pattern inference."""
    import re as _re
    name_l = name.lower()
    path_l = path.lower()
    is_crosslayer = "crosslayer" in path_l or "cross_layer" in path_l

    # Narrative hit: grab ±100 chars around first mention
    narr_hit = ""
    if narrative:
        m = _re.search(rf'\b{_re.escape(name)}\b', narrative, _re.IGNORECASE)
        if m:
            s, e = max(0, m.start() - 60), min(len(narrative), m.end() + 100)
            narr_hit = narrative[s:e].replace('\n', ' ').strip()

    if any(k in name_l for k in ("climax", "peak", "apex")):
        role = "drives peak intensity arcs — decides when the music crests"
        effect = "melodic freshness gates the climax window; a stale contour defers the peak until novelty returns"
    elif any(k in name_l for k in ("cadence", "cadent", "resolution")):
        role = "harmonic cadence gateway — controls when and how layers resolve to consonance"
        effect = "melodic ascendRatio shifts the resolve threshold; descending phrases lower it (invite resolution), building phrases raise it (hold tension)"
    elif any(k in name_l for k in ("interval", "vertical", "collision", "unison")):
        role = "voice-interval collision detector — penalizes unisons/octave stack between simultaneous layers"
        effect = "intervalFreshness scales the collision penalty; novel intervals earn tolerance, stale collisions are penalized harder"
    elif any(k in name_l for k in ("phase", "window", "lock", "sync")) and "phrase" not in name_l:
        role = "rhythmic phase synchronization window — tracks when layers are approaching phase lock"
        effect = "contour directionBias shifts the phase threshold; descending contour widens the cadence window, ascending contour narrows it"
    elif any(k in name_l for k in ("downbeat", "accent", "metric", "beat")) and "predict" not in name_l:
        role = "emergent metric accent anchor — reinforces downbeat position across layers"
        effect = "thematic recall strengthens downbeat affinity; fresh territory enables metric displacement experiments"
    elif any(k in name_l for k in ("predict", "predictor", "anticipat", "lookahead")):
        role = "look-ahead state predictor — anticipates rhythmic/harmonic phase for preemptive decisions"
        effect = "melodic contour shape biases prediction confidence; rising contour predicts continuation, falling predicts resolution"
    elif any(k in name_l for k in ("contagion", "contag", "propagat", "spread")):
        role = "pattern propagation engine — spreads stutter/rhythmic gestures across layers"
        effect = "contour coherence scales propagation strength; coherent phrases amplify contagion, counterpoint motion scatters it"
    elif any(k in name_l for k in ("groove", "transfer", "swing", "feel")):
        role = "groove transfer bridge — broadcasts rhythmic feel from one layer to the other"
        effect = "intervalFreshness weights groove fidelity; fresh territory allows groove mutation, stale territory locks it in"
    elif any(k in name_l for k in ("rest", "breath", "silence")):
        role = "coordinates rests and silence across layers"
        effect = "phrase-completion signals anchor rests to melodic boundaries — silence lands where contour resolves"
    elif any(k in name_l for k in ("fade", "decay", "release")):
        role = "governs fade dynamics and release shape"
        effect = "melodic arc depth scales fade onset; longer ascending phrases earn proportionally deeper release"
    elif any(k in name_l for k in ("entropy", "chaos", "scatter", "alien")):
        role = "injects controlled unpredictability into the signal"
        effect = "fresh melodic territory unlocks more entropy; over-visited intervals throttle it back"
    elif any(k in name_l for k in ("density", "crowd", "fill")):
        role = "manages note density and layer fullness"
        effect = "tessiture pressure adjusts density ceiling — high register → pullback, low register → invitation to fill"
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
        effect = "melodic freshness weight modulates per-beat gate — novel intervals get amplified, overused ones suppressed"
    elif any(k in name_l for k in ("morph", "transform", "mutate", "warp")):
        role = "applies real-time transformations to the signal"
        effect = "contour coherence scales morph depth — coherent phrases get subtle transforms, counterpoint gets radical ones"
    elif any(k in name_l for k in ("convergence", "detect", "sensor")):
        role = "detects and signals convergence states"
        effect = "melodic thematic recall modulates convergence threshold — recurrence counts as structural coherence"
    elif any(k in name_l for k in ("feedback", "oscillat", "resonate")):
        role = "feeds signal back into the conductor loop"
        effect = "melodic contour direction biases feedback sign — ascending curves amplify, descending curves dampen"
    elif any(k in name_l for k in ("motif", "echo", "mirror", "silhouette")):
        role = "motif memory and echo — tracks thematic recurrence across the piece"
        effect = "thematicDensity gates motif recall; strong recall suppresses new motif injection, fresh territory invites new ones"
    elif any(k in name_l for k in ("complement", "articul", "mirror")):
        role = "articulation complement — adds expressive nuance to the opposing layer"
        effect = "contour shape selects articulation type; ascending phrases get accented attacks, descending get tapered releases"
    elif any(k in name_l for k in ("gravity", "well", "attractor")):
        role = "temporal gravity well — pulls note timing toward rhythmic anchor points"
        effect = "contourShape scales pull strength; rising contour amplifies gravity (strong metric pull), contrary motion scatters it"
    else:
        prefix = "cross-layer " if is_crosslayer else ""
        role = f"manages {prefix}{name} behavior"
        effect = "melodic context (contour/freshness/tessiture) scales key parameters toward musical phrasing"

    if narr_hit:
        role += f"  ↳ narrative: …{narr_hit}…"
    return role, effect


@ctx.mcp.tool()
def suggest_evolution() -> str:
    """Synthesize all available signals -- hotspots, trust ecology, coupling state, perceptual
    character, uncoupled modules, KB evolution patterns -- into 3-5 ranked evolution proposals.
    NOTE: pipeline_digest(evolve=True) now calls this automatically -- no separate call needed.
    Call directly only when you want evolution suggestions without the full digest."""
    ctx.ensure_ready_sync()
    _track("suggest_evolution")

    signals = {}

    # 1. Trace summary -- regime, trust, hotspots, coupling
    trace_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace-summary.json")
    if os.path.isfile(trace_path):
        try:
            with open(trace_path) as f:
                ts = json.load(f)
            signals["regimes"] = ts.get("regimes", {})
            dom = ts.get("trustDominance", {})
            if isinstance(dom, dict):
                top = dom.get("dominantSystems", [])
                if top:
                    signals["top_trust"] = [
                        f"{s.get('system', '?')}({s.get('score', 0):.2f})"
                        for s in top[:8]
                    ]
            signals["couplingLabels"] = ts.get("aggregateCouplingLabels", {})
            signals["axisEnergy"] = ts.get("axisEnergy", {})
        except Exception:
            pass

    # 2. Perceptual report -- CLAP character + CB0
    perc_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "perceptual-report.json")
    if os.path.isfile(perc_path):
        try:
            with open(perc_path) as f:
                perc = json.load(f)
            clap = perc.get("clap", {})
            if clap:
                signals["perceptual_character"] = clap.get("dominant_character", "unknown")
                signals["perceptual_score"] = round(clap.get("dominant_score", 0), 3)
                queries = clap.get("queries", {})
                signals["perceptual_queries"] = {
                    k: round(v.get("avg", 0), 3) for k, v in queries.items()
                    if isinstance(v, dict)
                }
            enc = perc.get("encodec", {})
            if enc:
                # CB0 entropy averaged across sections
                sections = enc.get("sections", {})
                cb0_vals = [s["entropies"]["cb0"] for s in sections.values()
                            if isinstance(s, dict) and "entropies" in s and "cb0" in s["entropies"]]
                if cb0_vals:
                    signals["cb0_entropy_mean"] = round(sum(cb0_vals) / len(cb0_vals), 3)
                    signals["cb0_entropy_range"] = [round(min(cb0_vals), 3), round(max(cb0_vals), 3)]
                signals["tension_complexity_r"] = round(
                    enc.get("tension_complexity_correlation", 0), 3
                )
                # Per-section character
                sec_chars = {}
                for sec_id, sec_data in sorted(sections.items()):
                    if isinstance(sec_data, dict) and "clap" in sec_data:
                        sc = sec_data["clap"]
                        top = max(sc, key=sc.get, default="?")
                        sec_chars[f"S{sec_id}"] = f"{top}({sc.get(top, 0):.2f})"
                if sec_chars:
                    signals["per_section_character"] = sec_chars
        except Exception:
            pass

    # 3. Coupling state — source-code scan (accurate, no KB guessing)
    src_root = os.path.join(ctx.PROJECT_ROOT, "src")
    from .coupling import _scan_coupling_state
    coupling_state = _scan_coupling_state(src_root)
    melodic_uncoupled_names = sorted(n for n, i in coupling_state.items() if not i["melodic"])
    rhythm_uncoupled_names = sorted(n for n, i in coupling_state.items() if not i["rhythm"])
    already_coupled = sorted(n for n, i in coupling_state.items() if i["melodic"])
    signals["melodically_uncoupled"] = melodic_uncoupled_names[:20]
    signals["rhythmically_uncoupled"] = rhythm_uncoupled_names[:15]
    signals["already_coupled"] = already_coupled

    # Cluster-pull ranking: load trace and rank uncoupled by correlation with coupled neighbors
    trace_raw_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "trace.jsonl")
    trace_records: list = []
    if os.path.isfile(trace_raw_path):
        try:
            trace_records = _load_trace(trace_raw_path)
        except Exception:
            pass
    if trace_records:
        cluster_targets = _rank_by_cluster_pull(coupling_state, trace_records)
        if cluster_targets:
            signals["cluster_priority_targets"] = [
                f"{name}(pull:{score:.2f})" for name, score in cluster_targets
            ]

    # 4. Narrative excerpt
    narrative_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "narrative-digest.md")
    if os.path.isfile(narrative_path):
        try:
            with open(narrative_path, encoding="utf-8") as f:
                signals["narrative_excerpt"] = f.read()[:2000]
        except Exception:
            pass

    # 5. KB evolution patterns
    kb_results = ctx.project_engine.search_knowledge(
        "evolution legendary pattern coupling", top_k=5
    )
    if kb_results:
        signals["kb_patterns"] = [
            f"[{k['category']}] {k['title']}: {k['content'][:120]}"
            for k in kb_results
        ]

    # 6. Verdict model top features
    model_path = os.path.join(ctx.PROJECT_ROOT, "metrics", "verdict-model.json")
    if os.path.isfile(model_path):
        try:
            with open(model_path) as f:
                model = json.load(f)
            fi = model.get("feature_importance", [])
            if fi:
                signals["verdict_top_features"] = fi[:5]
        except Exception:
            pass

    # 7. Rut detection -- categorize last N KB evolution entries to detect monotonic runs
    import re as _re2
    _COUPLING_PATTERN = _re2.compile(
        r'\b(melodic coupling|rhythmicCouple|melodicEngine|emergentMelodic|'
        r'emergentRhythm|rhythmic coupling|rhythm coupling)\b', _re2.IGNORECASE
    )
    _HME_PATTERN = _re2.compile(r'\bHME\b|mcp.tool|suggest_evolution|coupling_network', _re2.IGNORECASE)
    try:
        recent_kb = ctx.project_engine.search_knowledge("R5 R6 evolution round", top_k=12)
        rut_types = []
        for k in recent_kb:
            text = k.get("title", "") + " " + k.get("content", "")[:200]
            if _COUPLING_PATTERN.search(text):
                rut_types.append("melodic_coupling")
            elif _HME_PATTERN.search(text):
                rut_types.append("hme_tool")
            else:
                rut_types.append("other")
        if rut_types:
            # Check if last 3+ are same type
            last3 = rut_types[:3]
            if len(set(last3)) == 1:
                signals["evolution_rut"] = {
                    "type": last3[0],
                    "consecutive": len([t for t in rut_types if t == last3[0]]),
                    "warning": f"Last {len(last3)}+ evolutions are all '{last3[0]}' — "
                               "consider orthogonal target (architecture, perceptual loop, "
                               "new engine, or structural refactor)"
                }
    except Exception:
        pass

    # --- Build output: pure algorithmic ranking, no LLM ---
    parts = ["# Evolution Suggestions\n"]
    parts.append(f"**Signals analyzed:** {len(signals)} categories")
    parts.append(f"**Melodically uncoupled:** {len(melodic_uncoupled_names)} crossLayer modules")
    parts.append(f"**Rhythmically uncoupled:** {len(rhythm_uncoupled_names)} crossLayer modules")
    if signals.get("perceptual_character"):
        parts.append(f"**Perceptual character:** {signals['perceptual_character']}")
    if signals.get("cb0_entropy_mean"):
        parts.append(f"**CB0 entropy:** {signals['cb0_entropy_mean']}")
    if signals.get("evolution_rut"):
        rut = signals["evolution_rut"]
        parts.append(f"**RUT ALERT:** {rut['warning']}")
    parts.append("")

    # Generate proposals from cluster_priority_targets
    cluster_targets = signals.get("cluster_priority_targets", [])
    if cluster_targets:
        parts.append("## Ranked by Cluster Pull (cooperative correlation with coupled modules)\n")
        for idx, entry in enumerate(cluster_targets[:5]):
            name = entry.split("(")[0]
            score_str = entry.split("pull:")[1].rstrip(")") if "pull:" in entry else "?"
            info = coupling_state.get(name, {})
            fpath = info.get("path", "?").replace(os.path.join(ctx.PROJECT_ROOT, "src/"), "")
            parts.append(f"### E{idx + 1}: {name}")
            parts.append(f"**Path:** {fpath}")
            parts.append(f"**Cluster pull:** {score_str}")
            role_desc, coupling_effect = _describe_musical_role(
                name, fpath, signals.get("narrative_excerpt", "")
            )
            parts.append(f"**Musical role:** {role_desc}")
            parts.append(f"**Coupling effect:** {coupling_effect}")
            # Check for KB constraints
            try:
                kb_hits = ctx.project_engine.search_knowledge(name, top_k=2)
                if kb_hits:
                    parts.append(f"**KB:** {kb_hits[0].get('title', '?')[:80]}")
                else:
                    parts.append("**KB:** no entries (blind spot)")
            except Exception:
                pass
            parts.append(f"**Pattern:** `safePreBoot.call(() => emergentMelodicEngine.getContext(), null)` → multiplier on key parameter")
            parts.append("")
    else:
        parts.append("## Uncoupled Modules (no cluster data — run pipeline first)\n")
        for name in melodic_uncoupled_names[:8]:
            info = coupling_state.get(name, {})
            fpath = info.get("path", "?").replace(os.path.join(ctx.PROJECT_ROOT, "src/"), "")
            parts.append(f"  {name:<35} {fpath}")

    # Perceptual gap analysis
    if signals.get("per_section_character"):
        chars = signals["per_section_character"]
        parts.append("## Perceptual Section Characters")
        for sec, char in chars.items():
            parts.append(f"  {sec}: {char}")

    # Evolution momentum section (arc, dimension rut, subsystem receptivity)
    try:
        momentum = evolution_momentum()
        if momentum and "Error" not in momentum[:30]:
            parts.append("\n" + momentum)
    except Exception:
        pass

    return "\n".join(parts)
