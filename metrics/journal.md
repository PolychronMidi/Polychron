## R32 — 2026-03-23 — STABLE (second run)

**Profile:** explosive | **Beats:** 476 | **Duration:** 494.4s | **Notes:** 17,369 (L1=7591, L2=9778)
**Fingerprint:** 10/10 stable | Drifted: none (R32a EVOLVED 1/10 regimeDistribution, R32b STABLE 0/10)

### Key Observations
- **L2 output fully recovered**: 4538 -> 9778 (+115.5%). L1 also up 5215 -> 7591 (+45.6%). Total notes 9753 -> 17369 (+78.1%). layerBias 0.04 -> 0.10 was the key fix. Possible overcorrection — L2 now 1.29x L1.
- **density-tension fully decorrelated**: pearsonR -0.286 (was 0.823, direction "stable"). The 0.55/0.45 composite/harmonicTension rebalancing broke the lockstep correlation. This is the most impactful single-constant change in the series.
- **Tension range exploded**: min 0.063, max 0.912. Widest ever. Avg tension 0.698 (up from 0.543). Tension arc [0.60, 0.71, 0.70, 0.53] -- genuine arch with S1-S2 peak and S3 descent.
- **Regime balance recovered**: coherent 48.5%, exploring 48.9% -- nearly perfect 50/50. R31's exploring-dominant 70% corrected naturally.
- **Exceedance dramatically reduced**: 4 beats total (was 36 in R31). All density-flicker. Best exceedance in many rounds.
- **Manifest health: PASS**: coupling tail p90 0.847, exceedance max 0.451. First clean PASS with no warnings in several rounds.
- **Phase axis highly variable**: run 1 showed 13.6% (excellent), re-run shows 0.6% (regression). PHASE_SURFACE_RATIO 1.5 not sufficient for stable phase engagement.
- **axisGini: 0.215** (moderate). Phase at 0.006 share drags balance down.
- **Harmonic journey**: Eb dorian -> C# major -> D# major -> D# mixolydian. Modal variety with 4 sections. Two D#-rooted sections share tonic but differ modally.
- **roleSwap trust activated**: 0.000 -> 0.179. First time this module participates meaningfully.
- **telemetryHealth: 0.500** (up from 0.246, +103%). Strong improvement.

### Evolutions Applied (from R31)
- E1: L2 emission boost (layerBias 0.04 -> 0.10) — **confirmed** — L2 went from 4538 to 9778 (+115.5%). Clear causal link via dynamismEngine layerBias additive term.
- E2: Phase surface ratio reduction (1.8 -> 1.5) — **inconclusive** — run 1 showed 13.6% phase share (excellent), re-run showed 0.6% (regression). Highly stochastic. Not a reliable lever.
- E3: Tension decorrelation (composite 0.70/0.30 -> 0.55/0.45) — **confirmed** — density-tension pearsonR dropped from 0.823 to -0.286. Direction changed from "increasing" to "stable". Strongest evidence of causality in the series.
- E4: Tension smoothing increase (0.25 -> 0.38) — **confirmed** — tension max jumped from 0.70 to 0.912 (widest ever). Avg tension 0.543 -> 0.698. Faster EMA lets tension reach higher peaks.
- E5: Register curves raised (+4 semitones) — **not measurable** — pitch center not directly tracked in fingerprint metrics. Composition-diff shows different key areas but cross-profile confounds attribution.

### Evolutions Proposed (for R33)
- E1: Phase signal structural boost — target phase coupling generation in conductor
- E2: Evolving regime engagement — target regimeClassifier evolving entry threshold
- E3: Flicker range expansion — target flicker signal floor in conductor
- E4: Density dynamic contrast — target climax/receding density shaping
- E5: Composer textural variety — target composer selection or layering logic
- E6: Trust differentiation — target trust module interaction patterns

### Hypotheses to Track
- Phase axis share 0.6% vs 13.6% across two identical-code runs suggests phase engagement is predominantly regime-driven, not ratio-driven. Regime distribution shifted (coherent 66% in run 1 vs 48.5% in run 2) — coherent regime may enable more phase.
- L2 note overcorrection may stabilize across profiles. layerBias 0.10 may need pullback to 0.07-0.08 if L2/L1 ratio consistently exceeds 1.5.
- density-tension decorrelation may enable more coupling texture variety as the two signals now move independently. Watch for new coupling hotspot pairs emerging.
- Tension max 0.912 is excellent but the floor is still 0.063. The full 0-1 range is available. Watch whether extreme lows create musical silences.

---

## R31 — 2026-03-23 — STABLE

**Profile:** default | **Beats:** 278 | **Duration:** 299.0s | **Notes:** 9753
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- **L2 output collapse: -39.7%** (7521→4538). L1 gained +13.9%. Dramatic layer asymmetry — L2 suppressed while L1 flourished.
- **Regime recovery partial**: coherent 7.7%→25.2% (up from R30's nadir but still below baseline 45.2%). 4 transitions (up from 3). One forced transition (coherent-cadence-monopoly at tick 37).
- **Tension arc improved**: [0.35, 0.64, 0.58, 0.59] — good arch shape with S1 peak at 0.64. Better than baseline's flat [0.49, 0.60, 0.50, 0.50]. But tension max still only 0.70 (was 0.85 in R29).
- **Phase axis regressed**: share 1.9% (was 9.4% in R30, 4.6% baseline). Phase falling trend. The excellent phase engagement from R30 was not sustained.
- **density-tension highly correlated** (pearsonR=0.823). Signals move in lockstep — reduces textural diversity.
- **Coupling hotspots**: flicker-trust p95=0.935, density-flicker p95=0.918, density-tension p95=0.892 (triggered manifest-health warning). 36 exceedance beats (up from 14 baseline).
- **Harmonic journey**: A#dorian→E mixolydian→Gb dorian. Three distinct key areas with rich modal variety.
- **Density range**: 0.26–0.55. Profile widening to [0.22,0.88] didn't fully materialize — actual output still compressed.
- **Pitch center**: output2 dropped another 7.5 semitones despite octave weight boost. OCTAVE.weights change may need more time or stronger upper-octave emphasis.

### Evolutions Applied (from R30)
- E1: Profile density range [0.3,0.8]→[0.22,0.88] — inconclusive — density range only reached 0.26–0.55, far from the [0.22,0.88] envelope. Meta-controllers likely clamping.
- E2: Phase climax multiplier 1.3→1.5 — inconclusive — phase axis share dropped from 9.4% to 1.9%. Climax multiplier alone insufficient against phase suppression.
- E3: Octave weights upper boost — refuted — pitch center dropped another 7.5 semitones. Weight shift to upper octaves didn't overcome composer selection or other factors pulling pitch down.
- E4: DENSITY_BASE 0.25→0.33 — confirmed — L1 notes +13.9% (density floor lift worked for L1). L2 collapse likely caused by other factors.
- E5: Regime self-balancer tuning — confirmed — coherent recovered from 7.7% to 25.2%. REGIME_SCALE_NUDGE increase worked.

### Evolutions Proposed (for R32)
- E1: L2 emission investigation — target composer/play subsystem files affecting L2 output
- E2: Phase signal injection boost — target phase-related conductor modules
- E3: density-tension decorrelation — target coupling or signal infrastructure
- E4: Tension ceiling expansion — target tension signal shaping
- E5: Upper register composer bias — target composer selection/pitch generation

### Hypotheses to Track
- L2 collapse may be linked to phrase-count reduction (S0:1→0 phrases, S1:3→2) or role-swap dynamics
- Phase regression may be caused by exploring-dominant regime (70.1%) which doesn't activate phase pathways
- density-tension correlation 0.823 may be structural (both driven by same climax proximity signal)
- Octave weight changes may need composer-level reinforcement to overcome key/mode selection effects

---

## R30 -- 2026-03-23 -- STABLE (first run)

**Profile:** default | **Beats:** 223 (3 sections: 132/30/61) | **Fingerprint:** STABLE 0/11

### Evolutions (4 behavioral -- new subsystem targets)
- **E1**: Voice independence 0.5 -> 0.65, register arc chance 0.3 -> 0.5 (config.js VOICE_MANAGER). More contrapuntal voice motion; half of all phrases now get register arc shaping for octave-shifting contour variety.
- **E2**: Role swap frequency: MIN_PHRASES_BETWEEN_SWAPS 3 -> 2, SWAP_PROBABILITY 0.6 -> 0.75 (dynamicRoleSwap.js). Layers trade lead/support roles more frequently at tension valleys.
- **E3**: VARIETY_GAIN 0.04 -> 0.08 (structuralNarrativeAdvisor.js). Doubled pressure toward exploring under-represented composer families, preventing textural monotony.
- **E4**: SHARED_REST_PROBABILITY 0.15 -> 0.22, COMPLEMENT_FILL_THRESHOLD 0.6 -> 0.45 (restSynchronizer.js). More audible musical breathing (shared rests) and tighter hocket interleaving.

### Key Observations
- **First all-new-subsystem round**: All 4 evolutions target files never previously modified (voice manager, cross-layer dynamics, narrative advisor, rest synchronizer). Fresh territory.
- **Exploring-dominant**: coherentShare 0.0, exploringShare 1.0 at section level. maxConsecutiveCoherent only 20. System fully in exploration mode.
- **Sustained phase engagement**: phaseShareArc [0, 0.100, 0.094]. Both S1 (10%) and S2 (9.4%) deeply phase-engaged. Best sustained multi-section phase in the series.
- **Harmonic journey**: D# major -> A# major -> Bb major. Bold tritone-area leap (harmonicDistance 5) then enharmonic hold.
- **phaseGiniCorrelation r=-0.92** -- strong inverse maintained. Phase drives textural variety.
- **Compact form**: 223 beats across 3 sections. Tight, focused composition with asymmetric section lengths (132/30/61).
- **Clean exceedance**: S0 at 6.8%, S1-S2 at 0%. Warmup-only exceedance -- cleanest in series.
- **telemetryHealth: 0.38** (stable with R29). phaseStaleRate 0.64, varianceGatedRate 0.62.
- **tension max: 0.72**, density range 0.27-0.53. Narrower than R29's extremes but this is a default-profile shorter piece.

---

## R29 -- 2026-03-22 -- STABLE (second run)

**Profile:** explosive | **Beats:** 787 (5 sections: 50/137/178/97/156) | **Fingerprint:** R29a EVOLVED 1/10 (regimeDistribution), R29b STABLE 0/10

### Evolutions (4 behavioral -- musically focused)
- **E1**: Arch dynamism flat `() => 1.0` -> sinusoidal `(p) => 0.7 + sin(pi*p)*0.3` (config.js). Phrase arcs now breathe -- energy peaks mid-phrase and tapers at boundaries.
- **E2**: DRIFT_MAGNITUDE 0.09 -> 0.14 (regimeReactiveDamping.js). Larger velocity drift during exploring regime for wider signal wandering.
- **E3**: BIAS_CEILING 1.3 -> 1.38 (coherenceMonitor.js). Higher coherence feedback ceiling allows stronger density modulation. (Tried 1.45 first -- failed `density-ceiling-chain` tuning invariant at product 2.61 > 2.5; corrected to 1.38.)
- **E4**: stutterScale 1.15 -> 1.25 (conductorConfigTuningDefaults.js). More prominent stutter articulation in emission gating.

### Key Observations
- **Density range: 0.26-0.70** -- widest in entire series (was 0.30 in R28). E1 sinusoidal arcs + E3 ceiling boost creating real dynamic contrast.
- **Tension range: 0.05-0.85** -- widest ever (was 0.78 peak in R28). Full pp-to-ff arc.
- **12 regime transitions** -- most in entire series (was 6 in R28). E2 drift magnitude driving rapid signal evolution.
- **Harmonic journey**: F aeolian -> G minor -> B major -> F major -> D aeolian. Bold tritone leap S2->S3 (harmonicDistance: 2, 4, 6, 3). Dramatic harmonic arc with distant modulation.
- **787 beats** -- longest composition in the series. 5 sections with substantial middle (S2: 178 beats).
- **suppressionRatio: 1.03** -- near-perfect 1:1. Coherent regime barely suppresses phase anymore.
- **phaseShareArc**: [0, 0.060, 0.003, 0.019, 0.003]. S1 peak at 6% from coherent regime.
- **phaseGiniCorrelation r=-0.91** -- strong inverse relationship maintained.
- **telemetryHealth: 0.38** (down from 0.45). High phaseStaleRate 0.74 and varianceGatedRate 0.70 -- phase system active but volatile. Acceptable given dramatic signal diversity.
- S0 and S4 exceedance rates 0.22 and 0.25 -- bookend sections running hot but middle sections clean.

---

## R28 -- 2026-03-22 -- STABLE (first run)

**Profile:** default | **Beats:** 436 (4 sections: 98/78/30/106) | **Fingerprint:** STABLE (0/11)

### Evolutions (4 behavioral -- musically focused)
- **E1**: evolvingMinDwell 4 -> 8 (regimeClassifier.js). Evolving regime persists long enough to be audible.
- **E2**: Journey distance energy scaling /6 -> /5 (dynamismEngine.js). Bold harmonic moves drive more energetic output.
- **E3**: Stutter end-of-phrase boost 0.4 -> 0.5 (config.js DYNAMISM.stutterProb.end). Punchier phrase endings.
- **E4**: Regime-reactive MAX_FLICKER 0.15 -> 0.20 (regimeReactiveDamping.js). More timbral variety across regimes.

### Key Observations
- **playProb max: 0.58** (widest in series, was 0.55 in R27). E2+E3 widening dynamism.
- **Evolving beats: 12** (3x increase from R27's 4). E1 working -- evolving is now audible.
- **transitionCount: 6** (up from 5). More regime variety.
- **Harmonic journey**: G# locrian -> F# major -> C# aeolian -> E minor. Dark opening (locrian) through diverse modes. harmonicDistance: 2, 5, 3.
- **Flicker range: 0.79-1.16** (was 0.84-1.10 in R27). E4 widening timbral contrast.
- **tension max: 0.78** (excellent, consistent with R26's 0.82).
- **phaseGiniCorrelation r=-0.99** -- strongest ever. Near-perfect inverse relationship.
- **S0 exceedance: 0.12** (down from 0.44 in R27). Warmup behavior improving.
- **suppressionRatio: 0.03** -- coherent barely suppresses phase anymore. R25 E2 coherent pressure floor working brilliantly.

---

## Run History Summary

| Round | Date | Verdict | Profile | Beats | Synopsis |
|-------|------|---------|---------|-------|----------|
| R27 | 2026-03-22 | STABLE | explosive | 589 | Harmonic odyssey (C->D#locrian->G#->Db phrygian->C). Return-home bias 50%->30% expanded wandering. Phase S1-S2 >10%. |
| R26 | 2026-03-22 | STABLE | default | 370 | Tension max exploded to 0.82 (was 0.66). COHERENT_MAX_DWELL 120->90 transformed regime diversity. Phase 4x to 5.8%. |
| R25 | 2026-03-22 | STABLE | default | 493 | Exceedance 98->27 beats. Variance gate floor + coherent phase pressure floor synergy. Axis Gini arc tightest. |
| R24 | 2026-03-22 | STABLE (2nd) | explosive | 433 | Tonic stasis (entire piece on E). Palindromic modal arc. phaseGiniCorrelation r=-0.922. |
| R23 | 2026-03-22 | STABLE | explosive | 503 | Phase stable, low-amplitude oscillation. Axis Gini range 0.06 (best). First non-S0 exceedance since R18. |
| R22 | 2026-03-22 | STABLE | explosive | 581 | Cleanest exceedance (all zero). phaseGiniCorrelation weakened to -0.786. S3 179 beats stretching dynamics. |
| R21 | 2026-03-22 | STABLE | explosive | 551 | phaseGiniCorrelation r=-0.985 (strongest). Classic arch phase velocity. S0 exceedance down to 7.3%. |
| R20 | 2026-03-22 | STABLE (4th) | explosive | 497 | 3 EVOLVED re-runs. Explosive profile inherently volatile for regimeDistribution. |
| R19 | 2026-03-22 | STABLE | explosive | 461 | suppressionRatio 0.20 (best coherent-exploring parity). Phase peak centered at 0.50. |
| R18 | 2026-03-22 | STABLE | default | 220 | Phase stale rate reduced 12%. Axis Gini per-section tracking deployed. |
| R17 | 2026-03-22 | STABLE | explosive | 449 | phaseGiniCorrelation anomaly r=-0.205 (S3 only 29 beats). Phase share 55.2% in S3. |
| R16 | 2026-03-22 | STABLE (4th) | explosive | 635 | regimeDistribution tolerance widened to 0.20. S0 exceedance 20.9% identified as key target. |
| R15 | 2026-03-22 | STABLE | explosive | 602 | Exceedance dropped to 9 beats. Warmup ceiling expanded. phaseGiniCorrelation first measured r=-0.846. |
| R14 | 2026-03-22 | STABLE | explosive | 523 | phaseShareArc + section exceedance metrics deployed. Exceedance 59->27. |
| R13 | 2026-03-22 | STABLE | explosive | 501 | flicker-trust gap closed. density-trust ceiling confirmed. Flicker warmup 0.80x cut S0 exceedance 73%. |
| R12 | 2026-03-22 | STABLE | default | 261 | New era begins. 11 dimensions stable. Phase share 1.1% identified as key target. |
| R1-R3 | 2026-03-21 | STABLE | mixed | 324-868 | Era foundation. flicker-trust neutralized, phase gating halved, coupling tail management established. |

### Prior Era Summary

Over ~80 evolution rounds, Polychron grew from hardcoded coupling constants into a self-calibrating system of 17 hypermeta controllers supervised by hyperMetaOrchestrator (#17). Key gains: exceedance ~90->22 beats, variance gating halved (83%->43%), all four monitored coupling pairs under adaptive ceiling control. System closed era STABLE (0/11), manifest PASS, 716 globals, 437 files, 18 pipeline steps.
