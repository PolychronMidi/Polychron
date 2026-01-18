<!-- 
### TODO - log of items planned / in progress

- [mm-dd-hh:mm] Example (newest) TODO Title - One sentence summary.
[mm-dd-hh:mm] Timestamped note of latest development or roadblock for this TODO
[mm-dd-hh:mm] Older timestamped notes for this TODO

- mm-dd-hh:mm Example Todo #2 (older) , etc...
-->

# playNotes.ts - MIDI Note Rendering & Stutter Effects

> **Status**: Rendering Engine  
> **Dependencies**: Global timing state, composer notes, motif application, MIDI writer


## Overview

`playNotes.ts` contains the `PlayNotes` class that handles MIDI note generation with advanced stutter/shift/octave-modulation effects. It calculates timing and velocity parameters based on hierarchical polyrhythm state and outputs notes to both subdivision and sub-subdivision timescales.

**Core Responsibilities:**
- Calculate cross-modulation values across beat/division/subdivision rhythms
- Generate MIDI note events at subdivision and sub-subdivision timescales
- Apply motif transformations to composer-generated notes
- Implement channel-based routing (source/reflection/bass channels)
- Apply probabilistic stutter effects with octave shifts and velocity dynamics
- Manage velocity ramping, sustain timing, and time-offset randomization

---

## Architecture

PlayNotes operates at two timing levels:

1. **playNotes()** – Subdivision-level note generation for primary melodic/harmonic voice
2. **playNotes2()** – Sub-subdivision-level note generation with complex stutter/shift effects

Both methods:
- Calculate note onset time, sustain, and binaural velocity
- Retrieve notes from current composer
- Apply active motif transformations
- Route notes to source/reflection/bass channels with probability
- Apply cross-rhythm modulation to determine if notes should play
- Emit MIDI note-on/off events via global writer `p()`

---

## API

### `class PlayNotes`

Note generation engine with cross-modulation state tracking.

<!-- BEGIN: snippet:PlayNotes -->

```typescript
export class PlayNotes {
  // Cross-modulation state
  public lastCrossMod: number = 0;
  public crossModulation: number = 0;

  // Note generation state
  public on: number = 0;
  public shortSustain: number = 0;
  public longSustain: number = 0;
  public sustain: number = 0;
  public binVel: number = 0;
  public useShort: boolean = false;

  constructor() {}

  /**
   * Calculates cross-modulation value based on rhythm state across all levels
   * @returns {void}
   */
  crossModulateRhythms(): void {
    this.lastCrossMod = this.crossModulation;
    this.crossModulation = 0;
    this.crossModulation += globalThis.beatRhythm[globalThis.beatIndex] > 0 ? globalThis.rf(1.5, 3) : globalThis.m.max(globalThis.rf(.625, 1.25), (1 / globalThis.numerator) * globalThis.beatsOff + (1 / globalThis.numerator) * globalThis.beatsOn) +
      globalThis.divRhythm[globalThis.divIndex] > 0 ? globalThis.rf(1, 2) : globalThis.m.max(globalThis.rf(.5, 1), (1 / globalThis.divsPerBeat) * globalThis.divsOff + (1 / globalThis.divsPerBeat) * globalThis.divsOn) +
      globalThis.subdivRhythm[globalThis.subdivIndex] > 0 ? globalThis.rf(.5, 1) : globalThis.m.max(globalThis.rf(.25, .5), (1 / globalThis.subdivsPerDiv) * globalThis.subdivsOff + (1 / globalThis.subdivsPerDiv) * globalThis.subdivsOn) +
      (globalThis.subdivsOn < globalThis.ri(7, 15) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) + (globalThis.subdivsOff > globalThis.ri() ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) +
      (globalThis.divsOn < globalThis.ri(9, 15) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) + (globalThis.divsOff > globalThis.ri(3, 7) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) +
      (globalThis.beatsOn < globalThis.ri(3) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) + (globalThis.beatsOff > globalThis.ri(3) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) +
      (globalThis.subdivsOn > globalThis.ri(7, 15) ? globalThis.rf(-.3, -.5) : globalThis.rf(.1)) + (globalThis.subdivsOff < globalThis.ri() ? globalThis.rf(-.3, -.5) : globalThis.rf(.1)) +
      (globalThis.divsOn > globalThis.ri(9, 15) ? globalThis.rf(-.2, -.4) : globalThis.rf(.1)) + (globalThis.divsOff < globalThis.ri(3, 7) ? globalThis.rf(-.2, -.4) : globalThis.rf(.1)) +
      (globalThis.beatsOn > globalThis.ri(3) ? globalThis.rf(-.2, -.3) : globalThis.rf(.1)) + (globalThis.beatsOff < globalThis.ri(3) ? globalThis.rf(-.1, -.3) : globalThis.rf(.1)) +
      (globalThis.subdivsPerMinute > globalThis.ri(400, 600) ? globalThis.rf(-.4, -.6) : globalThis.rf(.1)) + (globalThis.subdivsOn * globalThis.rf(-.05, -.15)) + (globalThis.beatRhythm[globalThis.beatIndex] < 1 ? globalThis.rf(.4, .5) : 0) + (globalThis.divRhythm[globalThis.divIndex] < 1 ? globalThis.rf(.3, .4) : 0) + (globalThis.subdivRhythm[globalThis.subdivIndex] < 1 ? globalThis.rf(.2, .3) : 0);
  }

  /**
   * Calculates note timing and sustain parameters for subdivision-based notes
   * @returns {void}
   */
  setNoteParams(): void {
    const subdivsPerMinute = globalThis.subdivsPerBeat * globalThis.midiBPM;
    this.on = globalThis.subdivStart + (globalThis.tpSubdiv * globalThis.rv(globalThis.rf(.2), [-.1, .07], .3));
    this.shortSustain = globalThis.rv(globalThis.rf(globalThis.m.max(globalThis.tpDiv * .5, globalThis.tpDiv / globalThis.subdivsPerDiv), (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = globalThis.rv(globalThis.rf(globalThis.tpDiv * .8, (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > globalThis.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * globalThis.rv(globalThis.rf(.8, 1.3));
    this.binVel = globalThis.rv(globalThis.velocity * globalThis.rf(.42, .57));
  }

  /**
   * Generates MIDI note events for source channels (subdivision-based timing)
   * @returns {void}
   */
  playNotes(): void {
    this.setNoteParams();
    this.crossModulateRhythms();
    const noteObjects = globalThis.composer ? globalThis.composer.getNotes() : [];
    const motifNotes = globalThis.activeMotif ? globalThis.activeMotif.applyToNotes(noteObjects) : noteObjects;
    if ((this.crossModulation + this.lastCrossMod) / globalThis.rf(1.4, 2.6) > globalThis.rv(globalThis.rf(1.8, 2.8), [-.2, -.3], .05)) {
      motifNotes.forEach(({ note }: { note: number }) => {
        // Play source channels
        globalThis.source.filter((sourceCH: number) =>
          globalThis.flipBin ? globalThis.flipBinT.includes(sourceCH) : globalThis.flipBinF.includes(sourceCH)
        ).map((sourceCH: number) => {
          globalThis.p(globalThis.c, { tick: sourceCH === globalThis.cCH1 ? this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 9), [-.1, .1], .3) : this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 3), [-.1, .1], .3), type: 'on', vals: [sourceCH, note, sourceCH === globalThis.cCH1 ? globalThis.velocity * globalThis.rf(.95, 1.15) : this.binVel * globalThis.rf(.95, 1.03)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (sourceCH === globalThis.cCH1 ? 1 : globalThis.rv(globalThis.rf(.92, 1.03))), vals: [sourceCH, note] });
        });

        // Play reflection channels
        globalThis.reflection.filter((reflectionCH: number) =>
          globalThis.flipBin ? globalThis.flipBinT.includes(reflectionCH) : globalThis.flipBinF.includes(reflectionCH)
        ).map((reflectionCH: number) => {
          globalThis.p(globalThis.c, { tick: reflectionCH === globalThis.cCH2 ? this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(.2), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === globalThis.cCH2 ? globalThis.velocity * globalThis.rf(.5, .8) : this.binVel * globalThis.rf(.55, .9)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (reflectionCH === globalThis.cCH2 ? globalThis.rf(.7, 1.2) : globalThis.rv(globalThis.rf(.65, 1.3))), vals: [reflectionCH, note] });
        });

        // Play bass channels (with probability based on BPM)
        if (globalThis.rf() < globalThis.clamp(.35 * globalThis.bpmRatio3, .2, .7)) {
          globalThis.bass.filter((bassCH: number) =>
            globalThis.flipBin ? globalThis.flipBinT.includes(bassCH) : globalThis.flipBinF.includes(bassCH)
          ).map((bassCH: number) => {
            const bassNote = globalThis.modClamp(note, 12, 35);
            globalThis.p(globalThis.c, { tick: bassCH === globalThis.cCH3 ? this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(.1), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === globalThis.cCH3 ? globalThis.velocity * globalThis.rf(1.15, 1.35) : this.binVel * globalThis.rf(1.85, 2.45)] });
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * (bassCH === globalThis.cCH3 ? globalThis.rf(1.1, 3) : globalThis.rv(globalThis.rf(.8, 3.5))), vals: [bassCH, bassNote] });
          });
        }
      });
      globalThis.subdivsOff = 0;
      globalThis.subdivsOn++;
    } else {
      globalThis.subdivsOff++;
      globalThis.subdivsOn = 0;
    }
  }

  /**
   * Calculates note timing and sustain parameters for subsubdivision-based notes
   * @returns {void}
   */
  setNoteParams2(): void {
    const subdivsPerMinute = globalThis.subdivsPerBeat * globalThis.midiBPM;
    this.on = globalThis.subsubdivStart + (globalThis.tpSubsubdiv * globalThis.rv(globalThis.rf(.2), [-.1, .07], .3));
    this.shortSustain = globalThis.rv(globalThis.rf(globalThis.m.max(globalThis.tpDiv * .5, globalThis.tpDiv / globalThis.subdivsPerDiv), (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = globalThis.rv(globalThis.rf(globalThis.tpDiv * .8, (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > globalThis.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * globalThis.rv(globalThis.rf(.8, 1.3));
    this.binVel = globalThis.rv(globalThis.velocity * globalThis.rf(.42, .57));
  }

  /**
   * Generates MIDI note events with complex stutter/shift effects (subsubdivision-based timing)
   * @returns {void}
   */
  playNotes2(): void {
    this.setNoteParams2();
    this.crossModulateRhythms();
    let reflectionCH: number;
    let bassCH: number;
    let bassNote: number;
    const noteObjects = globalThis.composer ? globalThis.composer.getNotes() : [];
    const motifNotes = globalThis.activeMotif ? globalThis.activeMotif.applyToNotes(noteObjects) : noteObjects;
    if (true) {
      motifNotes.forEach(({ note }: { note: number }) => {
        globalThis.source.filter((sourceCH: number) =>
          globalThis.flipBin ? globalThis.flipBinT.includes(sourceCH) : globalThis.flipBinF.includes(sourceCH)
        ).map((sourceCH: number) => {
          globalThis.p(globalThis.c, { tick: sourceCH === globalThis.cCH1 ? this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 9), [-.1, .1], .3) : this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 3), [-.1, .1], .3), type: 'on', vals: [sourceCH, note, sourceCH === globalThis.cCH1 ? globalThis.velocity * globalThis.rf(.95, 1.15) : this.binVel * globalThis.rf(.95, 1.03)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (sourceCH === globalThis.cCH1 ? 1 : globalThis.rv(globalThis.rf(.92, 1.03))), vals: [sourceCH, note] });

          // Stutter-Shift: Random note stutter and octave shift.
          const stutters = new Map<number, number>();
          const shifts = new Map<number, number>();
          let stutterApplied = false;
          let globalStutterData: any = null;
          if (!stutterApplied && globalThis.rf() < globalThis.rv(.2, [.5, 1], .3)) {
            // Calculate stutter once for all Source channels
            const numStutters = globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(3, 9), [2, 5], .33), [2, 5], .1));
            globalStutterData = {
              numStutters: numStutters,
              duration: .25 * globalThis.ri(1, 6) * this.sustain / numStutters,
              minVelocity: 11,
              maxVelocity: 111,
              isFadeIn: globalThis.rf() < 0.5,
              decay: globalThis.rf(.75, 1.25)
            };
            stutterApplied = true;
          }
          if (globalStutterData) {
            const { numStutters, duration, minVelocity, maxVelocity, isFadeIn, decay } = globalStutterData;
            for (let i = 0; i < numStutters; i++) {
              const tick = this.on + duration * i;
              let stutterNote = note;
              if (globalThis.rf() < .25) {
                if (!shifts.has(sourceCH)) shifts.set(sourceCH, globalThis.ri(-3, 3) * 12);
                const octaveShift = shifts.get(sourceCH)!;
                stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min * 12 - 1), globalThis.OCTAVE.max * 12 - 1);
              }
              let currentVelocity: number;
              if (isFadeIn) {
                const fadeInMultiplier = decay * (i / (numStutters * globalThis.rf(0.4, 2.2) - 1));
                currentVelocity = globalThis.clamp(globalThis.m.min(maxVelocity, globalThis.ri(33) + maxVelocity * fadeInMultiplier), 0, 100);
              } else {
                const fadeOutMultiplier = 1 - (decay * (i / (numStutters * globalThis.rf(0.4, 2.2) - 1)));
                currentVelocity = globalThis.clamp(globalThis.m.max(0, globalThis.ri(33) + maxVelocity * fadeOutMultiplier), 0, 100);
              }
              globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.15), vals: [sourceCH, stutterNote] });
              globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === globalThis.cCH1 ? currentVelocity * globalThis.rf(.3, .7) : currentVelocity * globalThis.rf(.45, .8)] });
            }
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.5, 1.5), vals: [sourceCH, note] });
          }
          if (globalThis.rf() < globalThis.rv(.07, [.5, 1], .2)) { // Source Channels Stutter-Shift #2: Unique per channel.
            if (!stutters.has(sourceCH)) stutters.set(sourceCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2, 7), [2, 5], .33), [2, 5], .1)));
            const numStutters = stutters.get(sourceCH)!;
            const duration = .25 * globalThis.ri(1, 5) * this.sustain / numStutters;
            for (let i = 0; i < numStutters; i++) {
              const tick = this.on + duration * i;
              let stutterNote = note;
              if (globalThis.rf() < .15) {
                if (!shifts.has(sourceCH)) shifts.set(sourceCH, globalThis.ri(-3, 3) * 12);
                const octaveShift = shifts.get(sourceCH)!;
                stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min * 12 - 1), globalThis.OCTAVE.max * 12 - 1);
              }
              if (globalThis.rf() < .6) {
                globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.15), vals: [sourceCH, stutterNote] });
                globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === globalThis.cCH1 ? globalThis.velocity * globalThis.rf(.3, .7) : this.binVel * globalThis.rf(.45, .8)] });
              }
            }
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.5, 1.5), vals: [sourceCH, note] });
          }

          reflectionCH = globalThis.reflect[sourceCH];
          globalThis.p(globalThis.c, { tick: reflectionCH === globalThis.cCH2 ? this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(.2), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === globalThis.cCH2 ? globalThis.velocity * globalThis.rf(.5, .8) : this.binVel * globalThis.rf(.55, .9)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (reflectionCH === globalThis.cCH2 ? globalThis.rf(.7, 1.2) : globalThis.rv(globalThis.rf(.65, 1.3))), vals: [reflectionCH, note] });
          if (globalThis.rf() < .2) { // Reflection Channels Stutter-Shift
            if (!stutters.has(reflectionCH)) stutters.set(reflectionCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2, 7), [2, 5], .33), [2, 5], .1)));
            const numStutters = stutters.get(reflectionCH)!;
            const duration = .25 * globalThis.ri(1, 8) * this.sustain / numStutters;
            for (let i = 0; i < numStutters; i++) {
              const tick = this.on + duration * i;
              let stutterNote = note;
              if (globalThis.rf() < .7) {
                if (!shifts.has(reflectionCH)) shifts.set(reflectionCH, globalThis.ri(-3, 3) * 12);
                const octaveShift = shifts.get(reflectionCH)!;
                stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min * 12 - 1), globalThis.OCTAVE.max * 12 - 1);
              }
              if (globalThis.rf() < .5) {
                globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.3), vals: [reflectionCH, stutterNote] });
                globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.25, .7), type: 'on', vals: [reflectionCH, stutterNote, reflectionCH === globalThis.cCH2 ? globalThis.velocity * globalThis.rf(.25, .65) : this.binVel * globalThis.rf(.4, .75)] });
              }
            }
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.75, 2), vals: [reflectionCH, note] });
          }

          if (globalThis.rf() < globalThis.clamp(.35 * globalThis.bpmRatio3, .2, .7)) {
            bassCH = globalThis.reflect2[sourceCH];
            bassNote = globalThis.modClamp(note, 12, 35);
            globalThis.p(globalThis.c, { tick: bassCH === globalThis.cCH3 ? this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(.1), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === globalThis.cCH3 ? globalThis.velocity * globalThis.rf(1.15, 1.35) : this.binVel * globalThis.rf(1.85, 2.45)] });
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * (bassCH === globalThis.cCH3 ? globalThis.rf(1.1, 3) : globalThis.rv(globalThis.rf(.8, 3.5))), vals: [bassCH, bassNote] });
            if (globalThis.rf() < .7) { // Bass Channels Stutter-Shift
              if (!stutters.has(bassCH)) stutters.set(bassCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2, 5), [2, 3], .33), [2, 10], .1)));
              const numStutters = stutters.get(bassCH)!;
              const duration = .25 * globalThis.ri(1, 8) * this.sustain / numStutters;
              for (let i = 0; i < numStutters; i++) {
                const tick = this.on + duration * i;
                let stutterNote = bassNote;
                if (globalThis.rf() < .5) {
                  if (!shifts.has(bassCH)) shifts.set(bassCH, globalThis.ri(-2, 2) * 12);
                  const octaveShift = shifts.get(bassCH)!;
                  stutterNote = globalThis.modClamp(bassNote + octaveShift, 0, 59);
                }
                if (globalThis.rf() < .3) {
                  globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.3), vals: [bassCH, stutterNote] });
                  globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.25, .7), type: 'on', vals: [bassCH, stutterNote, bassCH === globalThis.cCH3 ? globalThis.velocity * globalThis.rf(.55, .85) : this.binVel * globalThis.rf(.75, 1.05)] });
                }
              }
              globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.15, .35), vals: [bassCH, note] });
            }
          }
        });
      });
    }
  }
}
```

<!-- END: snippet:PlayNotes -->

#### `setNoteParams()`

Calculate note onset, sustain, velocity for subdivision-level notes.

<!-- BEGIN: snippet:PlayNotes_setNoteParams -->

```typescript
setNoteParams(): void {
    const subdivsPerMinute = globalThis.subdivsPerBeat * globalThis.midiBPM;
    this.on = globalThis.subdivStart + (globalThis.tpSubdiv * globalThis.rv(globalThis.rf(.2), [-.1, .07], .3));
    this.shortSustain = globalThis.rv(globalThis.rf(globalThis.m.max(globalThis.tpDiv * .5, globalThis.tpDiv / globalThis.subdivsPerDiv), (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = globalThis.rv(globalThis.rf(globalThis.tpDiv * .8, (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > globalThis.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * globalThis.rv(globalThis.rf(.8, 1.3));
    this.binVel = globalThis.rv(globalThis.velocity * globalThis.rf(.42, .57));
  }
```

<!-- END: snippet:PlayNotes_setNoteParams -->

#### `playNotes()`

Generate MIDI note events at subdivision timescale.

<!-- BEGIN: snippet:PlayNotes_playNotes -->

```typescript
playNotes(): void {
    this.setNoteParams();
    this.crossModulateRhythms();
    const noteObjects = globalThis.composer ? globalThis.composer.getNotes() : [];
    const motifNotes = globalThis.activeMotif ? globalThis.activeMotif.applyToNotes(noteObjects) : noteObjects;
    if ((this.crossModulation + this.lastCrossMod) / globalThis.rf(1.4, 2.6) > globalThis.rv(globalThis.rf(1.8, 2.8), [-.2, -.3], .05)) {
      motifNotes.forEach(({ note }: { note: number }) => {
        // Play source channels
        globalThis.source.filter((sourceCH: number) =>
          globalThis.flipBin ? globalThis.flipBinT.includes(sourceCH) : globalThis.flipBinF.includes(sourceCH)
        ).map((sourceCH: number) => {
          globalThis.p(globalThis.c, { tick: sourceCH === globalThis.cCH1 ? this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 9), [-.1, .1], .3) : this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 3), [-.1, .1], .3), type: 'on', vals: [sourceCH, note, sourceCH === globalThis.cCH1 ? globalThis.velocity * globalThis.rf(.95, 1.15) : this.binVel * globalThis.rf(.95, 1.03)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (sourceCH === globalThis.cCH1 ? 1 : globalThis.rv(globalThis.rf(.92, 1.03))), vals: [sourceCH, note] });
        });

        // Play reflection channels
        globalThis.reflection.filter((reflectionCH: number) =>
          globalThis.flipBin ? globalThis.flipBinT.includes(reflectionCH) : globalThis.flipBinF.includes(reflectionCH)
        ).map((reflectionCH: number) => {
          globalThis.p(globalThis.c, { tick: reflectionCH === globalThis.cCH2 ? this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(.2), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === globalThis.cCH2 ? globalThis.velocity * globalThis.rf(.5, .8) : this.binVel * globalThis.rf(.55, .9)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (reflectionCH === globalThis.cCH2 ? globalThis.rf(.7, 1.2) : globalThis.rv(globalThis.rf(.65, 1.3))), vals: [reflectionCH, note] });
        });

        // Play bass channels (with probability based on BPM)
        if (globalThis.rf() < globalThis.clamp(.35 * globalThis.bpmRatio3, .2, .7)) {
          globalThis.bass.filter((bassCH: number) =>
            globalThis.flipBin ? globalThis.flipBinT.includes(bassCH) : globalThis.flipBinF.includes(bassCH)
          ).map((bassCH: number) => {
            const bassNote = globalThis.modClamp(note, 12, 35);
            globalThis.p(globalThis.c, { tick: bassCH === globalThis.cCH3 ? this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(.1), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === globalThis.cCH3 ? globalThis.velocity * globalThis.rf(1.15, 1.35) : this.binVel * globalThis.rf(1.85, 2.45)] });
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * (bassCH === globalThis.cCH3 ? globalThis.rf(1.1, 3) : globalThis.rv(globalThis.rf(.8, 3.5))), vals: [bassCH, bassNote] });
          });
        }
      });
      globalThis.subdivsOff = 0;
      globalThis.subdivsOn++;
    } else {
      globalThis.subdivsOff++;
      globalThis.subdivsOn = 0;
    }
  }
```

<!-- END: snippet:PlayNotes_playNotes -->

#### `setNoteParams2()`

Calculate note onset, sustain, velocity for sub-subdivision-level notes.

<!-- BEGIN: snippet:PlayNotes_setNoteParams2 -->

```typescript
setNoteParams2(): void {
    const subdivsPerMinute = globalThis.subdivsPerBeat * globalThis.midiBPM;
    this.on = globalThis.subsubdivStart + (globalThis.tpSubsubdiv * globalThis.rv(globalThis.rf(.2), [-.1, .07], .3));
    this.shortSustain = globalThis.rv(globalThis.rf(globalThis.m.max(globalThis.tpDiv * .5, globalThis.tpDiv / globalThis.subdivsPerDiv), (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = globalThis.rv(globalThis.rf(globalThis.tpDiv * .8, (globalThis.tpBeat * (.3 + globalThis.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > globalThis.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * globalThis.rv(globalThis.rf(.8, 1.3));
    this.binVel = globalThis.rv(globalThis.velocity * globalThis.rf(.42, .57));
  }
```

<!-- END: snippet:PlayNotes_setNoteParams2 -->

#### `playNotes2()`

Generate MIDI note events with stutter/shift effects at sub-subdivision timescale.

<!-- BEGIN: snippet:PlayNotes_playNotes2 -->

```typescript
playNotes2(): void {
    this.setNoteParams2();
    this.crossModulateRhythms();
    let reflectionCH: number;
    let bassCH: number;
    let bassNote: number;
    const noteObjects = globalThis.composer ? globalThis.composer.getNotes() : [];
    const motifNotes = globalThis.activeMotif ? globalThis.activeMotif.applyToNotes(noteObjects) : noteObjects;
    if (true) {
      motifNotes.forEach(({ note }: { note: number }) => {
        globalThis.source.filter((sourceCH: number) =>
          globalThis.flipBin ? globalThis.flipBinT.includes(sourceCH) : globalThis.flipBinF.includes(sourceCH)
        ).map((sourceCH: number) => {
          globalThis.p(globalThis.c, { tick: sourceCH === globalThis.cCH1 ? this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 9), [-.1, .1], .3) : this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 3), [-.1, .1], .3), type: 'on', vals: [sourceCH, note, sourceCH === globalThis.cCH1 ? globalThis.velocity * globalThis.rf(.95, 1.15) : this.binVel * globalThis.rf(.95, 1.03)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (sourceCH === globalThis.cCH1 ? 1 : globalThis.rv(globalThis.rf(.92, 1.03))), vals: [sourceCH, note] });

          // Stutter-Shift: Random note stutter and octave shift.
          const stutters = new Map<number, number>();
          const shifts = new Map<number, number>();
          let stutterApplied = false;
          let globalStutterData: any = null;
          if (!stutterApplied && globalThis.rf() < globalThis.rv(.2, [.5, 1], .3)) {
            // Calculate stutter once for all Source channels
            const numStutters = globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(3, 9), [2, 5], .33), [2, 5], .1));
            globalStutterData = {
              numStutters: numStutters,
              duration: .25 * globalThis.ri(1, 6) * this.sustain / numStutters,
              minVelocity: 11,
              maxVelocity: 111,
              isFadeIn: globalThis.rf() < 0.5,
              decay: globalThis.rf(.75, 1.25)
            };
            stutterApplied = true;
          }
          if (globalStutterData) {
            const { numStutters, duration, minVelocity, maxVelocity, isFadeIn, decay } = globalStutterData;
            for (let i = 0; i < numStutters; i++) {
              const tick = this.on + duration * i;
              let stutterNote = note;
              if (globalThis.rf() < .25) {
                if (!shifts.has(sourceCH)) shifts.set(sourceCH, globalThis.ri(-3, 3) * 12);
                const octaveShift = shifts.get(sourceCH)!;
                stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min * 12 - 1), globalThis.OCTAVE.max * 12 - 1);
              }
              let currentVelocity: number;
              if (isFadeIn) {
                const fadeInMultiplier = decay * (i / (numStutters * globalThis.rf(0.4, 2.2) - 1));
                currentVelocity = globalThis.clamp(globalThis.m.min(maxVelocity, globalThis.ri(33) + maxVelocity * fadeInMultiplier), 0, 100);
              } else {
                const fadeOutMultiplier = 1 - (decay * (i / (numStutters * globalThis.rf(0.4, 2.2) - 1)));
                currentVelocity = globalThis.clamp(globalThis.m.max(0, globalThis.ri(33) + maxVelocity * fadeOutMultiplier), 0, 100);
              }
              globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.15), vals: [sourceCH, stutterNote] });
              globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === globalThis.cCH1 ? currentVelocity * globalThis.rf(.3, .7) : currentVelocity * globalThis.rf(.45, .8)] });
            }
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.5, 1.5), vals: [sourceCH, note] });
          }
          if (globalThis.rf() < globalThis.rv(.07, [.5, 1], .2)) { // Source Channels Stutter-Shift #2: Unique per channel.
            if (!stutters.has(sourceCH)) stutters.set(sourceCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2, 7), [2, 5], .33), [2, 5], .1)));
            const numStutters = stutters.get(sourceCH)!;
            const duration = .25 * globalThis.ri(1, 5) * this.sustain / numStutters;
            for (let i = 0; i < numStutters; i++) {
              const tick = this.on + duration * i;
              let stutterNote = note;
              if (globalThis.rf() < .15) {
                if (!shifts.has(sourceCH)) shifts.set(sourceCH, globalThis.ri(-3, 3) * 12);
                const octaveShift = shifts.get(sourceCH)!;
                stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min * 12 - 1), globalThis.OCTAVE.max * 12 - 1);
              }
              if (globalThis.rf() < .6) {
                globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.15), vals: [sourceCH, stutterNote] });
                globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === globalThis.cCH1 ? globalThis.velocity * globalThis.rf(.3, .7) : this.binVel * globalThis.rf(.45, .8)] });
              }
            }
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.5, 1.5), vals: [sourceCH, note] });
          }

          reflectionCH = globalThis.reflect[sourceCH];
          globalThis.p(globalThis.c, { tick: reflectionCH === globalThis.cCH2 ? this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(.2), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === globalThis.cCH2 ? globalThis.velocity * globalThis.rf(.5, .8) : this.binVel * globalThis.rf(.55, .9)] });
          globalThis.p(globalThis.c, { tick: this.on + this.sustain * (reflectionCH === globalThis.cCH2 ? globalThis.rf(.7, 1.2) : globalThis.rv(globalThis.rf(.65, 1.3))), vals: [reflectionCH, note] });
          if (globalThis.rf() < .2) { // Reflection Channels Stutter-Shift
            if (!stutters.has(reflectionCH)) stutters.set(reflectionCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2, 7), [2, 5], .33), [2, 5], .1)));
            const numStutters = stutters.get(reflectionCH)!;
            const duration = .25 * globalThis.ri(1, 8) * this.sustain / numStutters;
            for (let i = 0; i < numStutters; i++) {
              const tick = this.on + duration * i;
              let stutterNote = note;
              if (globalThis.rf() < .7) {
                if (!shifts.has(reflectionCH)) shifts.set(reflectionCH, globalThis.ri(-3, 3) * 12);
                const octaveShift = shifts.get(reflectionCH)!;
                stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min * 12 - 1), globalThis.OCTAVE.max * 12 - 1);
              }
              if (globalThis.rf() < .5) {
                globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.3), vals: [reflectionCH, stutterNote] });
                globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.25, .7), type: 'on', vals: [reflectionCH, stutterNote, reflectionCH === globalThis.cCH2 ? globalThis.velocity * globalThis.rf(.25, .65) : this.binVel * globalThis.rf(.4, .75)] });
              }
            }
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.75, 2), vals: [reflectionCH, note] });
          }

          if (globalThis.rf() < globalThis.clamp(.35 * globalThis.bpmRatio3, .2, .7)) {
            bassCH = globalThis.reflect2[sourceCH];
            bassNote = globalThis.modClamp(note, 12, 35);
            globalThis.p(globalThis.c, { tick: bassCH === globalThis.cCH3 ? this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(.1), [-.01, .1], .5) : this.on + globalThis.rv(globalThis.tpSubsubdiv * globalThis.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === globalThis.cCH3 ? globalThis.velocity * globalThis.rf(1.15, 1.35) : this.binVel * globalThis.rf(1.85, 2.45)] });
            globalThis.p(globalThis.c, { tick: this.on + this.sustain * (bassCH === globalThis.cCH3 ? globalThis.rf(1.1, 3) : globalThis.rv(globalThis.rf(.8, 3.5))), vals: [bassCH, bassNote] });
            if (globalThis.rf() < .7) { // Bass Channels Stutter-Shift
              if (!stutters.has(bassCH)) stutters.set(bassCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2, 5), [2, 3], .33), [2, 10], .1)));
              const numStutters = stutters.get(bassCH)!;
              const duration = .25 * globalThis.ri(1, 8) * this.sustain / numStutters;
              for (let i = 0; i < numStutters; i++) {
                const tick = this.on + duration * i;
                let stutterNote = bassNote;
                if (globalThis.rf() < .5) {
                  if (!shifts.has(bassCH)) shifts.set(bassCH, globalThis.ri(-2, 2) * 12);
                  const octaveShift = shifts.get(bassCH)!;
                  stutterNote = globalThis.modClamp(bassNote + octaveShift, 0, 59);
                }
                if (globalThis.rf() < .3) {
                  globalThis.p(globalThis.c, { tick: tick - duration * globalThis.rf(.3), vals: [bassCH, stutterNote] });
                  globalThis.p(globalThis.c, { tick: tick + duration * globalThis.rf(.25, .7), type: 'on', vals: [bassCH, stutterNote, bassCH === globalThis.cCH3 ? globalThis.velocity * globalThis.rf(.55, .85) : this.binVel * globalThis.rf(.75, 1.05)] });
                }
              }
              globalThis.p(globalThis.c, { tick: this.on + this.sustain * globalThis.rf(.15, .35), vals: [bassCH, note] });
            }
          }
        });
      });
    }
  }
```

<!-- END: snippet:PlayNotes_playNotes2 -->

#### `crossModulateRhythms()`

Calculate cross-modulation across beat/division/subdivision rhythms for probabilistic note on/off.

<!-- BEGIN: snippet:PlayNotes_crossModulateRhythms -->

```typescript
crossModulateRhythms(): void {
    this.lastCrossMod = this.crossModulation;
    this.crossModulation = 0;
    this.crossModulation += globalThis.beatRhythm[globalThis.beatIndex] > 0 ? globalThis.rf(1.5, 3) : globalThis.m.max(globalThis.rf(.625, 1.25), (1 / globalThis.numerator) * globalThis.beatsOff + (1 / globalThis.numerator) * globalThis.beatsOn) +
      globalThis.divRhythm[globalThis.divIndex] > 0 ? globalThis.rf(1, 2) : globalThis.m.max(globalThis.rf(.5, 1), (1 / globalThis.divsPerBeat) * globalThis.divsOff + (1 / globalThis.divsPerBeat) * globalThis.divsOn) +
      globalThis.subdivRhythm[globalThis.subdivIndex] > 0 ? globalThis.rf(.5, 1) : globalThis.m.max(globalThis.rf(.25, .5), (1 / globalThis.subdivsPerDiv) * globalThis.subdivsOff + (1 / globalThis.subdivsPerDiv) * globalThis.subdivsOn) +
      (globalThis.subdivsOn < globalThis.ri(7, 15) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) + (globalThis.subdivsOff > globalThis.ri() ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) +
      (globalThis.divsOn < globalThis.ri(9, 15) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) + (globalThis.divsOff > globalThis.ri(3, 7) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) +
      (globalThis.beatsOn < globalThis.ri(3) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) + (globalThis.beatsOff > globalThis.ri(3) ? globalThis.rf(.1, .3) : globalThis.rf(-.1)) +
      (globalThis.subdivsOn > globalThis.ri(7, 15) ? globalThis.rf(-.3, -.5) : globalThis.rf(.1)) + (globalThis.subdivsOff < globalThis.ri() ? globalThis.rf(-.3, -.5) : globalThis.rf(.1)) +
      (globalThis.divsOn > globalThis.ri(9, 15) ? globalThis.rf(-.2, -.4) : globalThis.rf(.1)) + (globalThis.divsOff < globalThis.ri(3, 7) ? globalThis.rf(-.2, -.4) : globalThis.rf(.1)) +
      (globalThis.beatsOn > globalThis.ri(3) ? globalThis.rf(-.2, -.3) : globalThis.rf(.1)) + (globalThis.beatsOff < globalThis.ri(3) ? globalThis.rf(-.1, -.3) : globalThis.rf(.1)) +
      (globalThis.subdivsPerMinute > globalThis.ri(400, 600) ? globalThis.rf(-.4, -.6) : globalThis.rf(.1)) + (globalThis.subdivsOn * globalThis.rf(-.05, -.15)) + (globalThis.beatRhythm[globalThis.beatIndex] < 1 ? globalThis.rf(.4, .5) : 0) + (globalThis.divRhythm[globalThis.divIndex] < 1 ? globalThis.rf(.3, .4) : 0) + (globalThis.subdivRhythm[globalThis.subdivIndex] < 1 ? globalThis.rf(.2, .3) : 0);
  }
```

<!-- END: snippet:PlayNotes_crossModulateRhythms -->

### State Properties

- `lastCrossMod`, `crossModulation` – Cross-modulation tracking for rhythm interaction
- `on`, `shortSustain`, `longSustain`, `sustain` – Timing parameters
- `binVel` – Binaural velocity (reduced for spatial effects)
- `useShort` – Flag for short vs long sustain based on subdivsPerMinute

---

## Stutter/Shift Effects

PlayNotes2 applies probabilistic effects:

1. **Global Stutter** (20% chance) – Coordinated stutter across all source channels with fade-in/fade-out
2. **Per-Channel Stutter** (7% chance on source) – Unique stutter per source channel
3. **Reflection Stutter** (20% chance) – Stutter effect on reflection channels
4. **Bass Stutter** (70% chance) – Stutter on bass channels with reduced note range

Stutters include:
- Randomized octave shifts (±3 octaves)
- Velocity ramping with decay factor
- Duration scaling based on stutter count

---

## Usage Example

```typescript
import { PlayNotes } from '../src/playNotes';

const playNotes = new PlayNotes();

// In main composition loop:
playNotes.playNotes();     // Subdivision-level notes

// For denser pattern:
playNotes.playNotes2();    // Sub-subdivision-level notes with stutters
```

---

## Related Modules

- stage.ts ([code](../src/stage.ts)) ([doc](stage.md)) - Calls playNotes methods during beat/division loop
- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Orchestrates timing loops that call playNotes
- motifs.ts ([code](../src/motifs.ts)) ([doc](motifs.md)) - Transforms notes before rendering
- composers/ ([code](../src/composers/)) ([doc](composers.md)) - Generate note material
- writer.ts ([code](../src/writer.ts)) ([doc](writer.md)) - Emits MIDI via global `p()` function
