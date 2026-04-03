# Calibration Anchors

> Listening-confirmed constraints and proven thresholds from evolution rounds.
> These are the load-bearing decisions that prevent regressions.
> Source: code-docs-rag KB entries, verified by pipeline + listening.

## Timing

- **Base timing units immutable outside setBpm/setMeter.** spBeat, spDiv etc computed by setUnitTiming only. Any module modifying these directly causes cumulative L1/L2 drift. Proven R42: regime-responsive tempo scaling caused 10s WAV drift. (KB: 8f35d3ad602c)

## Coherent Regime

- **Coherent safety floor: 0.88 minimum.** resolveThreshold below 0.88 is destructive (proven R19 at 0.82, R23 at 0.80). Tension-accumulation mechanism caps coherent relief at 0.04. (KB: ba3ab86b1585)
- **Low coherent can sound LEGENDARY.** R40 had 3.3% coherent and received LEGENDARY verdict. Coherent share is NOT a quality proxy. Trust the listener. (KB: 98ffbf68abcc)

## Density

- **Compound suppression anti-pattern.** Multiple density-reduction mechanisms stack without coordination. Fix: unified budget (MAX_DENSITY_SUPPRESSION=0.45). (KB: 6a06484831dd)
- **Density-pressure homeostasis.** Exploring gets relief 0.15 (crowding IS worst in exploring). Evolving 0.12, coherent 0.20. If touched a third time, convert to effectiveness-weighted EMA. (KB: 24627ceb33a2)

## Layer Isolation

- **Per-layer state required for beat-processing mutable state.** observedIndependenceEma, lastMotifTrust, lastStutterTrust converted to byLayer maps in R39. densityPressureAccum left shared (system-wide). (KB: 50e8aa9b6e06)
- **L0 entries persist across section resets.** Gate reads with phrase/section position for one-time effects. R33 bug: cumulative NaN from unguarded L0 read. (KB: 2c34553dc6ee)

## Architecture

- **Conductor cannot write to crossLayer.** Route through L0 channels. conductorSignalBridge extended with regime + axisEnergy in R46. 10 files still need migration. (KB: 5d056715ba12, 39f860ca0a08)
- **Trust payoffs must align with regime behavior.** texturalMirror payoff was fighting regime-mirror. Fixed R39. roleSwap had no payoff at all. (KB: 7c6069ceb48e)

## Meta-Patterns

- **Whack-a-mole threshold: 3 adjustments.** Same constant 3+ times = architectural problem. Convert to self-regulating mechanism. (KB: 24627ceb33a2)
- **12 dormant density bias modules at 1.0.** Thresholds too tight, conditions never fire. Future: widen after analyzing actual gradient values. (KB: fbcfd8b4e84b)
