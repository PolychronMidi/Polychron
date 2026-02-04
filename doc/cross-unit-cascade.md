# Cross-Unit Note Cascade

## Overview

The `NoteCascade.playNotesAcrossUnits()` function provides a universal way to schedule notes cascading across multiple timing units (beat → div → subdiv → subsubdiv) with source/reflection/bass channel treatment and optional stutter effects.

This feature extracts and universalizes the unique patterns found in `playSubdivNotes` and `playSubsubdivNotes` from [stage.js](../src/stage.js):

- **Source/Reflection/Bass Channel Logic**: Notes are played through three channel groups with flipBin state gating
- **Timing Variance**: Unit-specific timing references (tpBeat, tpDiv, tpSubdiv, tpSubsubdiv) control onset timing
- **Stutter Gate**: 50/50 random gate (rf() > 0.5) determines whether to apply stutter effects per note

## API

### `NoteCascade.playNotesAcrossUnits(opts)`

**Parameters** (all optional):

- `unit` (string): Unit level - 'beat', 'div', 'subdiv', or 'subsubdiv' (default: 'subdiv')
- `on` (number): Base tick for note onset (default: 0)
- `sustain` (number): Note sustain duration (default: 100)
- `velocity` (number): Base velocity (default: 64)
- `binVel` (number): Binaural velocity (default: 32)
- `enableStutter` (boolean): Whether to schedule stutter effects with 50/50 gate (default: false)

**Returns**: Number of events scheduled

## Usage Example

```javascript
// Simple usage - schedule notes at subdiv level without stutter
const scheduled = NoteCascade.playNotesAcrossUnits({
  unit: 'subdiv',
  on: subdivStart,
  sustain: 120,
  velocity: 80,
  binVel: 40,
  enableStutter: false
});

// Advanced usage - cross-unit cascade with stutter enabled
const units = ['beat', 'div', 'subdiv', 'subsubdiv'];
units.forEach(unit => {
  NoteCascade.playNotesAcrossUnits({
    unit,
    on: 0,  // or appropriate timing variable
    sustain: 100,
    velocity: 80,
    binVel: 40,
    enableStutter: true  // 50/50 gate: rf() > 0.5
  });
});
```

## Integration with Existing Code

The function integrates seamlessly with the existing polychron architecture:

1. **Motif System**: Automatically pulls picks from `LM.layers[LM.activeLayer].beatMotifs`
2. **Channel Arrays**: Uses global channel arrays (`source`, `reflection`, `bass`)
3. **FlipBin State**: Respects `flipBin`, `flipBinT`, `flipBinF` for channel filtering
4. **Event Buffer**: Writes events to global buffer `c` via `p()` function
5. **Stutter Manager**: Integrates with `Stutter.scheduleStutterForUnit()` when enabled

## Channel Treatment Pattern

For each motif pick, the function processes three channel groups:

### Source Channels
- Filtered by flipBin state
- Primary channel (cCH1) gets special timing/velocity treatment
- Timing variance: `tpUnit * rf(1/9)` for primary, `tpUnit * rf(1/3)` for others
- Velocity: `velocity * rf(.95, 1.15)` for primary, `binVel * rf(.95, 1.03)` for others

### Reflection Channels
- Filtered by flipBin state (opposite reflection)
- Primary channel (cCH2) gets special treatment
- Timing variance: `tpUnit * rf(.2)` for primary, `tpUnit * rf(1/3)` for others
- Velocity: `velocity * rf(.5, .8)` for primary, `binVel * rf(.55, .9)` for others

### Bass Channels (BPM-based probability)
- Only triggered if `rf() < clamp(.35 * bpmRatio3, .2, .7)`
- Uses `modClamp(note, 12, 35)` for bass note calculation
- Primary channel (cCH3) gets special treatment
- Timing variance: `tpUnit * rf(.1)` for primary, `tpUnit * rf(1/3)` for others
- Velocity: `velocity * rf(1.15, 1.3)` for primary, `binVel * rf(1.85, 2)` for others

## Stutter Integration

When `enableStutter: true`:

1. For each motif pick, determines `shouldStutter = enableStutter && rf() > 0.5`
2. Creates shared stutter state: `{ stutters: Map, shifts: Map, global: {} }`
3. If shouldStutter, calls `Stutter.scheduleStutterForUnit()` for each channel with:
   - `profile`: 'source', 'reflection', or 'bass'
   - `channel`: specific channel number
   - `note`: note value (or bassNote for bass)
   - `on`, `sustain`, `velocity`, `binVel`: from parameters
   - `isPrimary`: whether channel is cCH1/cCH2/cCH3
   - `shared`: shared state for coordinated stutter across channels

## Fallback Behavior

The function includes robust fallback logic for missing globals:

- Uses safe defaults if timing variables undefined (tpBeat, tpDiv, etc.)
- Falls back to empty arrays if channel arrays undefined
- Provides basic implementations for missing utility functions (rf, rv, clamp, modClamp)
- Creates local event buffer if global `c` undefined
- Gracefully handles missing LM, MotifSpreader, or Stutter

## Testing

See [test/noteCascade.crossUnit.test.js](../test/noteCascade.crossUnit.test.js) for comprehensive test coverage:

- ✓ Schedules notes across units with source/reflection/bass channels
- ✓ Gates stutter with 50/50 random when enableStutter=true
- ✓ Works across different unit levels
- ✓ Respects flipBin state for channel filtering

## Implementation Details

Location: [src/noteCascade.js](../src/noteCascade.js)

The function is exported as part of the `NoteCascade` naked global alongside `scheduleNoteCascade`:

```javascript
NoteCascade = { scheduleNoteCascade, playNotesAcrossUnits };
```

Load order (via src/index.js):
1. stutterConfig (config/metrics/helper registration)
2. noteCascade (scheduling helpers)
3. StutterManager (manager class)
4. stutterNotes (original helper implementation)

## Future Enhancements

Potential extensions to the cross-unit cascade system:

1. **Direct merging logic**: Schedule notes across multiple units simultaneously with automatic event merging
2. **Profile-based channel selection**: Allow custom channel group definitions per profile
3. **Velocity curves**: Add envelope/ADSR-style velocity shaping across unit cascade
4. **Probabilistic unit selection**: Weight different units with probability distributions
5. **Cross-layer cascade**: Extend to cascade across different LayerManager layers
