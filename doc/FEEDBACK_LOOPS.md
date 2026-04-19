# Feedback Loops

11 registered closed-loop feedback controllers, a correlation shuffler for pathological pattern detection, and the feedbackOscillator for cross-layer energy exchange.

## Registered Loops

All loops register via `closedLoopController.create()` which auto-enrolls with `feedbackRegistry`. Each loop has: observe function, target function, gain, smoothing, clamp range.

| Loop | Source Domain | Target Domain | Module |
--
| dynamic-architect-planner | intensity | tension | dynamicArchitectPlanner |
| coherence-monitor | notes_emitted | density | coherenceMonitor |
| pipeline-balancer-tension | tension_product | tension | pipelineBalancer |
| pipeline-coupling-manager | coupling_matrix | density_tension_flicker | pipelineCouplingManager |
| regime-reactive-damping | regime | density | regimeReactiveDamping |
| entropy-regulator | entropy | cross_layer_prob | entropyRegulator |
| stutter-variant-feedback | stutter_density | stutter_variant_selection | stutterVariants |
| correlation-shuffler | feedback_correlation | feedback_loop_dampening | correlationShuffler |
| emergent-rhythm-port | emergent_rhythm | rhythm_density_complexity | emergentRhythmEngine |
| rhythmic-contagion | stutter_contagion | rhythm_complement | stutterContagion |
| emergent-melodic-port | melodic_context | interval_novelty_contour | emergentMelodicEngine |

## Resonance Dampening

`feedbackRegistry.getResonanceDampening(loopName)` checks all loop pairs. When two loops target the same domain and push in the same direction with amplitude > 0.5, applies 30% dampening. Correlation shuffler perturbations are also applied here.

## Correlation Shuffler

`src/conductor/signal/meta/manager/correlationShuffler.js` -- detects pathological correlations between feedback loops and applies graduated perturbations.

### Detection

Rolling 80-beat Pearson correlation between all loop amplitude/phase outputs:

- **Reinforcement spiral**: same domain, correlation > 0.65 for 40+ beats -> scale down stronger loop (0.5-0.95x)
- **Tug-of-war**: same domain, anti-correlation < -0.65 for 40+ beats -> timing rotation of weaker loop
- **Cross-domain lock**: different domains, amplitude correlation > 0.65 for 60+ beats -> magnitude perturbation
- **Stasis**: all loops flat (amplitude < 0.05) for 100+ beats -> inject random perturbations into 3 loops

### Key Design: Inversely Health-Gated

`healthScale = 1.5 - healthEma`. Stressed system gets STRONGER shuffles (correlation lock may be causing the stress). Healthy system gets gentler shuffles.

### Self-Assessment

12-beat recovery attribution window. Successful shuffles raise confidence EMA, failed ones lower it. Shuffle strength scales by `clamp(shuffleConfidence, 0.2, 1.0)`.

## FeedbackOscillator

`src/crossLayer/rhythm/feedbackOscillator.js` -- creates actual multi-round-trip energy loops between layers with pitch class memory.

- **Inject**: posts energy impulse to L0 `feedbackLoop` channel
- **React**: other layer reads impulse, dampens by 55% (entropy-modulated), computes complementary pitch class, re-posts
- **Energy drives**: stutter echo probability (via `setFeedbackStutterEnergy`), arc type selection (via conductor accessors)
- **CIM modulation**: coordination scale modulates damping (coordinated = less damping, energy flows freely)

Round-trips: max 6 before energy drops below 0.03 threshold.

## Stutter Feedback Chain

```
Stutter variant fires
  -> STUTTER_APPLIED event (with layer field)
  -> stutterFeedbackListener accumulates per-profile intensity (layer-filtered)
  -> dynamismEngine.getFeedbackEnergy() reads layer-aware stutter intensity
  -> modulates next beat's stutterProb
  -> gates stutter invocation in playNotesEmitPick
```

## Cross-Layer Contagion

```
Layer 1 stutters
  -> stutterContagion.postStutter() to L0
  -> Layer 2: stutterContagion.checkContagion() reads with adaptive decay
     (0.35 sticky when converged, 0.8 loose when divergent, per-layer tickDuration)
  -> triggers secondary stutter on L2
  -> forces ghostStutter variant for contagion-triggered note echoes
  -> re-posts with further decay for chain propagation
```

## Adding a New Feedback Loop

1. Use `closedLoopController.create({ name, observe, target, gain, smoothing, clampRange, sourceDomain, targetDomain })`
2. The loop auto-registers with `feedbackRegistry`
3. Add to `feedbackGraphContract` in `src/play/feedbackGraphContract.js` (refs + methods)
4. Ensure `scripts/validate-feedback-graph.js` passes
