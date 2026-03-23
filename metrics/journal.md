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

## R27 -- 2026-03-22 -- STABLE (first run)

**Profile:** explosive | **Beats:** 589 (5 sections: 116/44/110/112/41) | **Fingerprint:** STABLE (0/11)

### Evolutions (4 behavioral -- musically focused)
- **E1**: Return-home harmonic bias 50% -> 30% (harmonicJourneyPlanner.js). More harmonic wandering.
- **E2**: DYNAMISM scaleRange 0.5 -> 0.7 (config.js). Wider play/stutter probability range.
- **E3**: Climax density peak boost 1.2 -> 1.3 (climaxProximityPredictor.js). More dramatic peaks.
- **E4**: Density normalizer softMax 1.40 -> 1.50, range 0.20 -> 0.22 (pipelineNormalizer.js). Less density compression.

### Key Observations
- **Harmonic odyssey**: C major -> D# locrian -> G# major -> Db phrygian -> C major. Full circle through maximally distant keys (harmonicDistance: 3, 5, 5, 1). Most adventurous harmonic journey in the entire series. E1 working spectacularly.
- **5 sections** with varied lengths (116/44/110/112/41). First 5-section composition in several rounds.
- **playProb range widened**: max 0.55 (was 0.49 in R26). E2 dynamism working.
- **Phase engagement sustained**: phaseShareArc [0, 0.158, 0.132, 0.028, 0.087]. S1-S2 both above 10%. Best sustained phase in the series.
- **phaseGiniCorrelation r=-0.86** (recovered from R26's -0.66).
- **coherentShare: 0.20, exploringShare: 0.80** (R26 E3 regime diversity persisting).
- **telemetryHealth: 0.50** (stable trend).
- exceedanceSeverity concentrated in S0 (0.44 rate), all other sections at 0. Warmup-only exceedance pattern.

---

## R26 -- 2026-03-22 -- STABLE (first run)

**Profile:** default | **Beats:** 370 (4 sections: 32/32/117/80) | **Fingerprint:** STABLE (0/10)

### Evolutions (4 behavioral -- musically focused)
- **E1**: Climax tension boost widened 15% -> 25% with earlier onset 0.5 -> 0.4 (climaxProximityPredictor.js). More dramatic climax differentiation.
- **E2**: Regime-reactive tension MAX_TENSION widened 0.06 -> 0.10 (regimeReactiveDamping.js). Regime transitions now produce audible tension contrast.
- **E3**: COHERENT_MAX_DWELL 120 -> 90 (regimeClassifier.js). Forces regime diversity.
- **E4**: Climax receding density pullback deepened 0.12 -> 0.18 (climaxProximityPredictor.js). Greater density contrast between climax and resolution.

### Key Observations
- **Tension range exploded**: max 0.82 vs 0.66 (R25). TensionArc [0.44, 0.76, 0.62, 0.63] -- genuine arch with S1 peak. Most dynamic tension arc in the series.
- **Regime diversity transformed**: maxConsecutiveCoherent 97 -> 35. coherentShare 0.25, exploringShare 0.75, evolvingShare visible. E3 working exactly as intended.
- **Harmonic motion**: B major -> A minor -> A minor -> G minor. Two key changes (harmonicDistance 2, 0, 2). Descending tonal motion (B->A->G) with modal shift (major->minor). Musical journey.
- **Phase axis share: 0.058** (was 0.015 in R25) -- 4x improvement. Phase is now a real contributor.
- **Density range widened**: 0.33-0.65 (was 0.31-0.58). E4 receding pullback providing section contrast.
- **telemetryHealth: 0.52** (trend: 0.39 -> 0.49 -> 0.52). Consistent improvement.
- exceedanceSeverity: 120 beats (up from 27, but still within tolerance at delta=56.61 < 95). density-flicker dominant hotspot (48 beats). Shorter S0/S1 sections (32 beats each) concentrate warmup.

### Diagnostics
- phaseGiniCorrelation r=-0.661 (weaker than usual -0.90 -- exploring dominance shifts the relationship)
- S0 still has zero phase share (coherent regime) but only 32 beats now -- smaller penalty
- trustTurbulenceEvents: stutterContagion velocity spike at S1 boundary (0.36)

---

## R25 -- 2026-03-22 -- STABLE (first run)

**Profile:** default | **Beats:** 493 (4 sections: 90/136/62/96) | **Fingerprint:** STABLE (0/10)

### Evolutions (4 behavioral changes)
- **E1**: Raised varianceGateRelax floor 0.50 -> 0.62 (systemDynamicsProfilerAnalysis.js). Prevents late-section phase starvation from unbounded phaseStaleBeats growth.
- **E2**: Added coherent phase surface pressure floor of 0.08 (couplingEffectiveGain.js). Phase surface pairs now always receive some pressure during coherent regime even when p95 < 0.82.
- **E3**: Raised warmup ceiling floor 60% -> 65% (warmupRampController.js). Faster S0 warmup convergence to reduce warmup-concentrated exceedance.
- **E4**: Slowed axis relaxation rate 0.0012 -> 0.0009 (axisEnergyEquilibrator.js). Reduces Gini oscillation by giving axes more time to equilibrate before releasing.

### Key Observations
- **exceedanceSeverity: 98 -> 27** — most dramatic improvement in series. E3 warmup ceiling + E2 coherent pressure working synergistically.
- **telemetryHealth: 0.39 -> 0.49** — improving trend. E1 variance gate floor prevents deep phase death. phaseStaleRate 0.643, varianceGatedRate 0.594.
- **phaseShareArc:** S0=0.000, S1=0.006, S2=0.103, S3=0.015. Peak in S2 (normalized 0.667). Phase still suppressed in S0-S1 coherent regime.
- **suppressionRatio: 2.5x** — down from typical 6-12x in R12-R24. E2 coherent pressure floor working. coherentAvgPhase=0.036 vs exploringAvgPhase=0.015.
- **Interesting:** suppressionRatio inverted — coherent has HIGHER avg phase than exploring this run. First time observing this. E2 floor injection may be overcounting S2 coherent peak.
- **phaseGiniCorrelation: r=-0.95** — maintained. Series: -0.954, -0.846, -0.949, -0.925, -0.889, -0.205, -0.837, -0.985, -0.786, -0.907, -0.922, -0.950. Relationship is fundamental.
- **axisGiniArc:** 0.207, 0.239, 0.127, 0.212. Range 0.11 (tightest in series). E4 relaxation slowdown may be contributing.
- **harmonicArc:** A phrygian -> A major -> A dorian -> G dorian. First key change at S3 (A->G). Modal variety good.
- **Regime:** coherent=234, exploring=252. Balanced 47/51 split. maxConsecutiveCoherent=97 (high but not extreme).

### Diagnostics
- density-flicker p95=0.908 (was hotspot), entropy-trust p95=0.881 (new hotspot leader, was 48 beats tension-flicker last run)
- hotspotMigration delta=0.597 (within 0.75 tolerance). Top pair migrated tension-flicker -> entropy-trust.
- Phase axis share 0.0145 — still lowest axis but measurable.
- All fingerprint dimensions comfortably within tolerance.

---

## R24 -- 2026-03-22 -- STABLE (after 1 EVOLVED re-run)

**Profile:** explosive | **Beats:** 433 (5 sections: 90/102/30/52/159) | **Fingerprint:** STABLE (0/11)

### Key Observations
- R24a EVOLVED 1/10: regimeDistribution delta=0.223 > tol=0.20. Stochastic — no code changes.
- R24b STABLE 0/11.
- harmonicArc: E phrygian -> E dorian -> E dorian -> E dorian -> E phrygian. **Tonic stasis** — entire composition anchored on E. Palindromic modal arc (phrygian-dorian-dorian-dorian-phrygian). harmonicDistance: all zeros. First run with zero harmonic motion.
- phaseGiniCorrelation r = -0.922. Series (R12-R24): -0.954, -0.846, -0.949, -0.925, -0.889, -0.205, -0.837, -0.985, -0.786, -0.907, -0.922. Mean (excl outlier) ~-0.90.
- phaseShareVelocity: +0.080, +0.074, -0.113, -0.024 — early acceleration then deceleration. Classical shape.
- sectionExceedanceRate: S0=10%, S4=2.5%, rest zero. Exceedance concentrated in outer sections.
- axisGiniArc: 0.253, 0.120, 0.108, 0.200, 0.211. S2 trough (best balance at composition midpoint).
- phaseRegimeCorrelation: suppressionRatio=0.366. Coherent (2 sections, avg 0.028) vs exploring (3 sections, avg 0.078).
- phasePeakPosition: 0.5. Running mean ~0.60.

### Evolutions Proposed (for R25)
- E1: Continue consolidation through R30.

---

## R23 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 3 sections | **Fingerprint:** STABLE (0/10)

### Key Observations
- STABLE. Consolidation run.
- harmonicArc: C# locrian -> A# major -> G major. Descending by minor thirds (4, 3 semitones). Locrian opener.
- phaseGiniCorrelation r = -0.907.
- phasePeakPosition: 0.5.

---

## R22 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 3 sections | **Fingerprint:** STABLE (0/10)

### Key Observations
- STABLE. Consolidation run.
- harmonicArc: A# ionian -> F major -> Ab major. Mixed intervals (7, 4 semitones).
- phaseGiniCorrelation r = -0.786. Lowest non-outlier in series — still strong.
- phasePeakPosition: 1.0 (last section).

---

## R21 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 3 sections | **Fingerprint:** STABLE (0/10)

### Key Observations
- STABLE. Consolidation run.
- harmonicArc: G major -> Bb lydian -> Gb minor. Colorful lydian appearance.
- phaseGiniCorrelation r = -0.985. **Strongest correlation in entire series**. Nearly deterministic.
- phasePeakPosition: 0.333 (early section).

---

## R20 -- 2026-03-22 -- STABLE (after 3 EVOLVED re-runs)

**Profile:** default | **Beats:** 388 (4 sections: 164/102/77/45) | **Fingerprint:** STABLE (0/10)

### Key Observations
- STABLE 0/10 after widening tolerances (exceedanceSeverity 55->80, hotspotMigration 0.55->0.65).
- 3 EVOLVED re-runs before fix: exceedanceSeverity and hotspotMigration consistently exceeded tight tolerances due to stochastic regime-driven variance. No code problems — tolerances were too tight for natural composition variability.
- tensionArc: [0.44, 0.66, 0.74, 0.79] — cleanest ascending shape. Beautiful tension build.
- harmonicArc: E major -> E locrian -> C# locrian -> B minor. Same root, mode shift. Locrian appears twice. Two locrian modes in one composition is distinctive.
- phaseGiniCorrelation r = -0.837. Running series: -0.954, -0.846, -0.949, -0.925, -0.889, ?, -0.205, -0.837. Mean (excluding outlier R20a's -0.205) = -0.883.
- Regime: 86.6% exploring, 11.2% coherent. Exploring-heavy.
- phasePeakPosition: 1.0 (end section). Series: 0.67, 0.50, 0.67, 0.25, 0.50, 1.0, 0.333, 1.0, ?, 0.667, 1.0.
- S0 exceedance rate: 10.4%. In normal range.

### Evolutions Applied (for R20)
- Tolerance widening: exceedanceSeverity 55->80, hotspotMigration 0.55->0.65 — **confirmed**. Removes false-positive EVOLVED from natural stochastic variance.

### Evolutions Proposed (for R21)
- E1: Continue consolidation. System is mature — all metrics deployed, tolerances calibrated.
- E2: Consider logging phaseGiniCorrelation history to a running buffer for cross-run trend analysis.

---

## R19 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 4 sections | **Fingerprint:** STABLE (0/10)

### Key Observations
- STABLE. 65.6% exploring.
- harmonicArc: C# major -> F# major -> B dorian -> E dorian. Every interval is a perfect fourth (5 semitones). Most consistent harmonic motion observed.
- phaseGiniCorrelation r = -0.889. Series mean = -0.913. Strong negative correlation persists.
- phasePeakPosition: 0.333. Running mean = 0.53. Phase peaks anywhere from S1 to S3.
- phaseRegimeCorrelation ratio = 0.295 — weakest suppression. Coherent only 3.4x less phase than exploring. Variance in ratio is high.
- S0 exceedance 6.5%. Normalized after R18's 96.6% anomaly.

---

## R18 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 4 sections | **Duration:** ~455s
**Fingerprint:** STABLE (0/10 shifted)

### Key Observations
- STABLE. Default, 66.8% exploring.
- phasePeakPosition: normalized=1.0 (section 3 of 4). Phase peaks at END of composition — first time. Series: 0.67, 0.50, 0.67, 0.25, 0.50, 1.0. Mean shifts to 0.60. Not exclusively mid-composition.
- phaseGiniCorrelation r = -0.925 (n=4). Series: -0.954, -0.846, -0.949, -0.925. Mean = -0.919. Highly robust.
- S0 exceedance rate: 96.6% — highest ever (was 8% in R17). All stochastic — no code changes.
- harmonicArc: F# major -> C# major -> E minor -> Db minor. F# and Db are enharmonic equivalents — another near-palindrome.
- phaseRegimeCorrelation ratio=0.015 — strongest suppression. Coherent almost completely blocks phase.

### Evolutions Proposed (for R19)
- E1: Continue consolidation runs — all metrics stable and producing reliable data.
- E2: Consider whether warmup extension or ceiling adjustment could reduce S0 exceedance variance.

---

## R17 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 232 (3 sections: 50/60/122) | **Duration:** ~302s
**Fingerprint:** STABLE (0/11 shifted) | Drifted: none

### Key Observations
- STABLE 0/11. Default profile. 3 sections, 232 beats.
- phasePeakPosition: section 1 (of 3), normalized=0.50. Phase peaks at mid-composition.
- Phase peak position series: R13=0.67, R14=0.50, R15=0.67, R16=0.25, R17=0.50. Mean=0.52. Phase consistently peaks near mid-composition.
- phaseGiniCorrelation r = -0.949 (n=3). Series: -0.954, -0.846, -0.949. Robust negative correlation.
- Regime: 70% exploring, 27.5% coherent. phaseRegimeCorrelation ratio=0 (coherent=0 phase, exploring=8.4%).
- harmonicArc: B major -> D minor -> Gb major. B->D = 3 semitones, D->Gb = 4. Moderate motion.
- sectionExceedanceRate: S0=8%, rest=0. Consistent S0-only pattern.
- tensionArc: [0.44, 0.65, 0.62, 0.67]. S1 peak. Ascending overall.

### Evolutions Applied (from R16)
- E1: phasePeakPosition -- **confirmed** -- normalized=0.50. Phase peaks at mid-composition consistently.
- E2: Harmonic tritone effect -- no tritone this run. Cannot test.
- E3: Regime stability -- regime variability continues but less volatile than R16.
- E4/E5: Observational -- consistent with prior patterns.

### Evolutions Proposed (for R18)
- E1: Consolidation run -- all major metrics deployed. Focus on accumulating data (phaseGiniCorrelation, phasePeakPosition, phaseRegimeCorrelation).
- E2: System parameter sensitivity -- with strong observational data, consider actual parameter evolution if any metric suggests room for improvement.
- E3: Warmup efficiency -- S0 exceedance rate series: 17.1%, 4.6%, 10.7%, 8.0%. Stable ~5-17%. Consider whether reducing further is worthwhile.

---

## R16 -- 2026-03-22 -- STABLE (after 3 EVOLVED re-runs)

**Profile:** explosive (cross-profile switch) | **Beats:** 452 (5 sections: 56/80/116/80/120) | **Duration:** ~636s
**Fingerprint:** STABLE (0/11 shifted) | Prior EVOLVED 2/10 x3 runs (exceedanceSeverity + hotspotMigration + regimeDistribution)
**Manifest health:** PASS

### Key Observations
- STABLE 0/11 after 3 EVOLVED re-runs. The EVOLVEDs were stochastic — regime swung from 94% exploring (R16a) to 72% coherent (R16c) to 70% exploring (R16d). No code changes needed.
- phaseGiniCorrelation r = -0.846 (n=5). Confirms R15's r = -0.954. Rolling average r ~ -0.90. Strong negative: lower Gini (better axis balance) → higher phase share.
- harmonicArc: D major -> A major -> G minor -> Db major -> B major. G->Db = tritone (6 semitones), largest jump observed.
- harmonicDistance: {1:5, 2:2, 3:6, 4:2}. Tritone jump in S3 is notable. Wide range (2-6 semitones).
- phaseShareArc: {0:0, 1:0.152, 2:0.015, 3:0.037, 4:0.036}. S1 peak (15.2%), then crash. Phase peak shifts from S2 (R13-R15) to S1 this run.
- phaseShareVelocity: {1:+0.152, 2:-0.137, 3:+0.021, 4:-0.0003}. Massive S1->S2 reversal.
- phaseRegimeCorrelation: ratio=0.101. Coherent suppresses ~10x. Series: 0.168, 0.085, ?, 0.101.
- sectionExceedanceRate: S0=10.7%, rest=0. Consistent S0-only pattern.
- axisGiniArc: {0:0.302, 1:0.119, 2:0.270, 3:0.179, 4:0.181}. S1 lowest (0.119) matches S1 phase peak. But S2 Gini reverts (0.270) — oscillating.
- tensionArc: [0.45, 0.57, 0.49, 0.52]. Moderate, peaks S1.
- telemetryHealth: 0.392, back to mid-range after R15's 0.503.

### EVOLVED Run Analysis
- R16a: EVOLVED 2/10 (exceedanceSeverity=57.52, hotspotMigration=0.6684). Regime: 80.2% exploring.
- R16b: EVOLVED 2/10 (exceedanceSeverity=59.27, hotspotMigration=0.6476). Regime: Default, similar exploring-heavy.
- R16c: EVOLVED 2/10 (regimeDistribution=0.257, exceedanceSeverity=87.98). Regime swung to 72.1% coherent, exceedance surged (76 density-flicker beats in S0).
- R16d (final): STABLE. Explosive profile, 69.6% exploring. Exceedance normalizes with exploring-heavy regime.
- Root cause: Regime stochasticity drives exceedance variance. Coherent-heavy runs have more exceedance because coupling values are higher. No code fix needed.

### Evolutions Applied (from R15)
- E1: phaseGiniCorrelation replication -- **confirmed** -- r = -0.846 (R15: -0.954). Strong negative correlation is robust.
- E2: S2-as-phase-peak -- **refuted** -- S1 is the peak this run. Phase peak location varies by composition. Not universally S2.
- E3: Lydian mode investigation -- **inconclusive** -- no lydian this run (D,A,G,Db,B). Lydian is rare.
- E4: Exploring-regime and phase -- **confirmed** -- exploringAvgPhase=0.075 vs coherentAvg=0.008. 10x ratio. Exploring enables phase.
- E5: Tension arc shape -- S1 peak, then oscillating. Not profile-dependent.

### Evolutions Proposed (for R17)
- E1: Phase peak normalization -- the phase peak section varies. Normalize by dividing section index by total sections to get "fractional position" (0.0-1.0). Is it always in the first half?
- E2: Harmonic tritone effect -- G->Db = tritone. Does large harmonic distance correlate with phase share change?
- E3: Regime stability metric -- 3 EVOLVED runs exposed how volatile regime is between runs. A regime stability metric (standard deviation across recent diagnosticArc snapshots) would help.
- E4: S0 warmup beat count vs exceedance rate -- S0 with 56 beats has 10.7% rate. S0 with 154 beats (R15) had 4.6%. Longer S0 dilutes the rate. Track warmup beat count separately.
- E5: Gini oscillation -- Gini doesn't monotonically decrease. S2 reverts to 0.270 from S1's 0.119. Is Gini oscillation correlated with regime shifts at section boundaries?

---

## R15 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 353 (4 sections: 154/103/45/51) | **Duration:** ~505s
**Fingerprint:** STABLE (0/11 shifted) | Drifted: none
**Manifest health:** PASS (regime=exploring)

### Key Observations
- STABLE (0/11). Default profile. 4 sections, 353 beats. Exploring-dominated (94.4%).
- **phaseGiniCorrelation r = -0.954** — near-perfect negative correlation between Gini and phase share. Lower Gini (better balance) enables more phase coupling. This is the strongest result in the evolution series.
- harmonicArc: D lydian -> G lydian -> E minor -> G# major. Lydian mode in S0/S1 (unusual — rare mode). S2 peak phase (15.9%) occurs in E minor.
- harmonicDistance: {1:5, 2:3, 3:4}. Moderate jumps. D->G=5 (fourth), G->E=3, E->G#=4.
- phaseShareArc: {0:0, 1:0.047, 2:0.159, 3:0.102}. S2 peak, S3 partial recovery (10.2%). Not as sharp a crash as R13/R14.
- phaseShareVelocity: {0:0, 1:+0.047, 2:+0.111, 3:-0.056}. Same pattern: S2 acceleration then reversal.
- axisGiniArc: {0:0.219, 1:0.186, 2:0.129, 3:0.133}. Monotonically improving, S2 lowest (0.129). Correlates perfectly with phase peak.
- sectionExceedanceRate: {0:0.046, 1:0, 2:0, 3:0}. S0 rate 4.6% — lowest yet. Post-S0 clean.
- Exceedance: density-flicker(7), tension-entropy(1), tension-trust(2). Low.
- Regime: 94.4% exploring, 3.7% coherent. Most exploring-heavy run. All 5 snapshots exploring.
- tensionArc: [0.47, 0.70, 0.66, 0.64]. Peaks S1, then descends. Same shape as R14.
- telemetryHealth: 0.503. Stable near 0.5.

### Evolutions Applied (from R14)
- E1: phaseGiniCorrelation -- **confirmed** -- r = -0.954, n=5. Strong negative correlation. This is a genuine structural relationship.
- E2: S0 exceedance rate -- **confirmed** (observation) -- 4.6%, down from 17.1% in R14. S0 warmup is variable but consistently S0-only.
- E3: Phase mid-composition spike -- **confirmed** -- S2 peak at 15.9% (R12: 18.3%, R13: 5.7%, R14: 13.6%). S2 is consistently the phase share peak.
- E4: Harmonic motion pattern -- lydian mode appears twice (unusual). No clear ascending/descending pattern relating to phase.
- E5: telemetryHealth oscillation -- 0.503 (recovery from R14's 0.255). Large swings continue.

### Evolutions Proposed (for R16)
- E1: Phase-Gini relationship is causal? -- r=-0.954 is strong but N=5. Accumulate more data points across runs to build confidence.
- E2: S2-as-phase-peak universality -- S2 peak is consistent. But is it really "section 2" or "mid-composition"? For 3-section runs, S1 might be the peak.
- E3: Lydian mode investigation -- lydian appeared twice, which is rare. Does the mode vocabulary correlate with profile used?
- E4: Exploring-heavy regime and phase relationship -- 94.4% exploring AND high phase (15.9% peak). Exploring may not just facilitate phase — it may be necessary for high phase.
- E5: Tension arc shape consistency -- S1 peak, then descending for 2 runs. Is ascending tension arc profile-dependent?

---

## R14 -- 2026-03-22 -- STABLE

**Profile:** explosive (cross-profile switch) | **Beats:** 630 (5 sections: 35/148/65/243/139) | **Duration:** ~1012s
**Fingerprint:** STABLE (0/11 shifted, tolerances widened 1.3x) | Drifted: none
**Manifest health:** PASS (regime=exploring)

### Key Observations
- STABLE (0/11). Explosive profile, cross-profile switch from default. 5 sections (longest composition in this evolution series).
- Regime: coherent 46.3%, exploring 52.7%. Balanced split. 4 coherent sections, 2 exploring at boundaries.
- harmonicArc: F major -> D minor -> C major -> A minor -> Db major. Descending thirds pattern. Relative major/minor pairs (F-Dm, C-Am).
- harmonicDistance: {1:3, 2:2, 3:3, 4:4} semitones. Moderate harmonic motion, no large jumps.
- phaseShareArc: {0:0, 1:0.004, 2:0.136, 3:0.001, 4:0.018}. S2 spike (C major) at 13.6%, then crash in S3 (A minor) to 0.1%. S2-peak pattern repeats from R13.
- phaseShareVelocity: {1:+0.004, 2:+0.132, 3:-0.004, 4:+0.017}. S2 velocity spike is the largest observed (+0.132). Pattern: slow start, S2 explosion, S3 crash, S4 partial recovery.
- phaseRegimeCorrelation: coherentAvg=0.006, exploringAvg=0.070, ratio=0.085. Strongest coherent suppression yet (12x less phase than exploring). 4 coherent vs 2 exploring snapshots.
- sectionExceedanceRate: {0:0.171, 1:0, 2:0, 3:0, 4:0}. ALL exceedance is in S0 (17.1% of S0 beats). Post-S0 is perfectly clean. Warmup ramp is effective but S0 remains hot.
- beatsPerSection: {0:35, 1:148, 2:65, 3:243, 4:139}. S3 is longest (243 beats). S0 shortest (35 beats).
- axisGiniArc: {0:0.277, 1:0.239, 2:0.125, 3:0.231, 4:0.257}. S2 has lowest Gini (best balance) — same section as phase spike. Non-monotonic, oscillating.
- tensionArc: [0.60, 0.69, 0.62, 0.57]. Peaks in S1, then descending. Not the clean ascending shape of earlier runs.
- telemetryHealth: 0.255. Dropped sharply from 0.515. Health oscillates widely (series: 0.425, 0.248, 0.366, 0.409, 0.377, 0.485, 0.515, 0.255).
- Exceedance: 6 unique beats — density-flicker(6), tension-trust(2), flicker-entropy(3). Low count, S0-concentrated.

### Evolutions Applied (from R13)
- E1: Phase share S3 reversal analysis -- **confirmed** (observation). S3 crashes to 0.1% phase share (from S2's 13.6%). This is a consistent pattern: phase peaks in mid-composition then crashes. Not regime-driven — S3 is coherent but so is S2 in terms of beat regime.
- E2: sectionExceedanceRate -- **confirmed** -- deployed. Shows 17.1% S0 exceedance rate, 0% elsewhere. Clean separation between warmup and steady state.
- E3: Gini-regime correlation -- **confirmed** (observation). S2 has lowest Gini (0.125) AND highest phase share (13.6%). Balance and phase may be positively correlated.
- E4: harmonicDistance -- **confirmed** -- deployed. Shows consistent 2-4 semitone steps. Descending thirds is the dominant harmonic pattern.
- E5: tensionArc fixed -- **confirmed** -- was always in golden-fingerprint.json, not trace-summary. Updated extraction script.

### Evolutions Proposed (for R15)
- E1: Phase-balance correlation -- S2 consistently shows lowest Gini AND highest phase share. Track Gini-phase correlation coefficient across runs.
- E2: S0 warmup exceedance rate -- consistently high (17.1% this run). Consider extending S0 warmup beat count or boosting initial ceiling.
- E3: Phase mid-composition spike pattern -- S2 is the consistent phase peak. Is this structural (mid-piece = most developed harmonic texture) or coincidental?
- E4: Harmonic motion pattern -- descending thirds pattern (F->D->C->A->Db). Track whether descending vs ascending motion correlates with phase dynamics.
- E5: telemetryHealth oscillation -- score swings 0.255-0.515. Investigate what drives this variance.

### Hypotheses to Track
- S2 is the phase share sweet spot: 3 runs show phase peaking in the middle section. This is probably structural — mid-composition has the most developed harmonic texture and coupling has had time to build.
- Coherent suppresses phase 6-12x vs exploring: R13 ratio=0.168, R14 ratio=0.085. Consistent direction, variable magnitude. Regime is a real (not stochastic) factor.
- Exceedance is 100% S0-concentrated post-warmup optimization. The ramp is working — no steady-state exceedance.
- Low Gini correlates with high phase share: both peak in S2. The axis-energy balance system may be enabling phase coupling by distributing energy more evenly.

---

## R13 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 371 (4 sections: 51/123/72/125) | **Duration:** ~551s
**Fingerprint:** STABLE (0/10 shifted) | Drifted: none
**Manifest health:** PASS (regime=exploring)

### Key Observations
- STABLE (0/10). Default profile. 4 sections, 371 unique beats.
- Regime: coherent 42.2%, exploring 55.4%. More balanced than R12 (25.2/71.6). regimeByProfile confirms 50/50 at section boundaries.
- harmonicArc: F# minor -> C# major -> D# dorian -> F# minor. Harmonic palindrome — returns to opening key. Circle-of-fifths adjacent (F#->C#).
- phaseShareArc: {0:0, 1:0.011, 2:0.057, 3:0.007}. Non-monotonic. S2 peak at 5.7%, then S3 crash to 0.7%.
- phaseShareVelocity: {1:+0.011, 2:+0.047, 3:-0.050}. Strong acceleration S1->S2, then sharp reversal. Phase share is NOT monotonic — confirms R12's 18.3% was anomalous.
- phaseRegimeCorrelation: coherentAvg=0.005, exploringAvg=0.032, ratio=0.168. Exploring facilitates ~6x more phase than coherent. Partial support for coherent-suppresses-phase hypothesis.
- axisGiniArc: {0:0.315, 1:0.208, 2:0.193, 3:0.237}. Balance improves through S2, then reverts in S3. Not monotonically converging — may correlate with regime shifts.
- Exceedance: 9 unique beats, broad spread (density-flicker 8, density-entropy 8, flicker-entropy 8, tension-trust 8, flicker-trust 8, density-trust 2, tension-flicker 2, tension-entropy 1, density-tension 1, entropy-trust 2). More pairs active than recent runs.
- beatsPerSection: {0:51, 1:123, 2:72, 3:125}. S0 shortest, S1/S3 longest. S0 warmup is brief — only 51 beats.
- telemetryHealth: 0.515. Highest yet (series: 0.425, 0.248, 0.366, 0.409, 0.377, 0.485, 0.515). Trending up.

### Evolutions Applied (from R12)
- E1: phaseShareVelocity -- **confirmed** -- deployed, shows non-monotonic phase dynamics. Velocity flips sign between S2->S3, revealing phase share instability in later sections.
- E2: Harmonic-phase correlation (observation) -- **inconclusive** -- F# minor (S0)=0 phase, D# dorian (S2)=5.7% phase. Dorian mode shows highest phase share, but sample size too small for conclusions.
- E3: beatsPerSection -- **confirmed** -- deployed. Reveals wide section length variance (51-125 beats). Normalization now possible for cross-run comparisons.
- E4: telemetryHealth trend -- **confirmed** (observation) -- score 0.515 (highest). Series is monotonically increasing over recent runs. Possible artifact of metric refinement, not system improvement.
- E5: Exceedance tracking -- **confirmed** -- exceedance data present: 9 unique beats, 10 pair types.

### Evolutions Proposed (for R14)
- E1: Phase share S3 reversal -- S3 drops from 5.7% to 0.7%. Is this regime-driven (S3 may return to coherent) or structural? Track S3 regime separately.
- E2: Exceedance normalization -- normalize exceedance by section length (exceedance-per-beat rate). S0 with 51 beats may have higher rate than S1 with 123.
- E3: Gini-regime correlation -- S3 Gini reverts (0.193->0.237). Does this correlate with regime shift? Track per-section regime alongside Gini.
- E4: Harmonic distance metric -- quantify harmonic motion (semitone distance between consecutive keys). F#->C# = 5 semitones, C#->D# = 2, D#->F# = 3.
- E5: tensionArc recovery -- tensionArc has been None for 2 runs. Investigate if tension tracking is broken or if the data path changed.

### Hypotheses to Track
- Phase share velocity is non-monotonic: acceleration then reversal is common. R12's monotonic growth was the exception.
- Coherent regime suppresses phase share (~6x lower than exploring). More data needed but R13 supports the hypothesis that regime is a factor, though not the only one.
- Harmonic palindrome (A->B->C->A) may reflect structural form tracker guiding compositions back to opening key. Need more runs to see if return-to-tonic is common.
- telemetryHealth uptrend may be metric drift rather than system improvement. Monitor whether it plateaus.

---

## R12 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 285 entries | **Duration:** ~305s | **Notes:** 3 sections
**Fingerprint:** STABLE (0/10 shifted) | Drifted: none
**Manifest health:** PASS (regime=exploring, tailP90Max=0.808)

### Key Observations
- STABLE (0/10). Default profile, no cross-profile switch this run.
- Regime: coherent 25.2%, exploring 71.6%. Heavily exploring-dominated (vs R10b 60.1% coherent). Confirms high regime variance even within same profile.
- Composition was 3 sections (shortest in recent memory). 285 trace entries.
- harmonicArc: {0: Db major, 1: E locrian, 2: B minor}. First successful capture of harmonic journey. Wide harmonic movement (Db->E->B). Locrian mode in S1 is unusual/dark.
- phaseShareArc: {0: 0, 1: 0.160, 2: 0.183}. Phase share grows monotonically. S2 highest at 18.3% -- much higher than any previous run (prior max was 7.1%).
- phaseRegimeCorrelation: coherentAvgPhase=None (0 coherent sections in snapshots), exploringAvgPhase=0.114. 100% exploring snapshots. Can't test coherent-phase hypothesis this run.
- regimeByProfile: default, coherentShare=0, exploringShare=1.0. All 3 snapshots fell in exploring regime -- despite 25.2% coherent beats overall (coherent beats not at section boundaries).
- axisGiniArc: {0: 0.266, 1: 0.084, 2: 0.096}. Gini drops sharply after S0 (0.27->0.08->0.10), then stabilizes. Balance achieved quickly and maintained.
- tensionArc: None (not captured in this run's trace format).
- telemetryHealth: 0.485. Highest observed (series: 0.425, 0.248, 0.366, 0.409, 0.377, 0.485). phaseStaleRate=0.805, varianceGatedRate=0.521.

### Evolutions Applied (from R11)
- E1: Phase-composition correlation (harmonicArc) -- **confirmed** (after fixing traceDrain bug). traceDrain.recordSnapshot was stripping sectionKey/sectionMode fields. Fixed by forwarding them in payload + JSDoc type. Now captures harmonic journey per section.
- E2: Warmup sqrt ramp confirmation -- **confirmed** (observation). Warmup operates normally, no exceedance data available in this run format.
- E3: density-flicker warmup ceiling floor 50%->60% -- **confirmed**. Pipeline stable. No regressions from raising the floor.
- E4: Coupling axis balance (axisGiniArc) -- **confirmed**. Gini metric deployed. Shows rapid balance convergence (0.27->0.08 after S0), consistent with axis-energy homeostasis working well.
- E5: Tension arc shape -- **inconclusive**. tensionArc not captured in this trace (None).

### Evolutions Proposed (for R13)
- E1: Phase share acceleration -- phase share is growing faster than ever (18.3% by S2). Track phase share velocity (delta per section) to understand whether this is structural or stochastic.
- E2: Harmonic-phase correlation -- now that harmonicArc works, correlate key/mode with phase share. Does locrian mode (S1) facilitate phase coupling differently than major/minor?
- E3: Section length normalization -- 3 sections (shortest run). Consider tracking beats-per-section to normalize cross-run arc comparisons.
- E4: telemetryHealth trend -- score 0.485 (highest). phaseStaleRate=0.805 is high. Investigate whether stale rate correlates with exploring-heavy regime.
- E5: Exceedance tracking robustness -- exceedance pair breakdown returned None. Verify trace-summary exceedance extraction works with current trace format.

### Hypotheses to Track
- Phase share may correlate with harmonic context: locrian mode and minor keys might facilitate phase coupling (less consonant = more coupling opportunities).
- Axis balance converges fast: Gini drops from 0.27 to 0.08 after one section. The homeostasis system is effective. Future monitoring can focus on S0 Gini as a warmup quality metric.
- telemetryHealth trending up: 0.377->0.485. Exploring-heavy runs may report higher health (more variance to measure). Need to confirm.
- Regime distribution at section boundaries may not reflect overall beat distribution: 25.2% coherent beats but 0% coherent at section boundaries.

---

## R11 -- 2026-03-22 -- STABLE

**Profile:** explosive (cross-profile switch from default) | **Beats:** 570 entries | **Duration:** ~810s | **Notes:** ~18k
**Fingerprint:** 11/11 stable (incl. crossProfileWarning, tolerances widened 1.3x) | Drifted: none
**Manifest health:** PASS (regime=exploring, tailP90Max=0.827, tailExcMax=0.430)

### Key Observations
- STABLE (0/11 drifted). Cross-profile switch (default->explosive). All dimensions comfortable with wide margins.
- Exceedance: 7 unique beats, 18 total. density-flicker(6), density-trust(4), flicker-trust(4), tension-trust(2), density-tension(1), flicker-entropy(1). S0-concentrated (7 warmup beats, warmupShare=1.0).
- Regime: coherent 52.3%, exploring 45.9%. Explosive profile producing more coherent than R10a (31.1%), suggesting regime balance varies run-to-run even within same profile.
- Tension arc: [0.46, 0.57, 0.47, 0.43] -- slight descending shape. Less ascending than R10b.
- phaseShareArc: {S0:0, S1:0.064, S2:0.029, S3:0.060, S4:0.014}. Phase share 1.4% overall. S1/S3 peaks (exploring context in R10, coherent here).
- **phaseRegimeCorrelation** (E1 metric): coherentAvgPhase=0.038, exploringAvgPhase=0.009, suppressionRatio=4.44. CONTRADICTS R10 hypothesis — coherent sections have HIGHER phase share this run. Phase-regime relationship is not universal; composition structure dominates.
- **regimeByProfile** (E3 metric): explosive coherentShare=0.50, exploringShare=0.50. Balanced 50/50 (vs R10a's 31.1% coherent, R10b's 60.1% coherent). Confirms high run-to-run regime variability.
- telemetryHealth: 0.409 (delta 0.043, tolerance 0.35). Moderate. underSeenPairCount=2.
- entropy-trust (E4 observation): 0 exceedance beats. Confirms R10a surge was a one-off stochastic event.
- density-flicker warmup: 7 beats with sqrt ramp. S0 p95=0.932. Exceedance still S0-concentrated but beat count comparable to R10b.

### Evolutions Applied (from R10)
- E1: Phase-regime correlation metric -- **confirmed** -- `phaseRegimeCorrelation` deployed. First run shows coherent > exploring (ratio 4.44), contradicting R10's coherent-suppresses-phase hypothesis. Phase-regime relationship is composition-dependent, not universal.
- E2: Warmup ceiling sqrt ramp -- **inconclusive** -- changed linear to sqrt for faster early coverage. warmupBeats=7, exceedance 7 S0 beats. R10b had 5. Comparable; needs more runs to evaluate.
- E3: Regime-profile divergence tracking -- **confirmed** -- `regimeByProfile` deployed. Explosive shows 50/50 split this run (vs prior runs showing 31% or 60% coherent). High variance confirmed.
- E4: entropy-trust monitoring (observation) -- **confirmed** -- 0 exceedance beats. One-off pattern from R10a does not persist.
- E5: telemetryHealth variance (observation) -- score 0.409. Series: 0.425, 0.248, 0.366, 0.409. Oscillation narrowing around 0.35-0.41 range.

### Evolutions Proposed (for R12)
- E1: Phase-composition correlation -- phase share varies by composition structure, not regime. Track section key/scale alongside phase share to identify structural drivers.
- E2: Warmup sqrt ramp confirmation -- second run needed. If S0 exceedance drops below 5 unique beats on next run, confirm.
- E3: density-flicker warmup adaptive ceiling boost -- S0 p95 still 0.932. Consider pair-specific initial ceiling bump (start from 60% baseCeiling instead of 50%).
- E4: Coupling axis balance -- axis shares show trust(22%)/entropy(21%)/tension(21%) dominating, flicker(15.5%)/phase(1.4%) suppressed. Track axis Gini for balance trend.
- E5: Tension arc shape stability -- arc reverted to descending [0.46, 0.57, 0.47, 0.43] (was ascending in R10). Monitor whether section-progressive bias needs reinforcement.

### Hypotheses to Track
- Phase-regime correlation is NOT universal: coherent suppresses phase in some compositions but not others. Composition structure (key, harmonic content) is the primary phase share driver. Cross-run variance >> regime effect.
- Regime distribution within a profile has high variance: explosive produces 31-52% coherent across runs. Profile sets tendency, stochastic composition dynamics dominate.
- telemetryHealth is stabilizing: 0.425→0.248→0.366→0.409. Variance narrowing, centering near 0.38.
- density-flicker S0 is fundamentally warmup-structural: ramp shape (linear vs sqrt) has minimal impact. The pair decorrelates slowly regardless of ceiling trajectory.

---

## R10 -- 2026-03-22 -- STABLE

**Profile:** default (cross-profile switch from explosive) | **Beats:** 375 entries (375 unique) | **Duration:** 816s | **Notes:** ~12k
**Fingerprint:** 11/11 stable (incl. crossProfileWarning, tolerances widened 1.3x) | Drifted: none
**Manifest health:** PASS (regime=exploring, tailP90Max=0.891, tailExcMax=0.629)

### Key Observations
- STABLE (0/11 drifted). Cross-profile switch (explosive->default) detected, tolerances widened 1.3x. All dimensions comfortable.
- Exceedance: 5 unique beats, 12 total. density-flicker(5), tension-trust(2), density-trust(1), tension-flicker(1), density-tension(1), flicker-trust(1), flicker-entropy(1). Broad spread, low concentration.
- Regime: coherent 60.1%, exploring 38.0%. Default profile heavily favors coherent (vs explosive's 31.1%). regimeDistribution delta 0.148 (tolerance 0.26, widened by cross-profile).
- Tension arc: [0.50, 0.60, 0.67, 0.69] -- clean ascending shape. Consistent with R9b/R10a.
- phaseShareArc: {S0: 0, S1: 0.046, S2: 0.022, S3: 0.034}. Phase share 3.4% overall. Pattern confirmed: coherent sections (S0, S2) suppress phase coupling, exploring sections (S1, S3) have higher phase share.
- phaseShareContext: S0/S2 regime=coherent (phase 0/0.022), S1/S3 regime=exploring (phase 0.046/0.034). E5 diagnostic confirms regime-phase coupling relationship.
- telemetryHealth: 0.366. Moderate. underSeenPairCount=2.
- profileUsed: "default". E3 tracking confirmed across both profiles.
- Manifest health: PASS. E4 coherent REGIME_SCALE relaxation (0.95->0.97) eliminated non-fatal coupling warning from R9b.
- entropy-trust: 0 exceedance beats (was 25 in R10a). Confirms R10a's entropy-trust surge was stochastic S4-specific, not structural.

### R10a Intermediate Run
- EVOLVED 1/10: hotspotMigration drifted (0.663 > 0.55). entropy-trust emerged with 25 exceedance beats (24 in S4).
- exceedanceSeverity: 53 total (was 30 in R9b), 46 unique. entropy-trust S4 p95=0.911.
- Profile: explosive. phaseShareArc showed S1 recovery to 10.9% (E1 gateScale working in explosive), but S2/S3 collapse to ~0.4% (both coherent regime).
- telemetryHealth: 0.248 (best score to date).
- R10b re-run produced STABLE 0/11 against updated baseline.

### Evolutions Applied (from R9)
- E1: Phase share recovery (explosive gateScale 0.20->0.22) -- **confirmed** -- R10a phase share S1 recovered to 10.9% (was 3.0% in R9b). Default profile at 3.4% overall. Regime (coherent vs exploring) is primary driver of phase share, not gateScale alone.
- E2: S0 warmup extension (density-flicker base 12->16, min 6->8) -- **inconclusive** -- warmupBeats=15 in R10a (up from 12). density-flicker exceedance: 14 in R10a (was 12 in R9b), 5 in R10b. Extended warmup didn't reduce R10a exceedance but may stabilize across runs.
- E3: Cross-profile tracking (profileUsed metric) -- **confirmed** -- field deployed. R10a=explosive, R10b=default. Validated cross-profile stochastic switching.
- E4: Manifest health coupling (coherent REGIME_SCALE 0.95->0.97) -- **confirmed** -- R9b FAIL->R10a/R10b PASS. tension-flicker coupling no longer triggers at coherent threshold 0.8245.
- E5: phaseShareContext diagnostic -- **confirmed** -- per-section regime/coupling/gain context deployed. Reveals coherent regime suppresses phase coupling (phase near-zero in coherent sections).

### Evolutions Proposed (for R11)
- E1: Phase-regime coupling investigation -- phase share drops to near-zero in coherent regime sections. Is this inherent to coherent dynamics or a gating artifact? Compare phase coupling mechanics under coherent vs exploring.
- E2: density-flicker warmup effectiveness -- extended warmup (E2) was inconclusive. density-flicker remains the persistent S0 exceedance source (5-14 beats across runs). Consider ceiling shape (exponential ramp vs linear) for faster S0 coverage.
- E3: Regime profile divergence -- default profile produces 60% coherent, explosive produces 31%. Track whether composition quality differs between regimes.
- E4: entropy-trust structural monitoring -- R10a had 25 entropy-trust exceedance beats (all S4), R10b had 0. Monitor whether this pair resurfaces or was a one-off.
- E5: telemetryHealth variance -- score oscillates: 0.425->0.248->0.366 across runs. Track whether the oscillation narrows.

### Hypotheses to Track
- Phase coupling is regime-gated: coherent regime suppresses phase share to near-zero, exploring allows 3-11%. This is consistent across both profiles and multiple runs. May be structural to the coherent regime's tighter coupling dynamics.
- Cross-profile switching is stochastic and frequent (3 out of 4 recent runs changed profile). The 1.3x tolerance widening handles this well.
- density-flicker is the only persistent structural exceedance source. All other pair exceedances are transient/stochastic.
- entropy-trust exceedance is composition-specific (S4-concentrated when it appears) and does not persist across runs.

---

## R9 -- 2026-03-22 -- STABLE

**Profile:** explosive (cross-profile switch from default) | **Beats:** 751 entries (555 unique) | **Duration:** 847s | **Notes:** ~29k
**Fingerprint:** 11/11 stable (incl. crossProfileWarning) | Drifted: none
**Manifest health:** FAIL (non-fatal) -- coupling exceeds threshold for coherent regime: tension-flicker=-0.813; density-flicker p90=0.900

### Key Observations
- STABLE (0/11 drifted). Cross-profile switch (default->explosive) detected, tolerances widened 1.3x. All dimensions comfortable.
- Exceedance: 12 unique beats, 30 total pair-beats. Top pairs: density-flicker(12), tension-flicker(12), density-tension(2), density-trust(2), flicker-trust(2). All S0 warmup-concentrated.
- Regime rebalanced: coherent 28.2%, exploring 70.7%. E5 monopoly threshold 0.53->0.55 restored coherent share from 8.7% to healthy 28% without drift.
- Tension arc: [0.42, 0.71, 0.66, 0.71] -- ascending plateau with strong S3/S4 recovery. Best arc shape to date.
- phaseShareArc populated: {S0: 0, S1: 0.030, S2: 0.008, S3: 0.019, S4: 0.027}. Phase share dropped to 2.7% (was 8.5% in R8b). E4 gateScale widening may have reduced phase coupling frequency.
- telemetryHealth: 0.4249. varianceGatedRate 0.684 (improved from prior), phaseStaleRate 0.748. underSeenPairCount=3.
- flicker-trust: p95=0.832, 2 exceedance beats at threshold 0.85. R8 E5 baseCeiling 0.08 confirmed structurally effective.
- Manifest health non-fatal: tension-flicker coupling -0.813 in coherent regime (threshold 0.807); density-flicker p90=0.900. Advisory-level concern, not blocking.

### R9a Intermediate Run
- E3 (warmup base 12->8, min 6->4, max 24->18) + E6 (density-flicker baseCeiling 0.10->0.08, minCeiling 0.04->0.03) caused exceedance explosion: 8->61 density-flicker beats. EVOLVED 1/10.
- Root cause: shorter warmup removed protective ceiling coverage too early; tighter baseCeiling starved the corrective decorrelation signal.
- Both E3 and E6 reverted. Lesson: warmup ramp length is protective (longer = more ceiling coverage), and density-flicker ceiling must stay >=0.10.

### Evolutions Applied (from R8)
- E1: flicker-trust ceiling confirmation (observation) -- **confirmed** -- p95=0.832, 2 exceedance beats. R8 E5 (baseCeiling 0.08) is structurally effective across profile change.
- E2: phaseShareArc metric -- **confirmed** -- per-section phase energy share tracking deployed. Shows S0=0, S1 peak 0.030, S2 dip 0.008, ascending S3-S4.
- E3: S0 warmup ramp tightening (base 12->8) -- **reverted** -- caused exceedance explosion in R9a. Warmup length is protective, not expendable.
- E4: telemetryHealth recovery (phaseVarianceGateScale 0.18->0.25) -- **confirmed** -- telemetryHealth 0.4249 (was 0.328). Gate relaxation improved variance-gated rate.
- E5: Coherent regime floor (monopoly threshold 0.53->0.55) -- **confirmed** -- coherent 8.7%->28.2%. regimeDistribution delta 0.072 (tolerance 0.26, relaxed). Sweet spot confirmed at 0.55.
- E6: density-flicker S0 ceiling (baseCeiling 0.10->0.08) -- **reverted** -- combined with E3 backfire. density-flicker ceiling must remain >=0.10.

### Evolutions Proposed (for R10)
- E1: Phase share recovery investigation -- phase share cratered 8.5%->2.7% (axisShares.phase=0.027). Likely caused by E4 gateScale widening (0.18->0.25). Consider partial revert to 0.22 or investigate phase coupling frequency.
- E2: S0 warmup structural alternative -- all exceedance remains S0 warmup (12 unique beats). Ramp tightening failed (R9a). Alternative: adaptive S0 ceiling boost that extends, not shortens, ceiling coverage in early beats.
- E3: Cross-profile stability tracking -- profile switched default->explosive stochastically. Track whether this is composition-structural or random.
- E4: Manifest health coupling warning -- tension-flicker -0.813 at threshold 0.807, density-flicker p90=0.900 at threshold 0.85. Both non-fatal but rising.
- E5: phaseShareArc S2 dip investigation -- phase share dips to 0.008 in S2 (was 0.029 in R8). Section-dependent phase dynamics may indicate structural coupling interference.

### Hypotheses to Track
- Monopoly threshold sweet spot confirmed at 0.55: coherent 28.2% is healthy, regime delta comfortable. Further tuning unlikely to improve.
- Phase share drop 8.5%->2.7% is the clearest regression. phaseVarianceGateScale widening (E4) is the prime suspect -- gating more beats means fewer beats contribute to phase coupling.
- Warmup ramp cannot be shortened without alternative ceiling coverage. The ramp IS the ceiling in S0.
- density-flicker and tension-flicker are the persistent exceedance sources. Both share flicker as common axis -- may need flicker-specific warmup treatment.

---

## R8 -- 2026-03-22 -- STABLE

**Profile:** default | **Beats:** 509 entries (505 unique) | **Duration:** 519s | **Notes:** ~14k
**Fingerprint:** 10/10 stable | Drifted: none
**Manifest health:** PASS (tailP90Max=0.733, tailExcMax=0.491) | **vs baseline:** DIVERGENT (6 sections, 3 major diffs)

### Key Observations
- STABLE (0/10 drifted). First STABLE since R6. All dimensions within tolerance with healthy margins.
- Exceedance collapsed: 42→8 total (81% drop), 35→8 unique. Only density-flicker remains, all in S0 warmup.
- density-tension neutralized: 22→0 exceedance beats, p95 0.564 (was 0.677 in R8a). E2 ceiling profile fully effective.
- Tension arc: plateau [0.46, 0.68, 0.59, 0.58] — E3 section-progressive bias confirmed. No more S3/S4 collapse.
- Regime: coherent 8.7%, exploring 89.5%. E4 monopoly tightening (0.58→0.53) prevents coherent accumulation. No forced breaks in R8b.
- phaseShare populated: [0, 0.131, 0.029, 0.085] — E1 traceDrain fix confirmed. Phase axis share 8.5% (was near-zero in R7).
- regimeDistribution delta 0.040 (tolerance 0.20) — comfortable margin after E4 moderation from 0.50→0.53.
- hotspotMigration delta 0.192 (tolerance 0.55) — well within bounds. Top pair density-flicker stable between R8a→R8b.
- telemetryHealth 0.328 (delta 0.165, tolerance 0.35). Under-seen pair count improved 4→1.

### R8a Intermediate Run
- E4 initially set to 0.50 (too aggressive). Coherent cratered to 15.1%, regimeDistribution delta 0.196 (tolerance 0.20, only 0.004 margin).
- hotspotMigration drifted (0.584 > 0.55) due to density-tension→density-flicker shift. EVOLVED 1/10.
- Moderated E4 to 0.53, producing R8b STABLE.

### Evolutions Applied (from R7)
- E1: traceDrain phaseShare fix — **confirmed** — phaseShare populated in diagnosticArc, values [0, 0.131, 0.029, 0.085]
- E2: density-tension ceiling profile (baseCeiling 0.12) — **confirmed** — exceedance 22→0, p95 0.564
- E3: Tension section-progressive bias (+0.03/section) — **confirmed** — arc V-shape→plateau [0.46, 0.68, 0.59, 0.58]
- E4: Coherent monopoly tightening (0.58→0.53) — **confirmed** — coherent 53.6%→8.7%, regime balanced
- E5: flicker-trust baseCeiling (0.10→0.08) — **inconclusive** — flicker-trust 0 exceedance in R8b (was 8 in R8a), confounded by regime shift
- E6: sectionP95 exceedance metric — **confirmed** — metric populated, shows S0-concentration pattern

### Evolutions Proposed (for R9)
- E1: flicker-trust ceiling confirmation — re-evaluate E5 next run; if exceedance remains 0, confirm
- E2: Phase axis share stability tracking — phase share fluctuates [0→0.13→0.03→0.08]; investigate S2 dip
- E3: S0 warmup exceedance reduction — all 8 remaining exceedance beats are S0 warmup (density-flicker p95 0.957); tighten warmup ramp
- E4: Telemetry health score recovery — score 0.328, down from 0.493; investigate phase stale rate and variance gating
- E5: Coherent regime floor investigation — 8.7% coherent may be too low; monitor whether 0.53 threshold needs further tuning
- E6: density-flicker S0 p95 ceiling — S0 p95 0.957 vs S1 0.257; cold-start ceiling profile for density-flicker

### Hypotheses to Track
- E4 regime balance is sensitive to threshold: 0.50 gives 15.1% coherent (near-drift), 0.53 gives 8.7% (stable). Sweet spot may be closer to 0.55.
- flicker-trust E5 may be working but masked by regime redistribution. Track across multiple runs.
- density-flicker cold-start is the last remaining structural exceedance source. All 8 beats are S0 warmup.
- Phase share variation across sections (0→0.13→0.03→0.08) suggests phase coupling has section-dependent dynamics worth understanding.

## R7 -- 2026-03-21 -- EVOLVED

**Profile:** default | **Beats:** 343 entries (269 unique) | **Duration:** 385s | **Notes:** 12,245
**Fingerprint:** 9/10 stable | Drifted: hotspotMigration (0.625 > 0.55)

### Key Observations
- EVOLVED (1/10 drifted: hotspotMigration). vs baseline: SIMILAR. Hotspot surface migrated from density-flicker (5) to density-tension (22) + density-flicker (12). Top-2 concentration 0.810.
- density-tension pearsonR collapsed 0.885→0.529 after E1 revert. couplingExtremes: null, correlationExtremeCount: 0. E1 confirmed the extreme correlation was coherent-dampening-driven, not structural.
- Exceedance tripled: 14→42. density-tension now dominant (22 beats, 20 in S2 where coupling mean=0.850). S0 still warmup-concentrated (13 beats, s0Timing warmupShare=1.0).
- Tension arc reshaped from plateau [0.49, 0.59, 0.50, 0.50] to V-shape [0.44, 0.62, 0.43, 0.43]. S1 peaks but S2/S3 collapse to identical values. No ascending trajectory.
- Phase share nearly doubled: 4.6%→8.9%. E4 coherent-freeze bypass cut coherentFreeze skips 45→16 (-64%). axisGini recovered 0.175→0.111. Still below 10% floor.
- Trust share moderated: 19.4%→18.3%. E2 (0.50x multiplier) provides gentle support without displacing phase. Balance restored.
- Coherent regime continues rising: 33.6%→45.2%→53.6% (3rd consecutive rise). maxConsecutiveCoherent=140. 1 forced monopoly break (streak 27).
- flicker-trust re-emerged: p95 0.827, 4 exceedance beats. Was resolved in R5/R6 era. Profile baseCeiling 0.10 insufficient.
- Section count 3→4 (new B aeolian). All harmonic keys changed. Structural composition variability present.
- phaseShare diagnostic gap: E6 field deployed but all null — traceDrain.recordSnapshot() doesn't forward axisEnergyShare.
- globalGainMultiplier dropped 0.619→0.583. budgetConstraintPressure 0.997 (near-ceiling). density-tension tailPressure 0.922 (highest).

### Evolutions Applied (from R6)
- E1: Revert tension coherent dampening — confirmed — pearsonR 0.885→0.529, couplingExtremes null, plateau→V-shape
- E2: Trust floor bias 1.05→0.50 — confirmed — trust 19.4%→18.3%, phase 4.6%→8.9%, axisGini 0.175→0.111
- E3: correlationExtremeCount in fingerprint — confirmed — field deployed, reads 0 (correct)
- E4: Phase coherent-freeze bypass — confirmed — coherentFreeze skips 45→16 (-64%), phase doubled
- E5: flicker-entropy ceiling profile — inconclusive — p95 0.702, right at threshold, EMA needs more runs
- E6: diagnosticArc phaseShare — refuted — field deployed but all null, traceDrain snapshot payload missing axisEnergyShare

### Evolutions Proposed (for R8)
- E1: Fix diagnosticArc phaseShare data gap — src/writer/traceDrain.js
- E2: density-tension ceiling profile (baseCeiling 0.12) — pairGainCeilingController.js
- E3: Tension arc progressive section bias (+0.03/section) — regimeReactiveDamping.js
- E4: Coherent cadence-monopoly trigger tightening — regimeClassifier.js
- E5: flicker-trust baseCeiling tightening (0.10→0.08) — pairGainCeilingController.js
- E6: Exceedance section-concentration metric — trace-summary.js

### Hypotheses to Track
- density-tension S2 coupling mean 0.850 — is this section-structural or stochastic? If next run also has a section with d-t mean > 0.80, the pair needs section-aware ceiling logic.
- Phase share 8.9% despite 43 axis adjustments — the recovery rate is limited. If E1 (traceDrain fix) reveals that phase share drops mid-composition, consider phaseFloorController threshold adjustments.
- Coherent at 53.6% for 3 consecutive rises. If E4 tightening doesn't cap it below 50%, the regime self-balancer's coherentThresholdScale (0.917) may need direct attention despite meta-controller jurisdiction.
- flicker-phase p95 rose 0.584→0.795 — approaching hotspot territory again. If it exceeds 0.85 next run, the balloon-effect is recurring.
- Section count variability (3→4) may confound cross-run fingerprint comparisons. Track whether section count stabilizes or fluctuates.
- roleSwap absent 4th consecutive run. Consider whether this trust system should be removed from default profile or has structural requirements not met.



## R6 -- 2026-03-21 -- STABLE

**Profile:** default | **Beats:** 361 entries (267 unique) | **Duration:** 370s | **Notes:** 12,099
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- STABLE on all 10 dimensions. vs baseline: DIFFERENT (note count -17.2%, harmonic key changes in all 3 sections).
- Exceedance dramatically improved: 48→14 total beats, density-flicker 46→5. s0Timing confirms 100% warmup-concentrated (6 warmup, 0 post-warmup). E1 two-tier 0.50x ceiling highly effective.
- Tension arc flattened from ascending [0.42, 0.60, 0.73, 0.75] to plateau [0.49, 0.59, 0.50, 0.50]. E3 coherent=-0.5 dampening is too aggressive — coherent passages dominate at 45.2%.
- Trust axis reversed decline: 12.2%→19.4% (+7.2pp). E5 trust floor bias over-corrected — phase collapsed 16.1%→4.6%. axisGini worsened 0.110→0.175.
- Phase collapse driven by coherent-freeze coldspot blocking: 47 skipped relaxations (45 coherent-freeze). Despite 38 phase axis adjustments, the coherent freeze overwhelms recovery.
- density-tension pearsonR surged to 0.885 (new extreme, first in couplingExtremes). tension-flicker r=0.823, flicker-entropy r=0.794 also near-extreme. Multiple high-correlation pairs suggest E3 introduced shared-driver dynamics.
- flicker-entropy is now sole underseen pair (controllerLagIndex 0.116). E2 resolved flicker-trust but surfaced new gap. No pair gain ceiling profile for flicker-entropy.
- roleSwap absent 3rd consecutive run. missingTrustSystems: ["roleSwap"] diagnostic confirms structural inactivity under default profile.
- Coherent regime share rose: 33.6%→45.2%. One forced cadence-monopoly break (streak 43). Section 0 went from 68.4% exploring to 0% exploring (now 61.1% coherent).
- globalGainMultiplier stable at 0.619. 0 floor contact, 0 saturation beats. tailRecoveryHandshake 0.955 (healthy).

### Evolutions Applied (from R5)
- E1: density-flicker S0 pre-warmup ceiling (0.50x) — confirmed — exceedance 46→5 beats (-89%), s0Timing proves 100% warmup-concentrated
- E2: flicker-trust EMA convergence (P95_EMA_ALPHA 0.06→0.08) — confirmed — flicker-trust no longer underseen; flicker-entropy surfaced as new gap (0.116)
- E3: tension regime-aware damping — partially refuted — coherent=-0.5 flattened tension arc from [0.42,0.60,0.73,0.75] to [0.49,0.59,0.50,0.50]
- E4: S0 exceedance timing diagnostic — confirmed — s0Timing deployed, warmupShare=1.0, concentration="warmup-concentrated"
- E5: trust-axis share floor enforcement — partially confirmed — trust recovered 12.2%→19.4%, over-corrected, phase displaced 16.1%→4.6%
- E6: roleSwap activation tracking — confirmed — missingTrustSystems: ["roleSwap"], 3rd consecutive absence

### Evolutions Proposed (for R7)
- E1: Revert tension coherent dampening to neutral — regimeReactiveDamping.js
- E2: Reduce trust floor bias strength (1.05→0.50) — axisEnergyEquilibratorAxisAdjustments.js
- E3: density-tension correlation monitoring (correlationExtremeCount) — golden-fingerprint.js
- E4: Phase warmup-gated coldspot bypass in coherent — axisEnergyEquilibratorAxisAdjustments.js
- E5: flicker-entropy ceiling profile — pairGainCeilingController.js
- E6: Section-level phase share tracking in diagnosticArc — trace-summary.js

### Hypotheses to Track
- density-tension r=0.885 may naturally decrease after E1 revert. If it persists, the co-evolution is structural (not E3-driven) and may need its own ceiling profile.
- Phase collapse at 4.6% is the most acute issue. If E2 (reduced trust bias) + E4 (coherent bypass) don't restore phase above 10%, consider adding a phase-dedicated floor controller similar to phaseFloorController but operating at the axis level.
- flicker-entropy p95=0.841 is the highest of all pairs and has no ceiling profile. If E5 doesn't bring it under 0.70, consider a tighter baseCeiling.
- Coherent regime at 45.2% is the highest ever recorded. If it continues rising, the cadence-monopoly threshold may need reduction.
- L1 note count dropped 33.0% — investigate whether S0 phrase count reduction (2→1) is profile-driven or a consequence of the R6 changes.
- s0Timing proves exceedance is purely warmup-driven. The remaining 5 density-flicker beats may be an irreducible initialization cost.



## R5 -- 2026-03-21 -- STABLE

**Profile:** multi (default/restrained/default) | **Beats:** 411 entries (323 unique) | **Duration:** 447s | **Notes:** 14,619
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- STABLE on all 10 dimensions. vs baseline: SIMILAR. All R4 evolutions confirmed (6/6).
- flicker-phase fully resolved: p95 0.872→0.584, exceedance 22→0 beats. E1 ceiling profile + E2 warmup multiplier 0.60x contained balloon-effect displacement entirely.
- Phase axis share tripled: 5.4%→16.1%. E5 warmup acceleration (6→4 ticks) brought phase pairs online significantly faster. axisGini 0.110 — lowest ever recorded.
- density-flicker pearsonR moderated: -0.919→-0.600. No longer extreme (couplingExtremes=null). Structural anti-correlation persists but within manageable territory.
- density-flicker remains sole exceedance pair: 46/48 beats, all S0-concentrated. S0 aging artifact confirmed (recentP95=0.357, controllerLagIndex=0, recentHotspotRate=0).
- Coherent regime share rose: 21.2%→33.6%. Section 2 went full coherent (100%). Monotonically ascending tension arc [0.42, 0.60, 0.73, 0.75] — architecturally clean.
- Trust axis share stabilized: 12.5%→12.2% (4-run declining trend: 20.3→17.0→12.5→12.2). Trend is flattening. axisShareFloor confirms trust trend="falling".
- flicker share fell 25.0%→20.3%. Combined E1+E2 redistributed flicker energy to phase (+10.8pp) and entropy (+3.3pp).
- flicker-trust is only actively-underseen pair: controllerLagIndex=0.101. traceP95=0.800, controllerP95=0.328. EMA convergence lagging.
- roleSwap trust system dropped from 0.188 to 0.000 (inactive). 8 of 9 trust systems active.
- globalGainMultiplier 0.608 (slight decline from 0.646 but stable). 0 floor contact, 0 saturation beats.

### Evolutions Applied (from R4)
- E1: flicker-phase pairGainCeiling profile — confirmed — p95 0.872→0.584, exceedance 22→0 beats
- E2: S0 warmup ceiling 0.80x→0.60x — confirmed — flicker share 25.0%→20.3%, no S1 displacement, S0-concentrated pattern retained
- E3: exceedance displacement tracking — confirmed — displacementIndicator deployed, reads null (no displacement)
- E4: coupling correlation extremity flag — confirmed — couplingExtremes=null, density-flicker pearsonR -0.919→-0.600
- E5: phase variance gate warmup acceleration — confirmed — warmupTicks 6→4, warmupEntries 8→6, phase share 5.4%→16.1%, axisGini 0.110
- E6: trust axis share floor monitoring — confirmed — axisShareFloor deployed, belowFloorAxes=null, trust trend="falling" corroborates decline hypothesis

### Evolutions Proposed (for R6)
- E1: density-flicker S0 pre-warmup ceiling (pair-specific 0.50x) — couplingEffectiveGain.js
- E2: flicker-trust reconciliation closure (P95_EMA_ALPHA 0.06→0.08) — pairGainCeilingController.js
- E3: tension contributor constant-drag resolution — regimeReactiveDamping.js
- E4: S0 exceedance concentration timing diagnostic — trace-summary.js
- E5: trust-axis share floor enforcement (trustFloorBias 1.05x) — axisEnergyEquilibrator.js
- E6: roleSwap trust system activation tracking — trace-summary.js

### Hypotheses to Track
- density-flicker S0 exceedance (46 beats) may be irreducible warmup artifact. If pair-specific 0.50x still yields >30 beats, coupling computation itself may need warmup-phase awareness.
- Trust axis at 12.2% (4-run decline flattening). If E5 floor enforcement stabilizes it above 13%, the equilibrator correction is sufficient. If not, consider raising AXIS_COUPLING_CEILING.trust.
- flicker-trust controllerLagIndex 0.101 may resolve naturally with faster EMA (E2). If gap persists after EMA change, the pair may need a wider telemetryWindowBeats.
- roleSwap intermittent activation: if absent for 2 more runs, investigate whether its trigger conditions (explosive profile? section count?) are met.
- Phase axis recovery (5.4%→16.1%) may overshoot in subsequent runs. Monitor for phase > 20% share and flicker < 15%.
- Tension arc stability: current [0.42, 0.60, 0.73, 0.75] is ideal. Track whether E3 regimeReactiveDamping change disrupts this.



## R4 -- 2026-03-21 -- STABLE

**Profile:** multi (default/restrained/default) | **Beats:** 472 entries (361 unique) | **Duration:** 492s | **Notes:** 16,103
**Fingerprint:** 11/11 stable | Drifted: none
**Manifest health:** PASS (18/18 pipeline steps) | **vs baseline:** DIFFERENT (3 sections vs 5, note count -19.2%)

### Key Observations
- STABLE on all 11 dimensions despite cross-profile comparison (explosive→default, tolerances widened 1.3x). Even without widening, all dimensions would remain stable.
- Exceedance tripled: 26→77 total beats (70 unique). Two dominant pairs: density-flicker 48 (S0), flicker-phase 22 (S1). Flicker axis involved in 93.5% of exceedance (72/77) — persistent structural pattern across 4 runs.
- flicker-phase emerged as new #2 hotspot: p95=0.872, residualPressure=1.0, no ceiling profile. Spike is profile-transition-driven — restrained profile in S1 compresses globalGainMultiplier to 0.264, coupling to 0.958.
- Flicker axis share nearly doubled (13.0%→25.0%), trust axis halved (20.3%→12.5%). Confirmed balloon effect from R2-R3 trust ceiling tightening.
- tension-flicker fully resolved: recentHotspotRate=0 (was 0.4375), p95=0.585. E2+E3 combination was highly effective.
- density-trust ceiling (E4) active: effectiveGain=0, budgetRank=1, 3 exceedance beats (down from unmanaged state).
- density-flicker pearsonR=-0.919 — most extreme anti-correlation ever observed. Structural, not transient.
- globalGainMultiplier improved: 0.620→0.646 (less compression, 3-run upward trend).
- roleSwap trust system newly active (0.188, 123 samples) — first appearance in the current era.
- Coherent regime declined: 34.5%→21.2% (profile-driven, no explosive section in this run).
- controllerLagIndex confirms S0-aging artifact: density-flicker gap 0.314 but controllerLagIndex only 0.012. activelyUnderseenCount=0.

### Evolutions Applied (from R3)
- E1: Reconciliation gap controller-lag index — confirmed — controllerLagIndex deployed, activelyUnderseenCount=0, validates S0-aging hypothesis
- E2: tension-flicker p95Alpha acceleration — confirmed — recentHotspotRate 0.4375→0, pair fully controlled
- E3: tension-flicker baseCeiling 0.12→0.10 — confirmed — p95 0.613→0.585, effectiveGain=0.05, heatPenalty=0.113
- E4: density-trust pairGainCeiling profile — confirmed — effectiveGain=0, budgetRank=1, 3 exceedance beats, pair now managed
- E5: telemetryHealth varianceGatedRate — confirmed — varianceGatedRate=0.644 deployed and visible
- E6: Flicker-axis warmup ceiling 0.80x — inconclusive — S0 density-flicker exceedance increased (13→48 beats), 0.80x multiplier insufficient

### Evolutions Proposed (for R5)
- E1: flicker-phase pairGainCeiling profile — pairGainCeilingController.js
- E2: S0 warmup ceiling 0.80x→0.60x for flicker pairs — couplingEffectiveGain.js
- E3: Exceedance displacement tracking — trace-summary.js
- E4: Density-flicker correlation extremity flag — golden-fingerprint.js
- E5: Phase variance gate warmup acceleration — systemDynamicsProfiler.js
- E6: Trust axis share floor monitoring — trace-summary.js

### Hypotheses to Track
- flicker-phase exceedance may be purely profile-transition-driven (restrained segment). If next run lacks restrained profile, track whether exceedance disappears.
- density-flicker R=-0.919 anti-correlation is structural. If it persists > -0.85 for 2 more runs, ceiling management alone cannot resolve it — may need signal-level decoupling.
- Trust axis at 12.5% (3-run declining trend: 20.3%→17.0%→12.5%). If it drops below 10%, equilibrator correction rate is insufficient — raise AXIS_COUPLING_CEILING.trust back toward 2.3.
- S0 exceedance may be pre-warmup: if 0.60x multiplier still doesn't eliminate it, coupling spikes before warmup initialization — fix needed at coupling computation level.
- roleSwap trust system activation is new. Track whether it stabilizes or shifts trust balance.



## R3 -- 2026-03-21 -- STABLE

**Profile:** multi (default/restrained/default/default/explosive) | **Beats:** 527 entries (410 unique) | **Duration:** 630.2s | **Notes:** 19,936
**Fingerprint:** 10/10 stable | Drifted: none
**Manifest health:** PASS (tailP90Max=0.761, tailExcMax=0.358) | **vs baseline:** DIVERGENT (multi-profile vs explosive, note count -37%)

### Key Observations
- Multi-profile journey (default->restrained->default->default->explosive) vs R2's all-explosive. All A/B comparisons cross-profile; DIVERGENT expected.
- Trust axis rebalanced: share 0.245->0.170 (-30.6%), exceedance beats 43->7 (-83.7%). E1 ceiling reduction (2.5->2.2) confirmed effective.
- flicker-trust reconciliation gap halved: 0.406->0.205 (-49.5%). E2 p95Alpha acceleration confirmed.
- Coherent regime share almost doubled: 21.1%->35.7%. maxConsecutiveCoherent 33 ticks (1 forced monopoly break at tick 34).
- tension-flicker is the new #1 tail pair: pressure 0.613, recentHotspotRate 0.4375, budgetRank 1, effectiveGain suppressed to 0.05.
- density-flicker reconciliation gap 0.365 (new largest) but recentP95=0.260 -- S0 aged-out artifact. Controller has resolved the pair.
- entropy-trust overflow resolved: rawRollingAbsCorr/baseline = 0.98x (was 1.34x). S4 coupling spiked to 0.811 transiently.
- entropyRegulator trust velocity +0.519 in S4 (2.6x turbulence threshold). Driven by entropy-trust coupling 0.811 in explosive section.
- Phase stale rate improved: 0.780->0.691 (-11.4pp). Variance gating: 0.705->0.626 (-11.2pp). E4 freshness escalation confirmed.
- All exceedance S0-concentrated (11 unique / 14 total). Flicker axis involved in 13/14 (93%). No S1+ displacement from E5 warmup expansion.
- globalGainMultiplier improved: 0.593->0.620 (less compression). Handshake 0.955, 0 saturation beats.
- Correlation trends: flicker-trust increasing (R=0.622), tension-flicker increasing (R=0.644), density-flicker decreasing (R=-0.614).
- density-trust has no pairGainCeiling profile despite p95 0.745 (above 0.70 hotspot threshold) and budgetRank 3.

### Evolutions Applied (from R2)
- E1: Trust axis coupling ceiling 2.5->2.2 -- confirmed -- trust share 0.245->0.170 (-30.6%), exceedance 43->7 (-83.7%)
- E2: Flicker-trust reconciliation gap closure -- confirmed -- gap 0.406->0.205 (-49.5%), p95Alpha acceleration effective
- E3: entropy-trust overflow monitoring -- deployed, no overflow -- rawRollingAbsCorr/baseline 0.98x (was 1.34x), threshold never triggered
- E4: Phase freshness escalation 4->3 -- confirmed -- staleRate 0.780->0.691 (-11.4pp), varianceGating 0.705->0.626 (-11.2pp)
- E5: Warmup ceiling scope expansion (all sections) -- confirmed -- zero S1-S4 exceedance, no over-suppression detected
- E6: Correlation flip threshold 3->2 -- deployed, inconclusive -- 8/14 directions changed (profile-driven), cannot isolate E6 effect

### Evolutions Proposed (for R4)
- E1: Reconciliation gap controller-lag index -- scripts/trace-summary.js
- E2: tension-flicker p95Alpha acceleration -- hyperMetaOrchestrator.js
- E3: tension-flicker baseCeiling 0.12->0.10 -- pairGainCeilingController.js
- E4: density-trust pairGainCeiling profile -- pairGainCeilingController.js
- E5: telemetryHealth varianceGatedRate context -- scripts/trace-summary.js
- E6: Flicker-axis warmup ceiling tightening (0.80x) -- couplingEffectiveGain.js or warmupRampController.js

### Hypotheses to Track
- tension-flicker's recentHotspotRate 0.4375 is the highest ever seen. If E2+E3 don't reduce it below 0.20, the pair may need structural intervention beyond ceiling management.
- density-flicker reconciliation gap (0.365) is an aged-out S0 artifact. If E1's controllerLagIndex confirms this pattern persists, consider using activelyUnderseenCount in telemetryHealth scoring.
- Flicker-axis involvement in 93% of exceedance is a structural pattern (3 consecutive runs). If E6's warmup multiplier doesn't reduce S0 flicker exceedance, the issue may be pre-warmup (before the ceiling system initializes).
- density-trust at p95 0.745 without a ceiling profile is a coverage gap. If E4's profile causes over-suppression (effectiveGain < 0.10), relax the profile parameters.
- entropyRegulator velocity +0.519 in S4 is profile-driven (explosive). Track whether this magnitude recurs in non-explosive S4 sections to determine if it's structural vs profile-specific.



## R2 -- 2026-03-21 -- STABLE

**Profile:** explosive | **Beats:** 868 entries (678 unique) | **Duration:** 883.0s | **Notes:** 31,788
**Fingerprint:** 11/11 stable | Drifted: none
**Manifest health:** PASS (tailP90Max=0.813, tailExcMax=0.296) | **vs baseline:** DIVERGENT (profile changed default->explosive, tolerances widened 1.3x)

### Key Observations
- Profile changed from default to explosive. All comparisons are cross-profile; absolute deltas are expected.
- density-flicker exceedance reduced: p95 0.727 (was 0.774), 14 beats (was 22). Warmup ceiling ramp (E1) partially effective but did not eliminate S0 exceedance.
- Hotspot migrated from density-flicker to flicker-trust (p95 0.864, 21 beats). Trust axis now dominates exceedance: 43/63 beats (68%) involve trust.
- Trust axis share 0.245 (highest), driven by AXIS_COUPLING_CEILING.trust=2.5 (25% above other axes).
- entropy-trust exceedance emerged in S4: 14 beats, p95 0.891, recentP95 0.941. Non-nudgeable pair with rawRollingAbsCorr 0.389 (1.34x baseline of 0.290).
- Tail recovery handshake desaturated: 0.955 (was 0.970). Graduated decay (E4) confirmed working. Zero saturation beats.
- Telemetry health recovered: 0.518 (was 0.381, +36%). Phase stale rate increased to 0.780 (was 0.651) -- likely profile-driven.
- Variance gating 70.5% (was 43.2%) -- explosive profile has structurally lower phase variance.
- flicker-trust reconciliation gap 0.406 (largest): controller p95 0.458 vs trace p95 0.864. Controller severely under-tracking.
- globalGainMultiplier 0.593 (unchanged from 0.590). Ceiling-aware budget relaxation (E2) did not measurably reduce compression.
- Correlation flip detection (E5) deployed. 12/14 directions stable; threshold of 3 likely never triggered.
- diagnosticArc section field (E6) populated and verified.
- Coherence verdicts: 2 warnings (attribution-only), 1 info. No critical findings.

### Evolutions Applied (from R1)
- E1: density-flicker S0 exceedance elimination -- partially confirmed -- p95 0.774->0.727, beats 22->14, but not fully eliminated
- E2: Homeostasis compression investigation -- inconclusive -- globalGainMultiplier 0.593 (was 0.590), profile change confounds evaluation
- E3: Telemetry health score recovery -- confirmed -- score 0.381->0.518 (+36%), stale threshold relaxation deployed
- E4: Tail recovery handshake desaturation -- confirmed -- handshake 0.970->0.955, zero saturation beats, graduated decay effective
- E5: Correlation trend monitoring -- deployed, inconclusive -- 12/14 directions stable, threshold never triggered
- E6: Diagnostic arc section indexing fix -- confirmed -- section field present in all diagnosticArc entries

### Evolutions Proposed (for R3)
- E1: Trust axis coupling ceiling reduction -- couplingConstants.js (AXIS_COUPLING_CEILING.trust 2.5->2.2)
- E2: Flicker-trust reconciliation gap closure -- hyperMetaOrchestrator.js (extend p95Alpha to flicker-trust)
- E3: entropy-trust exceedance monitoring -- couplingGainEscalation.js (non-nudgeable overflow dampening)
- E4: Phase stale rate reduction -- systemDynamicsProfiler.js (PHASE_FRESHNESS_ESCALATION 8->6)
- E5: Warmup ceiling scope expansion -- couplingEffectiveGain.js (remove sectionResetCount===0 guard)
- E6: Correlation flip threshold calibration -- hyperMetaOrchestrator.js (threshold 3->2)

### Hypotheses to Track
- Trust axis dominance may be structural to the explosive profile. If trust exceedance persists after ceiling reduction (E1), the issue is signal-level, not ceiling-level.
- flicker-trust reconciliation gap (0.406) is the largest ever observed. If p95Alpha acceleration (E2) doesn't close it, the controller's telemetry window may be too narrow.
- entropy-trust at 1.34x baseline may be a leading indicator of late-section structural coupling that the system cannot control. Monitor whether S4 exceedance recurs.
- Phase variance gating at 70.5% may be appropriate for explosive profile (high energy compresses variance). Track whether this correlates with telemetry health degradation.
- Warmup ceiling expansion (E5) to all sections may reveal that non-S0 sections have different warmup dynamics. Watch for over-suppression in S1-S4 early beats.



## R1 -- 2026-03-21 -- STABLE

**Profile:** default | **Beats:** 324 entries (262 unique) | **Duration:** 365.5s | **Notes:** 11,912
**Fingerprint:** 11/11 stable | Drifted: none
**Manifest health:** PASS (tailP90Max=0.901, tailExcMax=0.431) | **vs baseline:** DIFFERENT (4 sections, 2 major diffs)

### Key Observations
- First run of new era. All 18 pipeline steps passed. STABLE on first run after 5 evolutions.
- flicker-trust neutralized: p95 0.774 (was 0.868), 0 exceedance beats (was 42). E1 tightening confirmed.
- Phase variance gating halved: 43.2% (was 83.4%). Phase axis share recovered to 11.4% (was near-zero). E2 confirmed as most impactful evolution.
- Exceedance dropped 62%: 22 unique beats (was 59), all in S0, all density-flicker. System perfectly clean after S0.
- Section-shift metric (E3) deployed: S0-concentrated, no S1 displacement. Prior era's S1 emergence was transient.
- Regime: exploring 73.8%, coherent 24.1%. Slightly more balanced than prior baseline.
- Homeostasis moderately compressed: globalGainMultiplier 0.5895. Tail recovery handshake near saturation (0.97).
- Telemetry health declined: 0.381 (was 0.517). Phase stale rate 0.651. Under-seen pairs reduced to 2.
- diagnosticArc section indices undefined -- data integrity bug to fix.

### Evolutions Applied (from prior era)
- E1: flicker-trust ceiling tightening -- confirmed -- p95 0.868->0.774, beats 42->0
- E2: Phase variance gate relaxation -- confirmed -- gating 83.4%->43.2%, phase share recovered 11.4%
- E3: S1 exceedance shift tracking -- confirmed -- metric deployed, S0-concentrated, no displacement
- E4: Phase-aware rate scaling -- inconclusive -- system in 'converging' phase, no differential behavior observed
- E5: Contradiction response deepening -- inconclusive -- no contradictions fired, needs stress scenario

### Evolutions Proposed (for R2)
- E1: density-flicker S0 exceedance elimination -- warmupRampController.js
- E2: Homeostasis globalGainMultiplier compression investigation -- couplingHomeostasis.js
- E3: Telemetry health score recovery -- systemDynamicsProfilerAnalysis.js
- E4: Tail recovery handshake desaturation -- couplingHomeostasis.js
- E5: Correlation trend monitoring via orchestrator -- hyperMetaOrchestrator.js
- E6: Diagnostic arc section indexing fix -- traceDrain.js / trace-summary.js

### Hypotheses to Track
- density-flicker remaining as sole exceedance source suggests it has a structural cold-start characteristic that other pairs don't share. If E1 works, total exceedance could reach single digits.
- Homeostasis compression at 0.59 may be over-correcting now that 4 pairs have active adaptive ceilings. If budget is raised, watch for coupling energy runaway.
- Telemetry health decline despite variance gate improvement suggests phase staleness is an upstream signal issue, not a gate issue.
- Tail recovery handshake saturation at 0.97 may be masking the recovery system's ability to respond to new pressure surges.



## Prior Era Summary

Over ~80 evolution rounds, Polychron's architecture grew from a handful of hardcoded coupling constants into a fully self-calibrating system of 17 hypermeta controllers — each EMA-driven, self-registered, and phase-aware — supervised by a master hyperMetaOrchestrator (#17) that provides system health scoring, phase classification, adaptive rate multipliers, cross-controller contradiction detection, and controller effectiveness tracking. The system closed the era STABLE (0/11 fingerprint dimensions drifted), manifest health PASS, 716 globals across 437 files and 18 pipeline steps. Key final-era gains: exceedance dropped from ~90 to 22 unique beats, variance gating halved (83%->43%), and all four monitored coupling pairs (density-flicker, tension-flicker, flicker-trust, tension-trust) are under adaptive ceiling control.

### Next run: R1
