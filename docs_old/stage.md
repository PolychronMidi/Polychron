# **stage.js** ([code](../src/stage.js)) ([doc](stage.md)) - Audio Processing and MIDI Event Generation

> **Source**: `src/stage.js`
> **Status**: Core Module - Audio Processing
> **Dependencies**: **sheet.js** ([code](../src/sheet.js)) ([doc](sheet.md)) ([code](../src/sheet.js ([code](../src/sheet.js)) ([doc](sheet.md)))) ([doc](sheet.md)), **writer.js** ([code](../src/writer.js)) ([doc](writer.md)) ([code](../src/writer.js ([code](../src/writer.js)) ([doc](writer.md)))) ([doc](writer.md)), **venue.js** ([code](../src/venue.js)) ([doc](venue.md)) ([code](../src/venue.js ([code](../src/venue.js)) ([doc](venue.md)))) ([doc](venue.md)), **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md)) ([code](../src/backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)))) ([doc](backstage.md)), **rhythm.js** ([code](../src/rhythm.js)) ([doc](rhythm.md)) ([code](../src/rhythm.js ([code](../src/rhythm.js)) ([doc](rhythm.md)))) ([doc](rhythm.md)), **time.js** ([code](../src/time.js)) ([doc](time.md)) ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)), **composers.js** ([code](../src/composers.js)) ([doc](composers.md)) ([code](../src/composers.js ([code](../src/composers.js)) ([doc](composers.md)))) ([doc](composers.md))

## Overview

**stage.js** ([code](../src/stage.js)) ([doc](stage.md))** ([code](../src/stage.js ([code](../src/stage.js)) ([doc](stage.md)))) ([doc](stage.md)) is the **audio engine** of Polychron, transforming abstract musical concepts into MIDI events. It generates binaural beats, applies sophisticated effects (stutter, pan, modulation), manages instruments across 16 MIDI channels, and orchestrates all real-time audio processing.

**Core Responsibilities:**
- **Instrument initialization** - Program changes and pitch bend for all channels
- **Binaural beat generation** - Psychoacoustic frequency shifts at beat boundaries
- **Stutter effects** - Volume, pan, and FX parameter modulation with decay
- **Dynamic balance** - Left/right channel panning and center channel automation
- **Note generation** - Intelligently triggered notes based on rhythmic context

## Architecture Role

**stage.js** ([code](../src/stage.js)) ([doc](stage.md))** ([code](../src/stage.js ([code](../src/stage.js)) ([doc](stage.md)))) ([doc](stage.md)) serves as the **audio coordinator**:
- **play.js** ([code](../src/play.js)) ([doc](play.md))** ([code](../src/play.js ([code](../src/play.js)) ([doc](play.md)))) ([doc](play.md)) - Calls playNotes(), setBinaural(), setBalanceAndFX() at each beat
- **composers.js** ([code](../src/composers.js)) ([doc](composers.md))** ([code](../src/composers.js ([code](../src/composers.js)) ([doc](composers.md)))) ([doc](composers.md)) - Provides note arrays via composer.getNotes()
- **rhythm.js** ([code](../src/rhythm.js)) ([doc](rhythm.md))** ([code](../src/rhythm.js ([code](../src/rhythm.js)) ([doc](rhythm.md)))) ([doc](rhythm.md)) - Provides rhythm patterns via drummer()
- **time.js** ([code](../src/time.js)) ([doc](time.md))** ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)) - Uses timing variables (beatStart, tpBeat, numerator, etc.)
- **writer.js** ([code](../src/writer.js)) ([doc](writer.md))** ([code](../src/writer.js ([code](../src/writer.js)) ([doc](writer.md)))) ([doc](writer.md)) - Pushes events to active buffer c via p(c, event)
- **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md))** ([code](../src/backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)))) ([doc](backstage.md)) - Uses utilities (ri, rf, rv, clamp, modClamp)

---

## Channel Infrastructure

### MIDI Channel Layout
```
Channels 0-5:   Source channels (primary notes)
Channels 6-11:  Reflection channels (effects/echo)
Channels 12-14: Bass channels
Channel 15:     Drum channel
```

### Channel Organization
- **Source** (cCH1, cCH2, lCH1, lCH2, rCH1, rCH2) - Main melodic content
- **Reflection** (cCH2*, lCH2*, rCH2*) - Echo/effects processing
- **Bass** (cCH3, lCH3, rCH3) - Low-frequency content (two bass instruments)
- **Drums** (drumCH) - Percussion on dedicated channel

### Binaural Channel Splitting
- **flipBinT** - Channels with high binaural frequency when flipBin=true
- **flipBinF** - Channels with low binaural frequency when flipBin=true
- **flipBinT2/flipBinF2** - Volume routing during binaural transitions
- Alternates between channel sets at beat boundaries (controlled by beatsUntilBinauralShift)

---

## Instrument Setup: `setTuningAndInstruments()`

Initializes all 16 MIDI channels with program changes, pitch bend, and panning:

<!-- BEGIN: snippet:Stage_setTuningAndInstruments -->

```javascript
  /**
   * Sets program, pitch bend, and volume for all instrument channels
   * @returns {void}
   */
  setTuningAndInstruments() {
    p(c,...['control_c','program_c'].flatMap(type=>[ ...source.map(ch=>({
    type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [primaryInstrument]) : (type==='control_c' ? [10,127] : [primaryInstrument]))]})),
    { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH1,...(type==='control_c' ? [tuningPitchBend] : [primaryInstrument])]},
    { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH2,...(type==='control_c' ? [tuningPitchBend] : [secondaryInstrument])]}]));

    p(c,...['control_c','program_c'].flatMap(type=>[ ...bass.map(ch=>({
      type,vals:[ch,...(ch.toString().startsWith('lCH') ? (type==='control_c' ? [10,0] : [bassInstrument]) : (type==='control_c' ? [10,127] : [bassInstrument2]))]})),
      { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH3,...(type==='control_c' ? [tuningPitchBend] : [bassInstrument])]}]));
    p(c,{type:'control_c', vals:[drumCH, 7, 127]});
  }
```

<!-- END: snippet:Stage_setTuningAndInstruments -->

**Setup Process:**
1. Source channels: Panning (left channels fully left, right fully right), program changes
2. Center channels: Pitch bend for 432Hz tuning
3. Reflection channels: Program changes to secondary instruments
4. Bass channels: Dual instrument setup with binaural routing
5. Drum channel: Volume to maximum (CC 7)

---

## Note Generation: `playNotes()`

<!-- BEGIN: snippet:Stage_playNotes -->

```javascript
  /**
   * Generates MIDI note events for source channels (subdivision-based timing)
   * @returns {void}
   */
  playNotes() {
    this.setNoteParams();
    this.crossModulateRhythms();
    const noteObjects = composer ? composer.getNotes() : [];
    const motifNotes = activeMotif ? applyMotifToNotes(noteObjects, activeMotif) : noteObjects;
    if((this.crossModulation+this.lastCrossMod)/rf(1.8,2.2)>rv(rf(1.8,2.8),[-.2,-.3],.05)){
  if (composer) motifNotes.forEach(({ note })=>{
    // Play source channels
    source.filter(sourceCH=>
      flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
    ).map(sourceCH=>{

      p(c,{tick:sourceCH===cCH1 ? this.on + rv(tpSubdiv*rf(1/9),[-.1,.1],.3) : this.on + rv(tpSubdiv*rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,note,sourceCH===cCH1 ? velocity*rf(.95,1.15) : this.binVel*rf(.95,1.03)]});
      p(c,{tick:this.on+this.sustain*(sourceCH===cCH1 ? 1 : rv(rf(.92,1.03))),vals:[sourceCH,note]});

    });

    // Play reflection channels
    reflection.filter(reflectionCH=>
      flipBin ? flipBinT.includes(reflectionCH) : flipBinF.includes(reflectionCH)
    ).map(reflectionCH=>{

      p(c,{tick:reflectionCH===cCH2 ? this.on+rv(tpSubdiv*rf(.2),[-.01,.1],.5) : this.on+rv(tpSubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,note,reflectionCH===cCH2 ? velocity*rf(.5,.8) : this.binVel*rf(.55,.9)]});
      p(c,{tick:this.on+this.sustain*(reflectionCH===cCH2 ? rf(.7,1.2) : rv(rf(.65,1.3))),vals:[reflectionCH,note]});

    });

    // Play bass channels (with probability based on BPM)
    if (rf()<clamp(.35*bpmRatio3,.2,.7)) {
      bass.filter(bassCH=>
        flipBin ? flipBinT.includes(bassCH) : flipBinF.includes(bassCH)
      ).map(bassCH=>{
        const bassNote=modClamp(note,12,35);

        p(c,{tick:bassCH===cCH3 ? this.on+rv(tpSubdiv*rf(.1),[-.01,.1],.5) : this.on+rv(tpSubdiv*rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===cCH3 ? velocity*rf(1.15,1.35) : this.binVel*rf(1.85,2.45)]});
        p(c,{tick:this.on+this.sustain*(bassCH===cCH3 ? rf(1.1,3) : rv(rf(.8,3.5))),vals:[bassCH,bassNote]});

      });
    }
  }); subdivsOff=0; subdivsOn++; } else { subdivsOff++; subdivsOn=0; }
  }
```

<!-- END: snippet:Stage_playNotes -->

---

## Binaural Beat System: `setBinaural()`

Generates psychoacoustic effects by shifting frequency offsets on left/right channels at musically appropriate intervals:

```javascript
setBinaural = () => {
  if (beatCount === beatsUntilBinauralShift || firstLoop < 1) {
    beatCount = 0;
    flipBin = !flipBin;  // Toggle binaural state
    allNotesOff(beatStart);  // Clear previous notes

    // Randomize interval until next shift (1-2 × numerator beats)
    beatsUntilBinauralShift = ri(numerator, numerator * 2 * bpmRatio3);

    // Evolve binaural frequency offset within alpha range (8-12 Hz)
    binauralFreqOffset = rl(binauralFreqOffset, -1, 1, BINAURAL.min, BINAURAL.max);

    // Apply pitch bends to all binaural channels
    p(c, ...binauralL.map(ch => ({
      tick: beatStart,
      type: 'pitch_bend_c',
      vals: [ch, ch === lCH1 || ch === lCH3 || ch === lCH5 ?
        (flipBin ? binauralMinus : binauralPlus) :
        (flipBin ? binauralPlus : binauralMinus)]
    })));

    // Volume crossfade between channel sets
    const startTick = beatStart - tpSec/4;
    const endTick = beatStart + tpSec/4;
    const steps = 10;
    const tickIncrement = (endTick - startTick) / steps;

    for (let i = steps/2 - 1; i <= steps; i++) {
      const tick = startTick + (tickIncrement * i);
      const volumeF2 = flipBin ? m.floor(100 * (1 - (i / steps))) : m.floor(100 * (i / steps));
      const volumeT2 = flipBin ? m.floor(100 * (i / steps)) : m.floor(100 * (1 - (i / steps)));

      flipBinF2.forEach(ch => {
        p(c, {tick: tick, type: 'control_c', vals: [ch, 7, m.round(volumeF2 * rf(.9, 1.2))]});
      });
      flipBinT2.forEach(ch => {
        p(c, {tick: tick, type: 'control_c', vals: [ch, 7, m.round(volumeT2 * rf(.9, 1.2))]});
      });
    }
  }
};
```

**Psychoacoustic Process:**
1. **Shift timing** - Occurs at beat boundaries determined by beatsUntilBinauralShift
2. **Toggle channels** - Switches which channels carry high/low frequencies
3. **Frequency evolution** - Gradually changes binauralFreqOffset within alpha range (8-12 Hz)
4. **Clean transition** - Cross-fade volume to prevent clicks during shift

---

## Stutter Effects System

### `stutterFade()` - Volume Stutter Effect

Applies rapid volume modulation (10-70 stutters) to selected channels:

```javascript
stutterFade = (channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) => {
  const CHsToStutter = ri(1, 5);
  const channelsToStutter = new Set();
  const availableCHs = channels.filter(ch => !lastUsedCHs.has(ch));

  // Avoid stuttering same channels consecutively
  while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
    const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
    channelsToStutter.add(ch);
    availableCHs.splice(availableCHs.indexOf(ch), 1);
  }
  lastUsedCHs = new Set(channelsToStutter);

  const channelsArray = Array.from(channelsToStutter);
  channelsArray.forEach(channelToStutter => {
    const maxVol = ri(90, 120);
    const isFadeIn = rf() < 0.5;

    // Generate 10-70 individual volume changes
    for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
      const tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
      const volume = isFadeIn ?
        modClamp(m.floor(maxVol * (i / (numStutters - 1))), 25, maxVol) :
        modClamp(m.floor(100 * (1 - (i / (numStutters - 1)))), 25, 100);

      p(c, {tick: tick, type: 'control_c', vals: [channelToStutter, 7, m.round(volume / rf(1.5, 5))]});
      p(c, {tick: tick + duration * rf(.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume]});
    }
    p(c, {tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol]});
  });
};
```

### `stutterPan()` and `stutterFX()`

Similar algorithms for pan position (CC 10) and effect parameter modulation with variable stutter counts and decay factors.

---

## Cross-Modulation: `crossModulateRhythms()`

Calculates a single **crossModulation** value that determines note trigger probability based on rhythmic context:

```javascript
crossModulation = 0;

// Add bonuses when rhythms are active
crossModulation += beatRhythm[beatIndex] > 0 ? rf(1.5, 3) : m.max(rf(.625, 1.25), pattern) +
                  divRhythm[divIndex] > 0 ? rf(1, 2) : m.max(rf(.5, 1), pattern) +
                  subdivRhythm[subdivIndex] > 0 ? rf(.5, 1) : m.max(rf(.25, .5), pattern);

// Penalize very high subdivision rates
crossModulation += (subdivsPerMinute > ri(400, 600) ? rf(-.4, -.6) : rf(.1));

// Bonuses for inactivity (fills silence)
crossModulation += (beatRhythm[beatIndex] < 1 ? rf(.4, .5) : 0);
crossModulation += (divRhythm[divIndex] < 1 ? rf(.3, .4) : 0);
crossModulation += (subdivRhythm[subdivIndex] < 1 ? rf(.2, .3) : 0);
```

**Musical Logic:**
- **Rewards active beats** - Higher probability when beat/div/subdiv rhythms are active
- **Fills silence** - Adds notes when rhythms are inactive to maintain density
- **Limits density** - Penalizes when subdivision rate exceeds 400-600 subs/minute
- **Temporal smoothing** - Uses lastCrossMod to smooth probability over time

---

## Note Generation: `playNotes()`

Generates note on/off events based on crossModulation threshold and binaural channel selection:

```javascript
playNotes = () => {
  setNoteParams();  // Calculate on-tick, sustain, velocity
  crossModulateRhythms();  // Calculate crossModulation value

  // Only generate notes if cross-modulation exceeds threshold
  if ((crossModulation + lastCrossMod) / rf(1.8, 2.2) > rv(rf(1.8, 2.8), [-.2, -.3], .05)) {
    if (composer) {
      composer.getNotes().forEach(({ note }) => {
        // Filter to appropriate channels based on current binaural state
        source.filter(sourceCH =>
          flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
        ).map(sourceCH => {
          const noteOnTick = sourceCH === cCH1 ?
            on + rv(tpSubdiv * rf(1/9), [-.1, .1], .3) :
            on + rv(tpSubdiv * rf(1/3), [-.1, .1], .3);

          const noteVelocity = sourceCH === cCH1 ?
            velocity * rf(.95, 1.15) :
            binVel * rf(.95, 1.03);

          p(c, {tick: noteOnTick, type: 'on', vals: [sourceCH, note, noteVelocity]});
          p(c, {tick: on + sustain * (sourceCH === cCH1 ? 1 : rv(rf(.92, 1.03))), vals: [sourceCH, note]});

          // Complex stutter-shift processing...
        });
      });
    }
  }
};
```

---

## Balance and Effects: `setBalanceAndFX()`

Manages left/right channel balance, center channel modulation, and 20+ MIDI control parameters for effects processing:

```javascript
setBalanceAndFX = () => {
  // Trigger on probability or at binaural shift points
  if (rf() < .5 * bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop < 1) {
    // Evolve balance offset gradually
    balOffset = rl(balOffset, -4, 4, 0, 45);
    sideBias = rl(sideBias, -2, 2, -20, 20);

    // Calculate channel balances with mathematical relationships
    lBal = m.max(0, m.min(54, balOffset + ri(3) + sideBias));
    rBal = m.min(127, m.max(74, 127 - balOffset - ri(3) + sideBias));
    cBal = m.min(96, (m.max(32, 64 + m.round(rv(balOffset / ri(2, 3))) * (rf() < .5 ? -1 : 1) + sideBias)));

    refVar = ri(1, 10);
    cBal2 = rf() < .5 ? cBal + m.round(refVar * .5) : cBal + m.round(refVar * -.5);
    bassVar = refVar * rf(-2, 2);
    cBal3 = rf() < .5 ? cBal2 + m.round(bassVar * .5) : cBal2 + m.round(bassVar * -.5);

    // Generate 50+ pan and effect control changes across all channels
    p(c, ...['control_c'].flatMap(() => {
      _ = { tick: beatStart - 1, type: 'control_c' };
      return [
        ...source2.map(ch => ({..., vals: [ch, 10, panValue]})),
        ...reflection.map(ch => ({..., vals: [ch, 10, reflectionPan]})),
        ...bass.map(ch => ({..., vals: [ch, 10, bassPan]})),
        // 50+ effect parameter controls...
      ];
    }));
  }
};
```

---

## Instrument Randomization: `setOtherInstruments()`

Randomly updates instruments on reflection and bass binaural channels:

```javascript
setOtherInstruments = () => {
  if (rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || firstLoop < 1) {
    p(c, ...['control_c'].flatMap(() => {
      _ = { tick: beatStart, type: 'program_c' };
      return [
        ...reflectionBinaural.map(ch => ({..., vals: [ch, ra(otherInstruments)]})),
        ...bassBinaural.map(ch => ({..., vals: [ch, ra(otherBassInstruments)]})),
        { ..., vals: [drumCH, ra(drumSets)] }
      ];
    }));
  }
};
```

---

## Helper Functions

### `setNoteParams()`
Calculates on-tick, sustain duration, and velocity for each note based on timing/subdivision context.

### `allNotesOff(tick)`
Sends note-off (velocity 0) events to all active channels at specified tick for clean transitions.

---

## Layer-Agnostic Architecture

All audio functions use the global `c` buffer transparently:
- **p(c, ...)** automatically routes to active layer (c1 or c2)
- **LM.activate()** changes the `c` reference
- **No conditional logic** needed - same code works for all layers
- **Preserves minimalism** while enabling multi-layer output
