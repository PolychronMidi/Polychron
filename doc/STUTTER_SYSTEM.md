# Stutter Variant System

19 octave-shifted note echo variants, selected per-beat by weighted random selection across 10 signal dimensions. Two-layer gating prevents note floods while preserving rhythmic structure.

## Variants

| Variant | Character | Weight | selfGate | maxPerSection |
|---------|-----------|--------|----------|---------------|
| ghostStutter | Barely-audible octave echoes (vel 15-30) | 1.2 | 1.0 | 400 |
| rhythmicGrid | Grid-snapped echoes at subdivision boundaries | 1.0 | 0.9 | 220 |
| rhythmicDotted | Dotted-note interval echoes (1.5x grid) | 1.0 | 0.9 | 240 |
| decayingBounce | Ball-bounce: decreasing interval + velocity | 0.8 | 0.8 | 200 |
| echoTrail | Growing delay, decaying velocity | 0.9 | 0.85 | 220 |
| reverseVelocity | Echoes start loud, decay toward source vel | 0.8 | 0.7 | 170 |
| harmonicShadow | Echo at farthest octave for register contrast | 0.9 | 0.9 | 250 |
| densityReactive | Inverse density: sparse=more echoes | 0.9 | 0.8 | 210 |
| octaveCascade | Ascending/descending octave waterfall | 0.7 | 0.6 | 140 |
| machineGun | 4-8 rapid-fire bursts with accelerando | 0.6 | 0.5 | 120 |
| stutterSwarm | Simultaneous cluster of octave-stacked notes | 0.6 | 0.5 | 120 |
| stutterTremolo | 15-30 ultra-rapid octave alternations | 0.5 | 0.45 | 140 |
| stereoScatter | Crossfade smudge + opposite-side widening | 0.8 | 0.8 | 200 |
| stereoWidthModulation | Balance-aware width sweep with per-channel jitter | 0.7 | 0.75 | 180 |
| flickerStutter | Echo density tracks conductor flicker signal | 0.9 | 0.8 | 210 |
| convergenceBurst | Ghost-quiet burst at layer convergence (3-10s windows) | 0.7 | 0.95 | 280 |
| tensionStutter | Echo count/velocity tracks conductor tension | 0.7 | 0.7 | 170 |
| directionalOscillation | Ascending then descending octave series | 0.7 | 0.6 | 150 |
| alienArpeggio | Xenolinguistic interval arpeggios (alien/suspended grammars) | 1.1 | 0.92 | 190 |

All variants stay rooted to source note or octave shifts only -- no voicing conflicts.

## Selection Algorithm

`stutterVariants.selectForBeat()` builds a weighted pool from 10 signal dimensions, then rolls weighted random:

1. **Base weight** per variant registration
2. **Regime weights** (`REGIME_WEIGHTS` map): coherent favors ghost/rhythmicGrid, exploring favors machineGun/tremolo. Blended over 8 beats during transitions.
3. **Phase density multiplier**: dense variants (machineGun, tremolo, swarm, convergenceBurst) suppressed 0.3-0.5x in coda/resolution, boosted 1.4x in climax
4. **Hocket weights**: when hocket mode active, favors rhythmic/subtle variants
5. **Articulation weights**: staccato passages favor rhythmicGrid/machineGun, legato favors ghost/echoTrail
6. **Journey distance weights**: far from home key favors dramatic variants, near favors subtle
7. **Phrase boundary weights**: last 12% of phrase boosts decayingBounce/machineGun for "fill" effect
8. **Coupling label weights**: system's semantic coupling labels (e.g., "rhythmic-shimmer") bias matching variants
9. **Entropy reversal weights**: sudden entropy drops boost dramatic variants
10. **Call-response weights**: other layer's last variant biases this layer's selection via 17-pair CALL_RESPONSE_MAP
11. **Self-balancing**: inverse-frequency boost for underrepresented variants (kicks in after 50+ scheduled)

Default (no variant) weight: 1.2. Variants fire ~70% of beats.

## Gating

Two gating layers, both must pass for a step to emit:

### Pattern Gate (stutterSteps.patternAllows)
75% chance per beat of generating an Euclidean rhythm pattern from `patterns.js` (euclid 30%, binary 20%, hex 15%, random 13%, onsets 10%, rotate/morph 12%). Pattern activation scales with composite intensity (0.45 sparse to 0.90 climactic). Steps indexed mod pattern length.

### Probabilistic Gate (stutterSteps.shouldEmit)
`sustain / spBeat` (floor 0.15) * variant selfGate. Short subdivision notes are exponentially less likely to emit.

## Stutter Echo Invocation

In `playNotesEmitPick`, the echo probability formula:
```
0.45 * sustainRatio^1.5 * feedbackBoost * emissionBoost * tensionScale * densityScale * rampScale * startSuppress * convMemBoost
```

Where:
- `feedbackBoost` = 1 + feedbackOscillator energy * 1.5
- `emissionBoost` = 1 + emission gap * 0.8
- `tensionScale` = conductor tension * 0.8 + 0.2 (range 0.5-1.5)
- `densityScale` = 1.5 - conductor density (range 0.6-1.8, inverse)
- `rampScale` = anticipatory ramp in last 20% of phrase from tension trajectory
- `startSuppress` = 0.4 in first 10% of phrase (clean entry)
- `convMemBoost` = convergence memory histogram boost at historically high-convergence beats

## Multi-Variant Beat

20% chance per stutter invocation of a second ghost stutter echo on a mirror (reflection) channel at 50% velocity. Creates layered stutter texture.

## Adding a New Variant

1. Create `src/fx/stutter/variants/yourVariant.js`
2. Self-register: `stutterVariants.register('yourVariant', fn, weight, { selfGate, maxPerSection })`
3. Add `require('./yourVariant')` to `variants/index.js`
4. Add entry to `REGIME_WEIGHTS` in `stutterVariants.js` for all 4 regimes
5. Optionally add to `DENSE_VARIANTS` set if it produces many notes per invocation
