# stage.js - Audio Processing and Performance Engine

## Project Overview

**stage.js** is the **audio processing powerhouse** of the Polychron system, responsible for all real-time audio effects, binaural beat generation, channel management, note generation, and MIDI event creation. This file transforms the musical concepts from other modules into precise MIDI events with sophisticated audio processing.

## File Purpose

This module provides **comprehensive audio processing** including:
- **Binaural beat generation** - Psychoacoustic frequency effects for alpha brainwave entrainment
- **Advanced stutter effects** - Volume, panning, and effects stuttering across multiple channels
- **Dynamic instrument management** - Real-time instrument switching and channel assignment
- **Cross-modulated note generation** - Complex note triggering based on rhythmic interactions
- **MIDI channel orchestration** - Sophisticated 16-channel routing and effects processing
- **Balance and effects automation** - Continuous parameter modulation and spatial processing

## Architecture Role

**stage.js** operates as the **audio processing and performance engine**:
- **Imports all dependencies** - Loads sheet.js, venue.js, backstage.js, rhythm.js, time.js, composers.js
- **Coordinates audio processing** - Called by play.js for all audio-related functions
- **Generates MIDI events** - Creates the actual note_on, note_off, and control events
- **Manages real-time effects** - Applies dynamic processing throughout composition generation

## Core Audio Infrastructure

### `setTuningAndInstruments()` - Initial Audio Setup
```javascript
setTuningAndInstruments = () => {
  p(c, ...['control_c','program_c'].flatMap(type => [
    ...source.map(ch => ({
      type, vals: [ch, ...(ch.toString().startsWith('lCH') ?
        (type === 'control_c' ? [10, 0] : [primaryInstrument]) :
        (type === 'control_c' ? [10, 127] : [primaryInstrument]))]
    })),
    { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c',
      vals: [cCH1, ...(type === 'control_c' ? [tuningPitchBend] : [primaryInstrument])]}
  ]));
  p(c, {type: 'control_c', vals: [drumCH, 7, 127]});
};
```

**Complete MIDI initialization**:
- **Dual processing loops** - Handles both control and program changes
- **Channel-specific configuration** - Left channels pan full left, right channels pan full right
- **Tuning system setup** - Applies 432Hz pitch bend to center channels
- **Drum channel setup** - Sets drum channel volume to maximum

## Binaural Beat System

### `setBinaural()` - Psychoacoustic Processing Engine
```javascript
setBinaural = () => {
  if (beatCount === beatsUntilBinauralShift || firstLoop < 1 ) {
    beatCount = 0; flipBin = !flipBin; allNotesOff(beatStart);
    beatsUntilBinauralShift = ri(numerator, numerator * 2 * bpmRatio3);
    binauralFreqOffset = rl(binauralFreqOffset, -1, 1, BINAURAL.min, BINAURAL.max);

    p(c, ...binauralL.map(ch => ({tick: beatStart, type: 'pitch_bend_c', vals: [ch,
      ch === lCH1 || ch === lCH3 || ch === lCH5 ?
        (flipBin ? binauralMinus : binauralPlus) :
        (flipBin ? binauralPlus : binauralMinus)]})));
  }
};
```

**Advanced binaural beat generation**:
- **Timing synchronization** - Binaural shifts occur at musically appropriate intervals
- **State flipping** - flipBin alternates binaural frequency assignments
- **Frequency evolution** - binauralFreqOffset gradually changes within 8-12Hz alpha range
- **Clean transitions** - All notes off before frequency changes to prevent artifacts

## Advanced Stutter Effects System

### `stutterFade()` - Dynamic Volume Stuttering
```javascript
stutterFade = (channels, numStutters=ri(10,70), duration=tpSec*rf(.2,1.5)) => {
  const CHsToStutter = ri(1,5);
  const channelsToStutter = new Set();
  const availableCHs = channels.filter(ch => !lastUsedCHs.has(ch));

  channelsArray.forEach(channelToStutter => {
    const maxVol = ri(90,120);
    const isFadeIn = rf() < 0.5;
    for (let i = m.floor(numStutters*(rf(1/3,2/3))); i < numStutters; i++) {
      const tick = beatStart + i * (duration/numStutters) * rf(.9,1.1);
      let volume = isFadeIn ?
        modClamp(m.floor(maxVol * (i / (numStutters - 1))), 25, maxVol) :
        modClamp(m.floor(100 * (1 - (i / (numStutters - 1)))), 25, 100);

      p(c, {tick: tick, type: 'control_c', vals: [channelToStutter, 7, m.round(volume/rf(1.5,5))]});
    }
  });
};
```

**Intelligent channel selection and stutter generation**:
- **Avoidance system** - Prevents stuttering same channels consecutively
- **Variable stutter count** - 10-70 individual volume changes per effect
- **Fade direction randomization** - 50/50 chance of fade-in vs fade-out
- **Timing jitter** - Small random variations prevent mechanical feel

### `stutterPan()` and `stutterFX()` - Spatial and Effects Modulation
Similar sophisticated algorithms for:
- **Spatial automation** - MIDI CC 10 (pan position) modulation
- **Effects parameter modulation** - Random effect selection with temporal patterns
- **Organic movement** - Random offsets and timing variations

## Balance and Effects Processing

### `setBalanceAndFX()` - Comprehensive Audio Processing
```javascript
setBalanceAndFX = () => {
  if (rf() < .5*bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop < 1 ) {
    balOffset = rl(balOffset, -4, 4, 0, 45);
    sideBias = rl(sideBias, -2, 2, -20, 20);
    lBal = m.max(0, m.min(54, balOffset + ri(3) + sideBias));
    rBal = m.min(127, m.max(74, 127 - balOffset - ri(3) + sideBias));
    cBal = m.min(96, (m.max(32, 64 + m.round(rv(balOffset / ri(2,3))) * (rf() < .5 ? -1 : 1) + sideBias)));
    // Extensive effects processing for all channels...
  }
}
```

**Dynamic balance and effects**:
- **Evolutionary parameters** - balOffset and sideBias evolve gradually over time
- **Mathematical balance relationships** - Complementary left/right calculations
- **Comprehensive effects processing** - Different ranges for each channel type and effect

## Note Generation System

### `crossModulateRhythms()` - Musical Decision Engine
```javascript
crossModulateRhythms = () => {
  crossModulation = 0;
  crossModulation += beatRhythm[beatIndex] > 0 ? rf(1.5,3) : m.max(rf(.625,1.25), (1 / numerator) * beatsOff + (1 / numerator) * beatsOn) +
  divRhythm[divIndex] > 0 ? rf(1,2) : m.max(rf(.5,1), (1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn ) +
  subdivRhythm[subdivIndex] > 0 ? rf(.5,1) : m.max(rf(.25,.5), (1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn) +
  (subdivsPerMinute > ri(400,600) ? rf(-.4,-.6) : rf(.1)) +
  (beatRhythm[beatIndex]<1?rf(.4,.5):0) + (divRhythm[divIndex]<1?rf(.3,.4):0) + (subdivRhythm[subdivIndex]<1?rf(.2,.3):0);
};
```

**Complex musical intelligence**:
- **Hierarchical rhythm awareness** - Considers beat, division, and subdivision patterns
- **Active pattern bonuses** - Higher crossModulation when rhythms are active
- **Density considerations** - Reduces crossModulation at very high subdivision rates
- **Pattern interaction analysis** - Multiple factors create sophisticated musical decisions

### `playNotes()` - Main Note Generation Engine
```javascript
playNotes = () => {
  setNoteParams();
  crossModulateRhythms();
  if((crossModulation+lastCrossMod)/rf(1.8,2.2) > rv(rf(1.8,2.8), [-.2,-.3], .05)) {
    composer.getNotes().forEach(({ note }) => {
      source.filter(sourceCH =>
        flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
      ).map(sourceCH => {
        p(c, {tick: sourceCH === cCH1 ? on + rv(tpSubdiv*rf(1/9)) : on + rv(tpSubdiv*rf(1/3)),
              type: 'on',
              vals: [sourceCH, note, sourceCH === cCH1 ? velocity*rf(.95,1.15) : binVel*rf(.95,1.03)]});
        // Complex stutter-shift processing...
      });
    });
  }
};
```

**Intelligent note triggering**:
- **Cross-modulation threshold** - Only generates notes when musical conditions are met
- **Binaural channel filtering** - Uses appropriate channels for current binaural state
- **Advanced stutter-shift processing** - Octave changes during stutter sequences

## Integration Functions

```javascript
require('./sheet'); require('./venue'); require('./backstage');
require('./rhythm'); require('./time'); require('./composers');
```

- **Dependency loading** - Imports all required modules in proper order
- **Global state sharing** - All modules share global variables
- **CSV event generation** - Direct MIDI event creation using global infrastructure

## CSVBuffer Layer Integration

**stage.js** audio functions use the global `c` buffer transparently:
- **All p(c, ...) calls** - Push events to whichever layer is currently active
- **setTuningAndInstruments()** - Initializes both c1 (primary) and c2 (poly) layers
- **Layer switching** - LM.activate() changes `c` reference, stage.js code unchanged
- **No layer conditionals** - Same code generates events for any active layer
- **Preserves minimalism** - Functions remain layer-agnostic while supporting multi-layer output

This transparent architecture allows setBinaural(), stutterFX(), playNotes(), etc. to work identically across all layers without modification.

## Performance Characteristics

- **Real-time processing** - All effects calculated on-demand during composition
- **Efficient algorithms** - Optimized for speed while maintaining audio quality
- **MIDI optimization** - All output directly compatible with MIDI specifications
- **Psychoacoustic accuracy** - Precise frequency calculations for binaural effects
- **Musical intelligence** - Sophisticated decision-making based on multiple musical factors
