## R6 -- 2026-03-25 -- STABLE

**Profile:** default | **Beats:** 954 | **Duration:** 126.4s | **Notes:** 38653
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- Flicker range expanded 25.6%: 0.246 (0.922-1.168) -> 0.309 (0.899-1.208). E2 (elasticity target 0.22->0.28) and E5 (EMA tracking 0.30->0.40) confirmed working together.
- Evolving surged 18.4% -> 30.4% (above 20% budget). Exploring collapsed 43.0% -> 15.4% (below 35% budget). Coherent rose 38.3% -> 53.8%. Regime distribution shifted dramatically -- likely from flicker widening changing the coupling surface that regime classification depends on.
- Previously increasing correlations contained: DT 0.417->-0.494 (reversed), TP 0.486->-0.163 (stable), FT 0.399->0.164 (stable). New flicker-driven correlations emerged: DF -0.134->0.405 (increasing), FP -0.228->0.421 (increasing).
- Axis Gini regressed: 0.0906 -> 0.112. Density (0.148->0.207) and flicker (0.191->0.211) surged; trust dropped (0.162->0.125). Balloon effect from flicker widening inflating DF coupling energy.
- Exceedance doubled (46->103 beats) but is more dispersed: top2 concentration 0.804->0.573. Top pair migrated from DF(27) to entropy-trust(41). DT emerged at 18 beats.
- Harmonic journey: A# lydian -> D major -> E major -> D dorian -> G mixolydian -> F dorian -> G lydian. 5 tonics, 4 modes.
- Tension max dropped 0.99->0.90 from E4's post-climax sustain raising the coda floor. Arc shape [0.651, 0.726, 0.538, 0.505] -- section 4 maintained vs baseline 0.503.
- Jurisdiction enforcement script created and passing (10 legacy overrides allowlisted, 0 new). Hypermeta-first rule added to copilot-instructions.md.

| Dimension | Delta | Tolerance | Status |
|-----------|-------|-----------|--------|
| pitchEntropy | 0.094 | 0.25 | stable |
| densityVariance | 0.002 | 0.20 | stable |
| tensionArc | 0.047 | 0.40 | stable |
| trustConvergence | 0.005 | 0.25 | stable |
| regimeDistribution | 0.138 | 0.30 | stable |
| coupling | 0.046 | 0.25 | stable |
| correlationTrend | 0.50 | 1.00 | stable |
| exceedanceSeverity | 11 | 95 | stable |
| hotspotMigration | 0.739 | 0.75 | stable |
| telemetryHealth | 0.007 | 0.35 | stable |

### Evolutions Applied (from R5)
- E1: Jurisdiction enforcement script -- confirmed -- PASS, 10 legacy overrides detected, 0 new. Pipeline integration working.
- E2: Flicker elasticity target widening (0.22->0.28) -- confirmed -- flicker range 0.246->0.309 (+25.6%), flicker axis share 0.191->0.211.
- E3: Interval expansion density bias strength (4%->8%) -- inconclusive -- density variance increased 0.0058->0.0075 but cannot isolate from regime shift effects.
- E4: Dynamic architect late-piece energy sustain -- confirmed -- section 4 tension 0.503->0.505 maintained. But max tension dropped 0.99->0.90 (climax region compressed).
- E5: Flicker EMA tracking speed (0.30->0.40) -- confirmed -- combined with E2 for 25.6% flicker range expansion. EMA allowing faster tracking of flicker variation.

### Evolutions Proposed (for R7)
- E1: Trust recovery via trustStarvationAutoNourishment (#5) sensitivity -- trust dropped 0.162->0.125, module may need lower activation threshold to fire in new regime balance.
- E2: DF correlation brake -- DF pearsonR 0.405 (increasing). Needs containment through coupling infrastructure, not manual constants.
- E3: FP correlation containment -- FP pearsonR 0.421 (increasing). Same approach as E2.
- E4: Exploring recovery via equilibrator (#2) -- exploring at 15.4% vs 35% budget. The equilibrator's correction may be insufficient; investigate expDeficit correction strength.
- E5: Tension climax restoration -- max tension dropped 0.99->0.90. E4's post-climax sustain raised the floor but may have compressed the peak. Consider adjusting the arch curve peak region.
- E6: Coherent run cap investigation -- maxConsecutiveCoherent 81 (trace entries). Verify profiler-level cap (44) is still effective.

### Hypotheses to Track
- The regime shift (exploring 43->15%) was an unintended side effect of flicker widening. Wider flicker variety may change the coupling surface inputs to the regime classifier, shifting classification probabilities.
- Trust suppression (0.162->0.125) may be caused by the coherent-dominant regime (53.8%) -- coherent regime may inherently produce lower trust variance, reducing trust axis coupling energy.
- The DF/FP correlation emergence tracks the flicker widening: wider flicker creates consistent directional pressure across density and phase pairs.
- Exceedance growth (46->103) despite better distribution (0.804->0.573 concentration) suggests the flicker widening increased coupling energy globally. The entropy-trust pair (41 beats) is a new hotspot that wasn't significant before.

---

## R5 -- 2026-03-25 -- STABLE

**Profile:** explosive | **Beats:** 1029 | **Duration:** 138.2s | **Notes:** 40190
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- AXIS GINI BEST SINCE R2: 0.1409 -> 0.0906 (-36%). All 5 structural evolutions contributed. This is the payoff of working *through* the hypermeta infrastructure instead of around it.
- PHASE RECOVERED: 0.115 -> 0.155 (+35%). E3 (fair-share anchor in phaseFloorController threshold) broke the self-reinforcing suppression spiral. Phase now near fair share (0.167).
- ENTROPY RECOVERING: 0.106 -> 0.132 (+24%). Removing the manual floor (E5) and letting the generic undershoot handler + progressive giniMult (E1-E2) work. Still below fair share but trending correctly.
- FLICKER CONTAINED: 0.222 -> 0.191 (-14%). Progressive giniMult (E1) made the overshoot handler respond proportionally -- flicker at 0.191 is now near fair share.
- MODAL DIVERSITY RESTORED: 4 modes (mixolydian, minor, major). Zero ionian sections. E4 (BRIGHT_POOL dedup) eliminated the double ionian/major weight.
- SECTIONS EXPANDED: 6 -> 7 sections. New section 6 in Ab mixolydian.
- EXPLORING SURGED: 27.9% -> 43.0%. Coherent dropped 44.8% -> 38.3%, evolving 27.0% -> 18.4%.
- TENSION ARC IMPROVED: [0.612, 0.668, 0.569, 0.471] -> [0.697, 0.805, 0.557, 0.503]. Strong arch shape with Q2 peak at 0.805.
- NOTES MAINTAINED: 39170 -> 40190 (+2.6%). Stable output volume despite regime shift.
- EXCEEDANCE SHIFTED: FT(19)->DF(27). DF returned as top exceedance pair (27 beats). Hotspot migration is expected -- the coupled system redistributes pressure.
- Harmonic journey: F mixolydian -> B minor -> B major -> Eb minor -> E minor -> E major -> Ab mixolydian. Rich tonal variety with 6 tonics, 4 modes.
- DT pearsonR resurgent: 0.4173 ("increasing"). Needs monitoring.
- TP pearsonR emerging: 0.4863 ("increasing"). New correlation pair to watch.

### Evolutions Applied (from R4, restructured to use hypermeta infrastructure)
- E1: Progressive giniMult (axisEnergyEquilibratorRefreshContext.js) -- **confirmed** -- Gini 0.1409->0.0906. Binary threshold at 0.40 was dead code (Gini never exceeded 0.15). Continuous ramp [0.08,0.33] -> [1.0,1.7] makes equilibrator respond proportionally.
- E2: Symmetric giniMult in undershoot (axisEnergyEquilibratorAxisAdjustments.js) -- **confirmed** -- suppressed axes recover faster when system is imbalanced. Phase +35%, entropy +24%.
- E3: Fair-share anchor in phaseFloorController threshold (phaseFloorController.js) -- **confirmed** -- phase 0.115->0.155. The lowShareThreshold was tracking the declining shareEma downward (self-reinforcing blind spot). fairShare*0.65=0.108 floor ensures detection regardless of EMA decay.
- E4: BRIGHT_POOL dedup (harmonicJourneyPlanner.js) -- **confirmed** -- zero ionian sections. Replaced duplicate 'ionian' (=major) with 'dorian' for modal variety during coherent regime.
- E5: Removed manual entropy floor at 0.13 (axisEnergyEquilibratorAxisAdjustments.js) -- **confirmed** -- entropy recovering (0.106->0.132) via generic handlers with E1-E2 support. Manual floor was a whack-a-mole override conflicting with hypermeta equilibrator.

### Architectural Lesson: Hypermeta-First Rule
R1-R4 repeatedly fell into the whack-a-mole antipattern: adding manual floors/caps (entropy 0.13, trust 0.14, tension 0.15) that duplicate, conflict with, or circumvent the existing hypermeta self-calibrating controllers. R5 proves the correct approach:
1. Diagnose WHY the controller isn't working (dead threshold, asymmetric handler, self-reinforcing threshold decay)
2. Fix the controller logic itself (progressive giniMult, symmetric recovery, fair-share anchor)
3. Remove manual overrides that conflict

The 16 hypermeta controllers + orchestrator (#17) already manage: coupling targets, regime distribution, pipeline centroids, flicker range, trust starvation, coherent relaxation, entropy amplification, progressive strength, gain budgets, meta-telemetry, inter-controller conflict detection, homeostasis, axis equilibration, phase floor, pair gain ceilings, and warmup ramps. Manual constant overrides bypass this infrastructure and create unregistered feedback loops.

### Evolutions Proposed (for R6)
- E1: Jurisdiction enforcement system -- centralized declaration of controller-managed parameters with pipeline validation script. Prevents future whack-a-mole regression structurally.
- E2: DT correlation containment -- pearsonR 0.4173 resurgent. Investigate controller #1 (selfCalibratingCouplingTargets) response.
- E3: TP correlation containment -- pearsonR 0.4863, new emerging pair. May need controller attention.
- E4: Evolving share recovery -- dropped 27.0%->18.4%. Investigate regimeDistributionEquilibrator (#2) parameters.
- E5: DF exceedance management -- 27 beats returned as top pair. Check pairGainCeilingController (#15) DF-specific ceiling.

### Hypotheses to Track
- DF exceedance resurgence (27 beats) might be the balloon effect from containing flicker -- pressure redistributes to flicker's highest-coupling pair.
- DT and TP correlation growth may be structural response to axis rebalancing -- as axes equalize, new coupling pathways emerge.
- Evolving share drop (27%->18%) correlates with exploring surge (28%->43%). The progressive giniMult may be strengthening exploring regime via faster axis recovery, reducing the conditions that trigger evolving.
- Remaining manual floors (tension at 0.15, trust at 0.14 with 1.2x rate) may still conflict with the generic handlers. Evaluate removal in R7 after jurisdiction enforcement is in place.

---

## R4 -- 2026-03-25 -- STABLE

**Profile:** explosive | **Beats:** 968 | **Duration:** 138.9s | **Notes:** 39170
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- TRUST RECOVERED: share 0.114 -> 0.174 (+53%). E1 (raised graduated brake 0.50->0.60) stopped over-suppression.
- NOTES RECOVERED: 29466 -> 39170 (+33%). Both layers up ~33%. Trust recovery directly restored engagement.
- FT FULLY DECORRELATED: pearsonR 0.4317 -> 0.0504 (-88%). E4 (ftDecoupleBrake 0.025->0.04) highly effective. Direction: "stable".
- DT DECORRELATED: pearsonR 0.3484 -> -0.2753. Graduated brake at 0.60 catches moderate coupling without crushing trust.
- DF EXCEEDANCE CONTAINED: 34 -> 2 beats. E2 (DF linear GGM) prevented DF escalation.
- EVOLVING MAINTAINED: 27.0% (~same as R3's 27.8%). Regime balance excellent: coh 44.8%, evo 27.0%, exp 27.9%.
- ENTROPY COLLAPSED: 0.140 -> 0.106 (-24%). E3's floor at 0.13 didn't fire because entropy entered below detection. Needs higher floor.
- PHASE DROPPED: 0.145 -> 0.115 (-21%). Concerning regression.
- FLICKER DOMINANT: share 0.222, highest axis. Needs containment.
- AXIS GINI WORSENED: 0.1286 -> 0.1409 (+10%). Entropy (0.106) and phase (0.115) dragging balance.
- FT EXCEEDANCE NOW TOP PAIR: 19 beats (despite low pearsonR 0.05). High p95 tail, not sustained correlation.
- MODAL DIVERSITY REGRESSED: 2 modes (ionian heavy: 4/6 sections). R3 had 4 modes.
- Tension arc: [0.612, 0.668, 0.569, 0.471]. Q1 recovered (+0.126), more arch-shaped than R3.
- Harmonic: A# ionian -> A ionian -> A# ionian -> C# minor -> Ab ionian -> A# ionian. Ionian-dominated.
- Non-fatal manifest-health warning: tension-flicker coupling -0.847 in coherent.

### Evolutions Applied (from R3)
- E1: Raise DT brake threshold 0.50->0.60 (adaptiveTrustScores.js) -- **confirmed** -- trust share 0.114->0.174 (+53%).
- E2: DF linear GGM, sqrt for others (couplingGainEscalation.js) -- **confirmed** -- DF exceedance 34->2.
- E3: Entropy floor at 0.13 (axisEnergyEquilibratorAxisAdjustments.js) -- **refuted** -- entropy fell 0.140->0.106. Floor too low.
- E4: FT brake 0.025->0.04 (regimeReactiveDamping.js) -- **confirmed** -- FT pearsonR 0.4317->0.0504.

### Evolutions Proposed (for R5)
- E1: Raise entropy floor 0.13->0.15 + higher rate -- entropy at 0.106, deeply suppressed.
- E2: Phase axis recovery -- shift dropped 0.145->0.115. Phase floor should engage more aggressively.
- E3: Flicker containment -- share 0.222, dominant. Add flicker share brake in equilibrator or damping.
- E4: Modal diversity -- ionian dominates (4/6 sections). Explore MODERATE_MOVES weighting or start pool rebalancing.
- E5: FT exceedance containment -- 19 beats despite low pearsonR. p95 tail management needed.

### Hypotheses to Track
- Entropy collapse is structural: entropy has no floor in equilibrator (only cap at 0.19). Adding floor should directly help.
- Ionian dominance may be from BRIGHT_POOL during coherent regime (which runs 44.8%). Coherent selects bright modes, and ionian is the most common bright mode. Need to diversify bright pool weighting.
- Phase drop may be a balloon effect from trust recovery: trust axis lifted at phase's expense.
- Flicker dominance suggests the sqrt(GGM) for non-DF pairs lets flicker pairs escalate faster.
- FT exceedance high despite low pearsonR because exceedance measures instantaneous tail events, not sustained correlation.

---

## R3 -- 2026-03-25 -- STABLE

**Profile:** explosive | **Beats:** 748 | **Duration:** 106.4s | **Notes:** 29466
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- MODE DIVERSITY BREAKTHROUGH: 4 modes (minor, mixolydian, phrygian, ionian). Phrygian and mixolydian appeared mid-journey for first time. E1 (modal interchange + MODERATE in opening) confirmed.
- TENSION-FLICKER FULLY DECORRELATED: pearsonR 0.486 -> 0.005 (-99%). Multiple evolutions contributed — escalation decoupling (E3) changed gain dynamics.
- EVOLVING SURGED: 17.1% -> 27.8% (+63%). Best evolving share in this lineage. Regime balance improving (coh 39%, exp 33%, evo 28%).
- DENSITY-TRUST DECORRELATED: pearsonR 0.5015 -> 0.3484 (-31%). E4 (graduated correlation brake) caught moderate coupling.
- TRUST COLLAPSED: share 0.143 -> 0.114 (-20%). E4's graduated brake suppressed trust weights more than E2's floor rate could lift them. Net effect: decorrelation achieved but trust starved.
- DF EXCEEDANCE SURGED: 3 -> 34 beats. DF hotspot dominance returned. E3 (sqrt escalation) may have let DF escalate faster.
- AXIS GINI WORSENED: 0.0669 -> 0.1286 (+92%). Density (0.220) and tension (0.212) dominant, trust (0.114) and entropy (0.140) suppressed.
- TENSION ARC FLATTENED: [0.625,0.732,0.506,0.450] -> [0.486,0.694,0.578,0.502]. Less front-loaded, more gradual. Q3/Q4 rose but Q1/Q2 fell.
- NOTES DROPPED: 36156 -> 29466 (-18.5%). L1 down 25.6%.
- globalGainMultiplier unchanged 0.6036. Budget pressure still 0.997.
- Harmonic: E minor -> A minor -> B minor -> Bb mixolydian -> F# phrygian -> Gb minor. 6 tonics, 4 modes.
- Flicker-trust pearsonR: 0.3012 -> 0.4317 (resurgent, "increasing"). FT brake from R2 not sufficient.

### Evolutions Applied (from R2)
- E1: Modal diversity pathways (harmonicJourneyHelpers.js) — **confirmed** — phrygian and mixolydian appeared mid-journey. 3 modes -> 4 modes.
- E2: Trust floor rate boost 0.50->1.20 (axisEnergyEquilibratorAxisAdjustments.js) — **refuted** — trust share fell 0.143->0.114. E4 overwhelmed any lift.
- E3: Escalation rate sqrt(GGM) (couplingGainEscalation.js) — **inconclusive** — GGM unchanged. TF decorrelation dramatic but DF exceedance surged.
- E4: Graduated density-trust correlation brake at 0.50 (adaptiveTrustScores.js) — **confirmed for decorrelation** — DT pearsonR 0.5015->0.3484. But over-suppressed trust share.
- E5: Coherent budget bonus +8% (homeostasisRefresh.js) — **inconclusive** — coherent share fell to 39%, reducing bonus frequency. No visible budget relief.

### Evolutions Proposed (for R4)
- E1: Relax graduated DT brake threshold 0.50->0.55 — trust collapsed because brake fires too often. Raise threshold to catch only stronger correlations.
- E2: Trust axis recovery on multiple fronts — trust at 0.114, needs structural lift beyond floor rate.
- E3: DF exceedance containment — 34 beats, returned to monopoly. Need adaptive DF-specific ceiling or brake.
- E4: Tension arc restoration — Q1 dropped 0.625->0.486. Investigate section-progressive tension.
- E5: Note count recovery — 29466, down 18.5%. Investigate if trust suppression reduces play probability.
- E6: Flicker-trust re-decorrelation — pearsonR 0.4317, resurgent above 0.40. R2's ftDecoupleBrake may need strengthening.

### Hypotheses to Track
- Trust collapse is E4's direct effect: graduated brake at 0.50 fires on every beat with moderate DT coupling, continuously suppressing trust weights.
- DF exceedance surge may be a balloon effect from trust suppression: trust energy displaced into density and flicker pairs.
- Note count decline correlates with trust decline: lower trust weights -> lower cross-layer engagement -> fewer notes.
- The sqrt(GGM) escalation change may have made DF pair escalate faster before homeostasis can compress it.
- Flicker-trust resurgent despite R2 ftDecoupleBrake: the brake is 0.025 max, may be too weak for high-coupling regimes.

---

## R2 -- 2026-03-25 -- STABLE

**Profile:** explosive | **Beats:** 867 | **Duration:** 104.4s | **Notes:** 36156
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- MODAL DIVERSITY BREAKTHROUGH: 2 modes -> 3 modes (ionian, minor), 4 tonics -> 5 tonics (A, D, C, Ab, Eb). E1 (regime-responsive mode brightness) drove dark-mode selection during exploring regime.
- AXIS BALANCE BEST-EVER: axisGini 0.1026 -> 0.0669 (-35%). All axes 0.143-0.196. Phase recovered 0.121 -> 0.150 (+24%).
- FLICKER-TRUST DECORRELATED: pearsonR 0.4358 -> 0.3012 (-31%). E4 (ftDecoupleBrake) directly suppressed co-movement. Below 0.40 threshold.
- EVOLVING RECOVERED: 14.1% -> 17.1% (+21%). E3 (tension-aware sustain) widened velocity ceiling during high-tension beats.
- EXCEEDANCE DISTRIBUTED: top2 concentration 0.864 -> 0.656 (-24%). DF monopoly broken (17 -> 3 beats). Flicker-trust now top pair (13 beats), followed by flicker-phase (8), entropy-phase (6).
- NEW CORRELATIONS TO WATCH: density-trust 0.5015 (highest, new), tension-flicker 0.486 (surged from 0.170). Both "increasing" direction.
- TENSION RETREATED: share 0.208 -> 0.151 (-27%), back below fair share. avgTension 0.644 -> 0.628.
- globalGainMultiplier 0.6026 -- homeostasis compressing, budget constraint active (pressure 0.997).
- maxConsecutiveCoherent 80 -> 64, 2 forced transitions.
- Profile changed coherent -> explosive (stochastic, confounds some attribution).

### Evolutions Applied (from R1)
- E1: Regime-responsive mode brightness — **confirmed** — mode count 2->3, tonic count 4->5. Dark modes (minor) appeared in exploring sections.
- E2: Phase-aware arc type — **inconclusive** — phase share improved 0.121->0.150 (+24%), but profile change confounds. Mechanism fires at phaseShare < 0.14.
- E3: Tension-aware evolving sustain — **confirmed** — evolving share 14.1%->17.1% (+21%). Velocity ceiling widened by tensionBiasProduct.
- E4: Bidirectional flicker-trust brake — **confirmed** — FT pearsonR 0.4358->0.3012 (-31%). ftDecoupleBrake directly dampened co-movement.
- E5: DF-responsive flicker arch offset — **inconclusive** — DF exceedance 17->3 (-82%), but profile change and total exceedance increase (22->32) confound. DF p95 0.879->0.770.

### Evolutions Proposed (for R3)
- E1: Density-trust decorrelation — pearsonR 0.5015 (highest, "increasing"). New structural pathway needed.
- E2: Tension-flicker decorrelation — pearsonR 0.486 (surged). May need coupling-aware tension brake.
- E3: Tension axis recovery — share 0.208->0.151, back below fair share. Investigate tension suppression source.
- E4: Trust axis lift — share 0.143, still lowest. Explore trust velocity amplification or trust-responsive coupling.
- E5: Harmonic journey diversification — push beyond 3 modes. Enable less common modes (lydian, phrygian) or chromatic motion.
- E6: Gain budget relief — globalGainMultiplier 0.6026 suggests over-compression. Investigate budget ceiling or floor settings.

### Hypotheses to Track
- Density-trust correlation 0.5015 may be structural: when density rises, trust modules respond in same direction. Check if contextualTrust or adaptiveTrustScores reads density signal.
- Tension-flicker 0.486 surge: the ftDecoupleBrake reduces FT coupling but may redirect energy into TF pair.
- Phase recovery (0.121->0.150) partially from profile change (explosive may have stronger phase engagement).
- globalGainMultiplier at 0.6026 indicates the coupling budget is saturated — pairs are being uniformly suppressed.

---

## R1 -- 2026-03-25 -- STABLE

**Profile:** coherent | **Beats:** 1033 | **Duration:** 117.8s | **Notes:** 41465
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- TENSION AXIS RECOVERED: share 0.119 -> 0.208 (+75%). E2 (evolving tension dir 1.0->1.3) drove tension coupling during evolving beats. Tension now above fair share.
- AXIS BALANCE RECOVERED: axisGini 0.1584 -> 0.1026 (-35%). All axes between 0.121-0.208.
- ENTROPY SURGED: share 0.129 -> 0.198 (+53%). E3 (entropy velAmp +0.5 all tiers) drove entropy coupling broadly. entropyRegulator trust +18%.
- DENSITY CONTAINED: share 0.219 -> 0.141 (-36%). E4 (brake threshold 0.20->0.18) engaged earlier. Slightly below fair share.
- TENSION ARC IMPROVED vs prior: peak 0.703 -> 0.724 (+3%). E1 (boundary floor 0.15->0.08) partially restored bell-curve contrast.
- EVOLVING REGRESSED: 24.5% -> 14.1% (-42%). Stronger tension dir (E2) may push evolving beats toward coherent classification faster.
- MODAL DIVERSITY: E major -> D major -> A major -> A major -> A minor -> C major -> E major. 4 tonics, 2 modes. E5 (palette break at 2+) didn't improve modal count.
- maxConsecutiveCoherent: 80. Transition count 46.
- Flicker-trust correlation 0.4358 (increasing) -- only pair above 0.40 threshold.
- Exceedance stable at 22. DF dominant (17/22 = 77%).

### Evolutions Applied
- E1: Cross-mod boundary floor 0.15 -> 0.08 -- partially confirmed -- tension arc peak +3%.
- E2: Evolving tension direction 1.0 -> 1.3 -- confirmed -- tension share +75%. Primary driver of tension recovery.
- E3: Entropy velAmp boost (+0.5 all tiers) -- confirmed -- entropy share +53%. entropyRegulator trust +18%.
- E4: Density brake threshold 0.20 -> 0.18 -- confirmed -- density share -36%. May have over-corrected.
- E5: Palette break dominance threshold 3 -> 2 -- refuted -- still only 2 modes.

### Evolutions Proposed (for R2)
- E1: Evolving recovery -- 24.5%->14.1%. Moderate tension dir 1.3->1.15 or widen evolving classification.
- E2: Phase axis recovery -- phase 0.121, lowest axis, 27% below fair share.
- E3: DF exceedance containment -- 17/22 beats are DF. p95 0.879.
- E4: Flicker-trust decorrelation -- pearsonR 0.4358 (above threshold).
- E5: Tension arc shape -- peak 0.724 still below prior best 0.846.
- E6: Modal diversity via regime-responsive mode selection.

### Hypotheses to Track
- Evolving regression likely caused by E2: stronger tension dir pushes evolving beats toward coherent classification faster.
- Density over-correction (0.141) suggests brake threshold 0.18 is too aggressive. Consider 0.19.
- DF exceedance monopoly (77%) is structural: density and flicker have most natural conductor variance.
- Velocity amplification is the universal fix for slow-changing axes (trust, phase, entropy all responded).

---

## Durable Lessons (from prior 99-round lineage)

- **Never hand-tune constants that controllers manage.** Hypermeta self-calibrates if wiring is complete.
- **Check orchestrator contradiction resolutions are consumed.** Dead wires = dead intelligence.
- **Stability is necessary but not sufficient.** Several stable rounds were musically worse than baseline.
- **Localized containment safer than broad redistribution.**
- **Compound multi-scale signals transform weak axes.**
- **Flicker centroid correction is permanently refuted.**
- **Check classification evaluation ORDER, not just thresholds.**
- **Velocity amplification is the universal fix for slow-changing axes.**
- **Bell-curve midpoint concentration drives tension arc peaks** but needs careful boundary floor calibration.
- **Exploring flicker direction 1.35 is the sweet spot.**
- **Palette break dominance threshold doesn't improve modal diversity** when journey planner selects related keys.

## Snapshot Policy

- Snapshot after STABLE runs with healthy metrics.
- Do not snapshot EVOLVED/DRIFTED runs or runs that regress phase, trust, evolving, or axis Gini.
