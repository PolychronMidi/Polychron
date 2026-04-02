# Coordination Independence Manager (CIM)

`src/crossLayer/coordinationIndependenceManager.js` -- dynamic coordination/independence dial for cross-layer module pairs.

## Architecture

Lives in crossLayer subsystem. Reads conductor state via `conductorSignalBridge` (no boundary violation). Writes to peer crossLayer modules via `setCoordinationScale()`. Self-registers with `crossLayerRegistry` for lifecycle management.

## 11 Module-Pair Dials

Each dial ranges 0 (fully independent) to 1 (fully coordinated):

| Pair | Modules Controlled | Coordinated | Independent |
|------|-------------------|-------------|-------------|
| `restSync-rhythmComplement` | restSynchronizer, rhythmicComplementEngine | Shared rests, stable rhythm mode | Independent rest timing, rapid mode switching |
| `stutterContagion-stutterVariants` | stutterContagion | Sticky contagion (low decay) | Fast contagion decay |
| `spectralComp-velocityInterference` | spectralComplementarity | Strong spectral gap-filling | Each layer owns spectrum |
| `feedbackOsc-emergentDownbeat` | feedbackOscillator, emergentDownbeat | Energy flows freely, layers accent together | Energy stays local, more layer-swap |
| `stutterChannels-coordination` | StutterManager | More channels stutter together (up to 4) | Fewer channels (1-2) |
| `harmonic-pitchCorrection` | harmonicIntervalGuard, registerCollisionAvoider | Stronger nudging, looser collision (2-3 semitones) | Weaker nudging, stricter collision (5-7) |
| `rhythm-phaseLockGravity` | rhythmicPhaseLock, temporalGravity | Easier phase lock, stronger temporal pull | Harder to lock, weaker pull |
| `rhythm-grooveConvergence` | grooveTransfer, convergenceDetector | Tighter groove coupling, stricter convergence | Looser groove, looser detection |
| `dynamics-envelopeInterference` | crossLayerDynamicEnvelope, velocityInterference | Parallel arcs, stronger velocity reinforcement | Independent arcs, weaker reinforcement |
| `dynamics-articulationTexture` | articulationComplement, texturalMirror | Less forced contrast, weaker opposition | More contrast, stronger opposition |
| `structure-trustNegotiation` | adaptiveTrustScores, negotiationEngine | Less trust exploration nudge, lower convergence floor | More exploration nudge, higher floor |

## Target Computation

Per-pair target is a weighted blend:

- **Phase target** (25%): climax=0.8, intro=0.3, resolution=0.6
- **Regime target** (25%): coherent=0.75, exploring=0.25, evolving=0.5
- **Topology target** (15%): resonant=0.6, crystallized=0.3
- **Intent interaction target** (35%): reads `sectionIntentCurves.getLastIntent().interactionTarget`
- **Entropy bias**: high coherenceEntropy loosens coordination
- **Density bias**: very low density = more independence
- **Canon bias**: canon mode reduces stutter channel coordination by -0.15
- **Effectiveness bias**: self-assessed via 12-beat attribution windows

## Phase Gating

- **Stabilized**: full-speed dial adjustment
- **Converging**: half-speed dial adjustment
- **Oscillating**: freeze dials UNLESS oscillation mode is enabled (auto-activates during oscillating regime) OR health < 0.4 (emergency shuffle)

## Self-Interference Detection

If health drops within 3 beats of a dial change, CIM reverts that dial 40% toward neutral and penalizes its effectiveness score.

## Modes

- `setChaosMode(true)`: all dials to 0.1 (full independence)
- `setOscillationMode(true)`: periodic coordination breathing (oscillates 0.2-0.8 with jitter over ~14-beat period). Auto-activates when regime classifier reports 'oscillating'.

## Dial Application

Each target module exposes `setCoordinationScale(scale)` and interprets the dial in its domain-specific way. CIM is a dial-setter, not a puppet-master.
