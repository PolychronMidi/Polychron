## R40 — 2026-03-23 — STABLE

**Profile:** default | **Beats:** 507 | **Duration:** 99.2s | **Notes:** 21478
**Fingerprint:** 11/11 stable | Drifted: none

### Key Observations
- The run stayed statistically stable, but the profile switched from explosive to default, so this round is not suitable as a new baseline for the explosive lineage.
- Regime balance moved back into range: coherent rose 15.5% -> 42.2% and exploring fell 78.0% -> 55.8%.
- Trust and hotspot pressure improved further: total exceedance beats fell 46 -> 30, trust-axis share fell 0.1432 -> 0.1145, and tension-trust fell from 9 to 5 beats.
- Phase stayed strong instead of collapsing: hotspot phase share rose 0.1014 -> 0.1397 and telemetry health improved 0.3812 -> 0.5128.
- The run became too sparse for the explosive target: output1 fell to 9912 (-37.6% vs explosive baseline) and output2 fell to 11566 (-36.5%).
- The ending cooled somewhat but still does not truly resolve: avg tension fell 0.788 -> 0.657, yet the arc still ends high at 0.821 and the four-section route ends on F major without return-home closure.
- Density-flicker resumed top-pair status at 9 beats, though overall pressure remained much lower than the explosive baseline.
- This run is intentionally not snapshotted because the active profile changed unexpectedly and the output level no longer reflects the explosive baseline we are evolving from.

### Evolutions Applied (from R39)
- E1: Rebalance coherent share now that phase is healthy, without collapsing back to R38 starvation — inconclusive — coherent recovered from 15.5% to 42.2%, but the run switched to default so the explosive target condition was not preserved.
- E2: Restore a true final descent instead of a hot late plateau — inconclusive — avg tension fell 0.788 -> 0.657 and section-1/2 tension cooled, but the arc still ends high at 0.821.
- E3: Prevent tension-trust from becoming the replacement hotspot as density-flicker cools — confirmed — tension-trust beats fell 9 -> 5 and it lost top-pair status.
- E4: Make long-form endings close intelligently when they remain remote on the final section — inconclusive — the composition collapsed to four sections, so the long-form late-closure path was not exercised.
- E5: Preserve explosive note restraint while avoiding another L2 rebound — refuted — the profile switch to default drove output far below the explosive target surface.
- E6: Keep density-flicker suppressed while late tension resolves — inconclusive — total pressure fell sharply to 30 beats, but density-flicker still returned as the top pair with 9 beats.

### Evolutions Proposed (for R41)
- E1: Reduce cross-profile variance so explosive rounds stay comparable to the explosive baseline — profile adaptation or profile selection modules
- E2: Recover explosive output density without reintroducing the old L2 overshoot — dynamismEngine.js or structural intensity modules
- E3: Preserve the R40 regime rebalance while restoring a true final release — regime and global tension modules
- E4: Keep tension-trust subdued and cut density-flicker without flattening the surface — trust weighting and conductor dampening modules
- E5: Make late closure logic work for both four-section and five-section forms — harmonicJourneyPlanner.js
- E6: Hold phase above target while note density comes back up — phase rhythm and structural intent modules

### Hypotheses to Track
- The regime-balancing change itself looks sound, but the unexpected profile switch made the output too sparse to trust as an explosive evolution result.
- The next useful step is likely stabilizing profile context or conditioning output logic on the active profile more explicitly so explosive and default do not confound each other.
- Tension-trust can be contained without losing phase, but density-flicker reasserts itself whenever the overall pressure field thins out.
- Late closure still needs a form-aware rule that works regardless of whether the piece lands on four or five sections.

---

## R39 — 2026-03-23 — STABLE

**Profile:** explosive | **Beats:** 603 | **Duration:** 119.0s | **Notes:** 30318
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- Phase recovered aggressively and cleanly: hotspot phase share rose 0.0048 -> 0.1014, no axis remained below floor, and axis Gini tightened to 0.1347.
- The useful restraint mostly held: versus the R37 baseline, output1 stayed down 15890 -> 13604 (-14.4%) and output2 stayed down 18203 -> 16714 (-8.2%).
- Density-flicker stopped monopolizing recovery: its exceedance beats fell 10 -> 5, densityFlickerTailPressure fell 0.9059 -> 0.5895, and top-2 concentration improved again to 0.3043.
- Trust-axis congestion stayed low while phase came back: trust share fell further 0.1787 -> 0.1432.
- The tradeoff moved into regime and ending shape: exploring jumped to 77.98%, coherent fell to 15.45%, and the tension arc now ends too hot at 0.8447.
- The pressure field rotated rather than collapsed: tension-trust became the new top pair at 9 exceedance beats, while total exceedance stayed effectively flat at 46.
- Harmonic wandering is still overextended: the route D# dorian -> F dorian -> G dorian -> C dorian -> B major never found a real late closure.
- This run is intentionally not snapshotted because the phase recovery is excellent, but the regime balance and ending resolution are not yet healthy enough.

### Evolutions Applied (from R38)
- E1: Restore explosive-profile phase share without reopening note inflation — confirmed — phase share rose 0.0048 -> 0.1014 while total notes stayed below the R37 baseline.
- E2: Make long-form restraint phase-safe instead of globally suppressive — confirmed — the note surface recovered from 26232 to 30318 without losing the restraint gains or collapsing phase again.
- E3: Target density-flicker sticky-tail pressure directly now that it is the clear recovery bottleneck — confirmed — densityFlickerTailPressure fell 0.9059 -> 0.5895 and density-flicker beats fell 10 -> 5.
- E4: Keep swapped-L2 contained while preserving phase-supportive output lanes — inconclusive — L2 rose 13737 -> 16714 to support phase recovery, but it still remained below the R37 explosive baseline of 18203.
- E5: Add a conditional late closure path so longer journeys can still resolve after wandering — refuted — the journey still ended away from the origin and did not achieve a true return-home close.
- E6: Preserve trust-axis relief while phase recovers — confirmed — trust share stayed low at 0.1432 while phase rose above 10%.

### Evolutions Proposed (for R40)
- E1: Rebalance coherent share now that phase is healthy, without collapsing back to R38 starvation — regimeClassifierResolution.js
- E2: Restore a true final descent instead of a hot late plateau — globalConductor.js
- E3: Prevent tension-trust from becoming the replacement hotspot as density-flicker cools — adaptiveTrustScores.js or trust helper modules
- E4: Make long-form endings close intelligently when they remain remote on the final section — harmonicJourneyPlanner.js
- E5: Preserve explosive note restraint while avoiding another L2 rebound — dynamicRoleSwap.js or dynamismEngine.js
- E6: Keep density-flicker suppressed while late tension resolves — conductor or dampening modules

### Hypotheses to Track
- The phase-safe restraint is the right direction, but once phase is healthy the regime resolver still lets exploring dominate too freely.
- Cooling density-flicker exposed tension-trust as the next structural hotspot, especially in late sections where the release never completes.
- The harmonic journey now needs a stronger final closure rule, not just an optional chance, when long-form wandering stays remote into the resolution section.
- The best next round will keep the restored phase share while spending it on coherence and ending resolution rather than on more exploration.

---

## R38 — 2026-03-23 — STABLE

**Profile:** explosive | **Beats:** 510 | **Duration:** 108.1s | **Notes:** 26232
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- Explosive note inflation finally came down: output1 fell 15890 -> 12495 (-21.4%) and output2 fell 18203 -> 13737 (-24.5%), cutting total notes to 26232.
- The fix overcorrected phase: hotspot phase share collapsed 0.0500 -> 0.0048, telemetry health fell 0.4983 -> 0.2479, and phase stale rate reached 0.7227.
- Mid-run tension spikes cooled decisively: section-1 avg tension dropped 0.937 -> 0.649, section-2 dropped 0.901 -> 0.473, and whole-run avg tension fell 0.784 -> 0.583.
- Pressure stayed diffuse even with the phase loss: density-flicker remained the top pair but fell 11 -> 10 beats, and top-2 concentration improved 0.4222 -> 0.3333.
- Trust-axis congestion eased in the intended direction: trust share fell 0.2045 -> 0.1787.
- Homeostasis is still working too hard against density-flicker: densityFlickerTailPressure hit 0.9059, stickyTailPressure 0.7881, and tailRecoveryHandshake 0.955.
- The new return-home moderation worked, perhaps too well: the five-section route stayed remote all the way to the end (F# minor -> G# minor -> D# minor -> G minor -> B major) with no closing return.
- This run is intentionally not snapshotted because the phase-axis regression outweighs the note-count improvement.

### Evolutions Applied (from R37)
- E1: Explosive-profile L2 output containment — confirmed — output2 fell 18203 -> 13737 (-24.5%) while keeping explosive profile active.
- E2: Hold phase share above 5% while reducing density-flicker exceedance — refuted — density-flicker beats eased 11 -> 10, but phase share collapsed 0.0500 -> 0.0048.
- E3: Mid-section tension de-spiking — confirmed — section-1 avg tension fell 0.937 -> 0.649 and section-2 fell 0.901 -> 0.473.
- E4: Trust-axis decongestion without losing phase gains — refuted — trust share improved 0.2045 -> 0.1787, but the phase gains were lost.
- E5: Section-count and note-count restraint under explosive — confirmed — total notes fell from 34093 to 26232 and trace entries fell 894 -> 683.
- E6: Return-home frequency moderation so harmonic journeys wander longer before closure — confirmed — the route no longer snapped back to the tonic in a five-section form, though it may now wander too long.

### Evolutions Proposed (for R39)
- E1: Restore explosive-profile phase share without reopening note inflation — phaseLockedRhythmGenerator.js and phaseFloorController.js
- E2: Make long-form restraint phase-safe instead of globally suppressive — sectionIntentCurves.js and crossLayerClimaxEngine.js
- E3: Target density-flicker sticky-tail pressure directly now that it is the clear recovery bottleneck — globalConductor.js or conductorDampening.js
- E4: Keep swapped-L2 contained while preserving phase-supportive output lanes — dynamicRoleSwap.js and dynamismEngine.js
- E5: Add a conditional late closure path so longer journeys can still resolve after wandering — harmonicJourneyPlanner.js
- E6: Preserve trust-axis relief while phase recovers — trust weighting or axis-energy modules

### Hypotheses to Track
- The note-count restraint is musically useful, but it is currently taking phase-bearing events down with the rest of the surface activity.
- Phase recovery under explosive profile likely needs a direct protected lane rather than relying on general exploring density.
- Density-flicker is no longer monopolizing exceedance, but the recovery system still sees it as the main sticky-tail burden.
- The new long-form return-home delay is directionally right, yet the final section now needs a smarter closure test rather than a blanket reluctance.

---

## R37 — 2026-03-23 — STABLE

**Profile:** explosive | **Beats:** 660 | **Duration:** 116.8s | **Notes:** 34093
**Fingerprint:** 11/11 stable | Drifted: none

### Key Observations
- Phase finally reached the target range for the active profile: hotspot phase share rose 0.0035 -> 0.0500 and telemetry health improved 0.3739 -> 0.4983.
- The pressure field stayed controlled: hotspot top pair remained density-flicker, top-2 concentration fell to 0.4222, and no trust pair dominated the run.
- The harmonic route is clean and varied: A# dorian -> D major -> A major -> C major -> A# dorian, with no consecutive repeated tonic and a genuine return-home ending.
- Final-section release improved: the tension arc shifted from [0.424, 0.736, 0.946, 0.935] to [0.568, 0.953, 0.716, 0.604], restoring a clear descent.
- L2 remains too strong under explosive: output2 reached 18203 notes and still exceeded L1 despite the adaptive moderation.
- Exceedance total rose from 10 to 45 versus R36, but remained below the explosive baseline of 48 and stayed structurally diffuse.
- Trust-axis share settled back near baseline at 0.2045 while phase rose, which is the best combined trust/phase balance since R34.
- This run is healthy enough to snapshot as the new explosive baseline.

### Evolutions Applied (from R36)
- E1: Alias-aware tonic memory in harmonicJourneyPlanner.js — confirmed — the route avoided consecutive repeated tonic and closed with a true return-home.
- E2: Phase floor lift from 0.35% toward the 2-5% range — confirmed — hotspot phase share rose 0.0035 -> 0.0500.
- E3: Final-section tension release shaping — confirmed — the ending fell from 0.716 to 0.604 instead of plateauing near 0.94.
- E4: Further L2 normalization while preserving recovery — inconclusive — the adaptive moderation exists, but output2 still expanded sharply under explosive profile.
- E5: Trust-axis share containment now that exceedance is low — confirmed — trust share fell 0.2385 -> 0.2045 while phase share rose.
- E6: Coherent-to-exploring handoff smoothing under default — inconclusive — the run switched to explosive, so the default-profile target condition was not exercised.

### Evolutions Proposed (for R38)
- E1: Explosive-profile L2 output containment — dynamismEngine.js or role-swap interplay
- E2: Hold phase share above 5% while reducing density-flicker exceedance — phase rhythm and conductor dampening modules
- E3: Mid-section tension de-spiking — globalConductor.js or climax shaping modules
- E4: Trust-axis decongestion without losing phase gains — trust weighting modules
- E5: Section-count and note-count restraint under explosive — structural form or intent modules
- E6: Return-home frequency moderation so harmonic journeys wander longer before closure — harmonicJourneyPlanner.js

### Hypotheses to Track
- The phase-floor and trust-axis changes are compatible under explosive profile; the next challenge is keeping phase above 5% while shaving density-flicker pressure.
- Explosive L2 overshoot is now more tied to overall section scale and note-density growth than to the old unconditional layer bias.
- The new return-home logic may now be too eager in five-section forms, shortening harmonic wandering at the tail.
- The restored release arc suggests the main remaining tension issue is the section-1 spike, not the ending.

---

## R36 — 2026-03-23 — STABLE

**Profile:** default | **Beats:** 542 | **Duration:** 99.8s | **Notes:** 23341
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- The pressure picture improved sharply versus R35: total exceedance beats fell 79 -> 10, hotspot concentration rose to only 0.600, and flicker-trust lost leadership entirely.
- Phase recovered, but only partially: hotspot phase share rose 0.0004 -> 0.0035 and max consecutive coherent beats dropped 163 -> 95, yet phase remains below floor.
- L2 moderation worked in absolute terms: output2 fell 19767 -> 14629 (-26.0%) and L2 trace entries fell 537 -> 420, though L2 still exceeds L1 by 68%.
- The tension arc now builds late again: [0.424, 0.736, 0.946, 0.935] with avg tension 0.706 and max 0.980.
- Harmonic memory is still incomplete: the journey repeats tonic C across sections 1 and 2 (C aeolian -> C minor).
- Trust-axis share rose to 0.2385 while phase stayed low, so the run traded hotspot severity for trust-axis concentration.
- Telemetry health regressed from 0.4908 to 0.3739 even though under-seen pair count improved 6 -> 2.
- This run is also intentionally not snapshotted: phase remains under floor and the default-profile rescue is still incomplete.

### Evolutions Applied (from R35)
- E1: Phase stabilization for default-profile runs — inconclusive — phase share improved 0.0004 -> 0.0035 and coherent max run fell 163 -> 95, but phase remains below floor.
- E2: L2 emission moderation after recovery — confirmed — output2 fell 19767 -> 14629 (-26.0%) and L2 trace entries fell 537 -> 420.
- E3: flicker-trust re-containment without reviving density-trust — confirmed — total exceedance beats fell 79 -> 10 and flicker-trust lost hotspot leadership.
- E4: Journey memory against late tonic recurrence — refuted — sections 1 and 2 still repeat tonic C (C aeolian -> C minor).
- E5: Preserve late descent while lifting the section-0 floor — refuted — the arc rebuilt a late rise, but it now ends on a high plateau [0.946, 0.935] and section-0 tension remains restrained.
- E6: Coherent run-length trimming under default — confirmed — max consecutive coherent beats dropped 163 -> 95 and transition count rose 9 -> 10.

### Evolutions Proposed (for R37)
- E1: Alias-aware tonic memory in harmonicJourneyPlanner.js
- E2: Phase floor lift from 0.35% toward the 2-5% range without reigniting flicker-trust — phase rhythm and axis-energy modules
- E3: Final-section tension release shaping — climax and tension modules
- E4: Further L2 normalization while preserving recovery — dynamismEngine.js and role-swap interplay
- E5: Trust-axis share containment now that exceedance is low — trust weighting modules
- E6: Coherent-to-exploring handoff smoothing under default — regime transition modules

### Hypotheses to Track
- The low-phase rescue works better than the prior default run, but coherent stretches still suppress phase too strongly once the piece stabilizes.
- Removing the unconditional L2 boost reduced the overshoot, but default-profile L2 is still overfed during longer traces.
- Once severe hotspot pressure falls, the system concentrates energy on the trust axis rather than distributing it toward phase.
- The journey planner now needs tonic-alias memory, not just same-string avoidance, because modal aliases like aeolian/minor still slip through.

---

## R35 — 2026-03-23 — STABLE

**Profile:** default | **Beats:** 613 | **Duration:** 107.0s | **Notes:** 32076
**Fingerprint:** 11/11 stable | Drifted: none

### Key Observations
- The run stayed fingerprint-stable but diverged sharply from the explosive baseline after the profile switched back to default: L1 11268 -> 12309 (+9.2%), L2 9026 -> 19767 (+119.0%), total 32076.
- The cadence pressure move worked only partially: density-trust lost top-pair status and hotspot concentration fell 0.8958 -> 0.4051, but flicker-trust returned as the dominant pair with 19 exceedance beats.
- Phase collapsed again: hotspot phase share fell 0.0226 -> 0.0004, making phase the only axis below floor while phaseLock trust still rose to 0.453.
- The tension shape de-frontloaded successfully: arc [0.468, 0.914, 0.723, 0.537], avg tension 0.742, with a real late descent instead of the R34 plateau.
- The harmonic route still has a terminal same-tonic repeat: C phrygian -> G phrygian -> A phrygian -> A dorian.
- Regime balance returned toward default-profile norms: coherent 45.2%, exploring 53.0%, evolving 1.3%.
- L2 is now the main structural outlier: 537 trace entries versus 336 for L1 and more than double the note-count growth.
- This run is intentionally not snapshotted: the profile changed unexpectedly and phase health regressed despite the stable fingerprint.

### Evolutions Applied (from R34)
- E1: Density-trust hotspot redistribution — confirmed — density-trust lost top-pair status and trust-axis share eased 0.2026 -> 0.1901, though flicker-trust re-emerged as the new leader.
- E2: Phase floor lift under exploring-heavy explosive runs — refuted — the run shifted back to default and phase share collapsed from 0.0226 to 0.0004.
- E3: Tension peak de-frontloading — confirmed — the arc relaxed from [0.593, 0.982, 0.875, 0.843] to [0.468, 0.914, 0.723, 0.537], restoring a clear descent.
- E4: Journey memory against tonic recurrence — refuted — sections 2 and 3 still repeat tonic A (A phrygian -> A dorian).
- E5: L2 recovery after role-swap reactivation — confirmed — output2 jumped 9026 -> 19767 (+119.0%) while roleSwap trust held at 0.207.
- E6: Trust hotspot handoff away from cadenceAlignment — inconclusive — cadenceAlignment trust eased 0.181 -> 0.177, but hotspot energy rotated back to flicker-trust instead of disappearing.

### Evolutions Proposed (for R36)
- E1: Phase stabilization for default-profile runs — phase rhythm and phase-floor modules
- E2: L2 emission moderation after recovery — dynamismEngine.js or layer emission shaping
- E3: flicker-trust re-containment without reviving density-trust — conductorDampening.js or trust weighting
- E4: Journey memory against late tonic recurrence — harmonicJourneyPlanner.js
- E5: Preserve late descent while lifting the section-0 floor — climax and tension shaping modules
- E6: Coherent run-length trimming under default — regime transition modules

### Hypotheses to Track
- The cadence-consensus change cooled density-trust, but the reduced trust pressure exposed older flicker-trust locking because flicker axis share rose to 0.2621.
- The new L2 recovery bias is too strong under default profile; it stacked with restored role-swap participation into a 119% L2 surge.
- Cross-profile variance is overwhelming the current phase-floor intervention; default and explosive likely need different rescue pathways.
- Journey same-tonic recurrence is now a late-route memory problem, not an immediate same-key retry problem.

---

## R34 — 2026-03-23 — STABLE

**Profile:** explosive | **Beats:** 427 | **Duration:** 73.6s | **Notes:** 20294
**Fingerprint:** 11/11 stable | Drifted: none

### Key Observations
- The run stayed stable after a profile shift to explosive and pulled note output back from the over-dense R33 baseline: L1 14122 -> 11268 (-20.2%), L2 13164 -> 9026 (-31.4%).
- The harmonic route is materially more varied: F# minor -> G# minor -> C major -> F# major -> A minor, with a fifth section added and no consecutive same-tonic sections.
- Phase recovered from near-collapse: hotspot phase share rose 0.0005 -> 0.0226, density-phase mean rose 0.0518 -> 0.0711, and tension-phase mean rose 0.0365 -> 0.1041, though phase is still the only axis below floor.
- flicker-trust was defused as the dominant liability: exceedance beats fell 57 -> 4 and p95 fell 0.950 -> 0.616. The new pressure pair is density-trust at 25 beats with p95 0.910.
- density-tension lockstep eased substantially: pearsonR dropped 0.6108 -> 0.2765 and the pair no longer appears as a coupling hotspot.
- roleSwap reactivated cleanly: trustFinal rose 0.000 -> 0.2098 and the manifest recorded positive swapped payoff state.
- Tension shape overshot early under explosive: arc [0.593, 0.982, 0.875, 0.843], avg tension 0.840, max tension 1.000. The split shaping worked, but the climax is now front-loaded.
- Regime balance is still exploring-heavy at 76.4%, with coherent down to 17.6% and evolving up to 5.2%.

### Evolutions Applied (from R33)
- E1: Same-tonic escape in the journey planner — confirmed — the route expanded to five sections and avoided consecutive same-tonic handoffs: F# minor -> G# minor -> C major -> F# major -> A minor.
- E2: Late-section density and tension split shaping — confirmed — density-tension pearsonR fell 0.6108 -> 0.2765 and avg coupling fell 0.4196 -> 0.1659, though section-1 tension overshot to 0.982.
- E3: Exploring-phase rhythmic injection — confirmed — phase hotspot share rose 0.0005 -> 0.0226 and phaseLock trust improved 0.4253 -> 0.4337.
- E4: flicker-trust hotspot relief — confirmed — flicker-trust exceedance beats dropped 57 -> 4 and p95 dropped 0.950 -> 0.616; hotspot leadership moved elsewhere.
- E5: Role-swap reactivation at phrase valleys — confirmed — roleSwap trust returned from 0.000 to 0.2098 and the manifest recorded `swapped: 0.35`.
- E6: Section-level contrast curves for denser harmonic travel — inconclusive — the piece added structural variety and reduced note counts, but density mean still rose 0.438 -> 0.533 under explosive profile.

### Evolutions Proposed (for R35)
- E1: Density-trust hotspot redistribution — adaptiveTrustScores.js or contextual trust modules
- E2: Phase floor lift under exploring-heavy explosive runs — axisEnergyEquilibratorAxisAdjustments.js or phase rhythm modules
- E3: Tension peak de-frontloading — globalConductor.js or sectionIntentCurves.js
- E4: Journey memory against tonic recurrence — harmonicJourneyPlanner.js
- E5: L2 recovery after role-swap reactivation — dynamicRoleSwap.js or layer emission shaping
- E6: Trust hotspot handoff away from cadenceAlignment — trust scoring modules

### Hypotheses to Track
- Suppressing flicker-trust exposes density-trust as the next pressure pair; hotspot energy is rotating across the trust axis rather than disappearing.
- The phase injection mechanism is working, but explosive exploring runs still keep phase below the 5% engagement target.
- Late-section split shaping fixed density-tension lockstep at the cost of an over-early tension summit.
- Same-tonic escape works locally, but the planner still revisits F# later in the route because it has no broader journey-memory penalty.

---

## R33 — 2026-03-23 — STABLE

**Profile:** default | **Beats:** 568 | **Duration:** 103.1s | **Notes:** 27286
**Fingerprint:** 10/10 stable | Drifted: none

### Key Observations
- Note output diverged sharply upward versus baseline: L1 7591 -> 14122 (+86.0%), L2 9778 -> 13164 (+34.6%), total 27286. The run is fingerprint-stable but structurally much denser.
- The tension arc is the strongest late-rise shape in the series: [0.554, 0.694, 0.875, 0.906] with avg tension 0.716 and max 0.969.
- Regime mix remains exploring-heavy at 65.8% with coherent 32.7%; evolving collapsed to 0.7%, so the earlier R33 evolving surge did not hold in the stable rerun.
- Phase axis starved again: hotspot phase share 0.0005, coupling means density-phase 0.0518, flicker-phase 0.0572, tension-phase 0.0365, despite telemetry still being present.
- flicker-trust is now the dominant pressure pair: p95 0.950, 57 exceedance beats, and 96.8% top-2 hotspot concentration. This is the main remaining coupling liability.
- Harmonic movement is brighter and higher but still repeats the tonic across the middle span: E lydian -> A lydian -> A ionian -> C# lydian. output1 pitch center rose 7 semitones versus baseline.
- Trust convergence improved slightly to 0.307, but roleSwap disappeared from trustFinal while phaseLock remained the strongest trust system at 0.425.

### Evolutions Applied (from R32)
- E1: Flicker range expansion — inconclusive — flicker range widened to 0.787-1.161, but the stable rerun concentrated 57 exceedance beats on flicker-trust with p95 0.950.
- E2: Trust learning acceleration — inconclusive — trustConvergence rose 0.302 -> 0.307, but roleSwap did not sustain participation in the stable rerun.
- E3: Phase stale detection — refuted — the stable rerun finished with only 0.0005 phase hotspot share and weak phase coupling means, so the earlier phase breakthrough did not persist.
- E4: Evolving regime identity — refuted — evolving ended at 0.7% in the stable rerun, below the R32 baseline of 1.3%.
- E5: Stutter profile rebalancing — inconclusive — note output increased sharply, but the change is confounded by the broader density and harmonic movement shifts.

### Evolutions Proposed (for R34)
- E1: Same-tonic escape in the journey planner — harmonicJourneyPlanner.js
- E2: Late-section density and tension split shaping — globalConductor.js
- E3: Exploring-phase rhythmic injection — crossModulateRhythms.js
- E4: flicker-trust hotspot relief — conductorDampening.js
- E5: Role-swap reactivation at phrase valleys — dynamicRoleSwap.js
- E6: Section-level contrast curves for denser harmonic travel — sectionIntentCurves.js

### Hypotheses to Track
- Phase starvation in stable default runs is structural, not just a stale-threshold issue; exploring beats are not feeding phase surfaces strongly enough.
- Same-tonic repeats are surviving because the current journey retries preserve mode diversity more reliably than root movement.
- flicker-trust exceedance is being driven by a high flicker floor aligning with trust, not by density-flicker alone.
- density-tension lockstep is strongest in the late sections, so section-level opposition should work better than more global smoothing.

---

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
