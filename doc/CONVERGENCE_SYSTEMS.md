# Convergence Systems

Cross-layer onset convergence detection, harmonic burst triggers, velocity surges, memory histograms, cascade chains, and emergent downbeat tempo multiplication.

## Convergence Detector

`src/crossLayer/rhythm/convergenceDetector.js` -- detects when both layers' note onsets align within a tolerance window.

- Posts onsets to L0 `onset` channel
- Detects temporal synchrony via `L0.findClosest()` within tolerance
- `wasRecent(absoluteSeconds, layer, windowMs)`: boolean check for recent convergence
- CIM coordination scale modulates tolerance (coordinated = stricter, independent = looser)
- Trust-scored via `adaptiveTrustScores`

## Convergence Harmonic Trigger

`src/crossLayer/harmony/convergenceHarmonicTrigger.js` -- when convergence fires, considers triggering a harmonic burst (chord voicings built on converged pitch class).

- Gated by convergence rarity
- Trust-scored independently from convergenceDetector
- Octave spread and voice count scale with rarity

## Convergence Velocity Surge

`src/crossLayer/dynamics/convergenceVelocitySurge.js` -- brief velocity boost (1.15-1.35x) after convergence events.

- Duration: 2-4 notes after convergence
- Cooldown: 1.5 seconds between surges
- **Harmonic gravity**: surge magnitude scales with `harmonicJourney.getStop(sectionIndex).distance` (+4%/unit)
- **Convergence cascade**: when surge exceeds 1.2x, triggers `emergentDownbeat.applyTempoMultiplier()` for multi-system impact

Wired into `playNotesEmitPick` source channel velocity computation (primary channel only).

## Convergence Memory

`src/crossLayer/rhythm/convergenceMemory.js` -- the system learns its own convergence rhythm.

- 16-bin histogram of convergence beat positions (beatIndex % 16)
- Records convergence events per-beat via `crossLayerBeatRecord`
- After 20+ samples: bins with >1.5x average count boost stutter probability at those positions
- Boost: `clamp(1 + (binScore - 1.5) * 0.3, 1.0, 1.6)`
- Creates emergent learned accent pattern that strengthens over time

## Emergent Downbeat

`src/crossLayer/rhythm/emergentDownbeat.js` -- neither layer has a "true" downbeat since they're polyrhythmic. But convergence + cadence + velocity + phaseLock implicitly create perceived downbeats.

### Detection

Score from 4 signals (convergence 0.4, cadenceAlign 0.3, velReinforce 0.2, phaseLock 0.15) plus regime transition bonus (0.25). Requires 2+ simultaneous signals. Threshold modulated by convergenceTarget.

### Effects

1. **Velocity accent**: 20% boost scaled by strength
2. **Bass reinforcement**: note 2 octaves below on cCH3 (strength >= 0.5)
3. **Stereo widening**: pan CC on L/R channels (strength >= 0.4)
4. **Tempo multiplier** (strength >= 0.45, 25% probability):
   - Picks 2x, 3x, or 4x randomly
   - Emits rapid sub-beat accent notes at `spBeat / multiplier` intervals
   - 50% chance of swapping to OTHER layer (CIM coordination scale modulates swap probability)
   - Velocity decays per sub-accent: 85% -> 70% -> 55%
   - Alternates source pitch and octave shift for variety
   - Creates double/triple/quad time PERCEPTION without changing actual BPM

### Convergence Cascade Chain

When all systems align:
```
convergenceDetector fires
  -> convergenceVelocitySurge boosts next 2-4 notes (1.15-1.35x)
  -> surge > 1.2x triggers emergentDownbeat.applyTempoMultiplier
  -> tempo multiplier fires on same or other layer
  -> multi-system "impact moment" at convergence point
```

These cascades create structural landmarks in the composition that emerge from cross-layer agreement, not from predetermined structure.
