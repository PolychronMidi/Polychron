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
  // Counters previously stored on legacy globals; now instance-local
  public subdivsOn: number = 0;
  public subdivsOff: number = 0;

  constructor() {}

  /**
   * Calculates cross-modulation value based on rhythm state across all levels
   * @returns {void}
   */
  crossModulateRhythms(ctx: ICompositionContext): void {
    if (!ctx) throw new Error('PlayNotes.crossModulateRhythms requires an ICompositionContext (DI-only)');
    const state = ctx.state as any;
    const utils = (ctx as any).utils ?? (getPolychronContext().utils as any);

    this.lastCrossMod = this.crossModulation;
    this.crossModulation = (
      (state.beatRhythm[state.beatIndex] > 0 ? utils.rf(1.6, 3.2) * 1.25 : utils.m.max(utils.rf(.5, .95), (state.beatsOff) / (state.numerator * state.numerator))) +
      (state.divRhythm[state.divIndex] > 0 ? utils.rf(1.1, 2.1) * 1.15 : utils.m.max(utils.rf(.4, .9), (state.divsOff) / (state.divsPerBeat * state.divsPerBeat))) +
      (state.subdivRhythm[state.subdivIndex] > 0 ? utils.rf(.6, 1.2) * 1.15 : utils.m.max(utils.rf(.2, .4), (state.subdivsOff) / (state.subdivsPerDiv * state.subdivsPerDiv)))
    ) +
      (this.subdivsOn < utils.ri(7, 15) ? utils.rf(.1, .3) : utils.rf(-.1)) + (this.subdivsOff > utils.ri() ? utils.rf(.1, .3) : utils.rf(-.1)) +
      (state.divsOn < utils.ri(9, 15) ? utils.rf(.1, .3) : utils.rf(-.1)) + (state.divsOff > utils.ri(3, 7) ? utils.rf(.1, .3) : utils.rf(-.1)) +
      (state.beatsOn < utils.ri(3) ? utils.rf(.1, .3) : utils.rf(-.1)) + (state.beatsOff > utils.ri(3) ? utils.rf(.1, .3) : utils.rf(-.1)) +
      (this.subdivsOn > utils.ri(7, 15) ? utils.rf(-.3, -.5) : utils.rf(.1)) + (this.subdivsOff < utils.ri() ? utils.rf(-.3, -.5) : utils.rf(.1)) +
      (state.divsOn > utils.ri(9, 15) ? utils.rf(-.2, -.4) : utils.rf(.1)) + (state.divsOff < utils.ri(3, 7) ? utils.rf(-.2, -.4) : utils.rf(.1)) +
      (state.beatsOn > utils.ri(3) ? utils.rf(-.2, -.3) : utils.rf(.1)) + (state.beatsOff < utils.ri(3) ? utils.rf(-.1, -.3) : utils.rf(.1)) +
      (state.subdivsPerMinute > utils.ri(400, 600) ? utils.rf(-.4, -.6) : utils.rf(.1)) + (this.subdivsOn * utils.rf(-.005, -.015)) + (state.beatRhythm[state.beatIndex] < 1 ? utils.rf(.4, .5) : 0) + (state.divRhythm[state.divIndex] < 1 ? utils.rf(.3, .4) : 0) + (state.subdivRhythm[state.subdivIndex] < 1 ? utils.rf(.2, .3) : 0);
  }

  /**
   * Calculates note timing and sustain parameters for subdivision-based notes
   * @returns {void}
   */
  setNoteParams(ctx: any): void {
    if (!ctx) throw new Error('PlayNotes.setNoteParams requires an ICompositionContext (DI-only)');
    const state = ctx.state as any;
    const utils = (ctx as any).utils ?? getPolychronContext().utils;
    const subdivsPerMinute = state.subdivsPerBeat * state.midiBPM;
    // Defensive fallback: ensure tpSubdiv is finite and >0 to avoid generating on==0 when subdivStart==0
    const rawTpSubdiv = state.tpSubdiv;
    const tpSubdiv = (Number.isFinite(rawTpSubdiv) && rawTpSubdiv > 0)
      ? rawTpSubdiv
      : Math.max(1, (Number.isFinite(state.tpDiv) && state.subdivsPerDiv ? (state.tpDiv / Math.max(1, state.subdivsPerDiv)) : 1));
    const subdivStart = Number.isFinite(state.subdivStart) ? state.subdivStart : 0;
    this.on = subdivStart + (tpSubdiv * utils.rv(utils.rf(.2), [-.1, .07], .3));
    this.shortSustain = utils.rv(utils.rf(utils.m.max(state.tpDiv * .5, state.tpDiv / Math.max(1, state.subdivsPerDiv)), (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = utils.rv(utils.rf(state.tpDiv * .8, (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > utils.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * utils.rv(utils.rf(.8, 1.3));
    this.binVel = utils.rv(state.velocity * utils.rf(.42, .57));
  }
  /**
   * Generates MIDI note events for source channels (subdivision-based timing)
   * @returns {void}
   */
  playNotes(ctx: ICompositionContext): void {
    this.setNoteParams(ctx);
    this.crossModulateRhythms(ctx);
    const composer = ctx.state.composer;
    const activeMotif = ctx.state.activeMotif ?? null;
    const noteObjects = composer ? composer.getNotes() : [];
    const motifNotes = activeMotif ? activeMotif.applyToNotes(noteObjects) : noteObjects;
    const utils = (ctx as any).utils ?? getPolychronContext().utils;
    if ((this.crossModulation + this.lastCrossMod) / utils.rf(1.4, 2.6) > utils.rv(utils.rf(1.8, 2.8), [-.2, -.3], .05)) {
      motifNotes.forEach(({ note }: { note: number }) => {
        // Play source channels
        source.filter((sourceCH: number) =>
          ctx.state.flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
        ).map((sourceCH: number) => {
          const tickVal = sourceCH === cCH1
            ? this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(1 / 9), [-.1, .1], .3)
            : this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(1 / 3), [-.1, .1], .3);
          if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
            console.error(`[PlayNotes.playNotes] NOTE ON tick=0 detected: on=${this.on} tpSubdiv=${ctx.state.tpSubdiv} subdivStart=${ctx.state.subdivStart} sourceCH=${sourceCH} note=${note}`);
          }
          pushEvent(ctx, { tick: tickVal, type: 'on', vals: [sourceCH, note, sourceCH === cCH1 ? ctx.state.velocity * utils.rf(.95, 1.15) : this.binVel * utils.rf(.95, 1.03)] });
          pushEvent(ctx, { tick: this.on + this.sustain * (sourceCH === cCH1 ? 1 : utils.rv(utils.rf(.92, 1.03))), vals: [sourceCH, note] });
        });

        // Play reflection channels
        reflection.filter((reflectionCH: number) =>
          ctx.state.flipBin ? flipBinT.includes(reflectionCH) : flipBinF.includes(reflectionCH)
        ).map((reflectionCH: number) => {
          const tickVal = reflectionCH === cCH2
            ? this.on + utils.rv(ctx.state.tpSubsubdiv * utils.rf(.2), [-.01, .1], .5)
            : this.on + utils.rv(ctx.state.tpSubsubdiv * utils.rf(1 / 3), [-.01, .1], .5);
          if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
            console.error(`[PlayNotes.playNotes] REFLECTION NOTE ON tick=0 detected: on=${this.on} tpSubsubdiv=${ctx.state.tpSubsubdiv} subsubdivStart=${ctx.state.subsubdivStart} reflectionCH=${reflectionCH} note=${note}`);
          }
          pushEvent(ctx, { tick: tickVal, type: 'on', vals: [reflectionCH, note, reflectionCH === cCH2 ? ctx.state.velocity * utils.rf(.5, .8) : this.binVel * utils.rf(.55, .9)] });
          pushEvent(ctx, { tick: this.on + this.sustain * (reflectionCH === cCH2 ? utils.rf(.7, 1.2) : utils.rv(utils.rf(.65, 1.3))), vals: [reflectionCH, note] });
        });

        // Play bass channels (with probability based on BPM)
        {
          const br3 = Number.isFinite(ctx.state.bpmRatio3) ? ctx.state.bpmRatio3 : 1;
          const threshold = Utils.clamp(.35 * br3, .2, .7);
          if (utils.rf() < threshold) {
            bass.filter((bassCH: number) =>
              ctx.state.flipBin ? flipBinT.includes(bassCH) : flipBinF.includes(bassCH)
            ).map((bassCH: number) => {
              const bassNote = Utils.modClamp(note, 12, 35);
              const tickVal = bassCH === cCH3
                ? this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(.1), [-.01, .1], .5)
                : this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(1 / 3), [-.01, .1], .5);
              if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
                console.error(`[PlayNotes.playNotes] BASS NOTE ON tick=0 detected: on=${this.on} tpSubdiv=${ctx.state.tpSubdiv} subdivStart=${ctx.state.subdivStart} bassCH=${bassCH} note=${bassNote}`);
              }
              pushEvent(ctx, { tick: tickVal, type: 'on', vals: [bassCH, bassNote, bassCH === cCH3 ? ctx.state.velocity * utils.rf(1.15, 1.35) : this.binVel * utils.rf(1.85, 2.45)] });
              pushEvent(ctx, { tick: this.on + this.sustain * (bassCH === cCH3 ? utils.rf(1.1, 3) : utils.rv(utils.rf(.8, 3.5))), vals: [bassCH, bassNote] });
            });
          }
        }
      });
      this.subdivsOff = 0;
      this.subdivsOn++;
    } else {
      this.subdivsOff++;
      this.subdivsOn = 0;
    }
  }

  /**
   * Calculates note timing and sustain parameters for subsubdivision-based notes
   * @returns {void}
   */
  setNoteParams2(ctx: any): void {
    const state = ctx?.state ?? {} as any;
    const utils = getPolychronContext().utils;
    const subdivsPerMinute = state.subdivsPerBeat * state.midiBPM;
    // Defensive fallback for subsubdivision-level timing
    const rawTpSubsub = state.tpSubsubdiv;
    const tpSubsubdiv = (Number.isFinite(rawTpSubsub) && rawTpSubsub > 0)
      ? rawTpSubsub
      : Math.max(1, (Number.isFinite(state.tpSubdiv) && state.subsubdivsPerSub ? (state.tpSubdiv / Math.max(1, state.subsubdivsPerSub)) : 1));
    const subsubdivStart = Number.isFinite(state.subsubdivStart) ? state.subsubdivStart : 0;
    this.on = subsubdivStart + (tpSubsubdiv * utils.rv(utils.rf(.2), [-.1, .07], .3));
    this.shortSustain = utils.rv(utils.rf(utils.m.max(state.tpDiv * .5, state.tpDiv / Math.max(1, state.subdivsPerDiv)), (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = utils.rv(utils.rf(state.tpDiv * .8, (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > utils.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * utils.rv(utils.rf(.8, 1.3));
    this.binVel = utils.rv(state.velocity * utils.rf(.42, .57));
  }

  /**
   * Generates MIDI note events with complex stutter/shift effects (subsubdivision-based timing)
   * @returns {void}
   */
  playNotes2(ctx: ICompositionContext): void {
    // Subsubdivision note generation should use DI-provided context/state and utilities
    this.setNoteParams2(ctx);
    this.crossModulateRhythms(ctx);

    const state = ctx.state as any;
    const utils = getPolychronContext().utils;
    const composer = state.composer;
    const activeMotif = state.activeMotif ?? null;
    const noteObjects = composer ? composer.getNotes() : [];
    const motifNotes = activeMotif ? activeMotif.applyToNotes(noteObjects) : noteObjects;

    motifNotes.forEach(({ note }: { note: number }) => {
      source.filter((sourceCH: number) =>
        state.flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
      ).forEach((sourceCH: number) => {
        const tickVal = sourceCH === cCH1
          ? this.on + utils.rv(state.tpSubsubdiv * utils.rf(1 / 9), [-.1, .1], .3)
          : this.on + utils.rv(state.tpSubsubdiv * utils.rf(1 / 3), [-.1, .1], .3);
        if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
          console.error(`[PlayNotes.playNotes2] NOTE ON tick=0 detected: on=${this.on} tpSubsubdiv=${state.tpSubsubdiv} subsubdivStart=${state.subsubdivStart} sourceCH=${sourceCH} note=${note}`);
        }
        pushEvent(ctx, { tick: tickVal, type: 'on', vals: [sourceCH, note, sourceCH === cCH1 ? state.velocity * utils.rf(.95, 1.15) : this.binVel * utils.rf(.95, 1.03)] });
        pushEvent(ctx, { tick: this.on + this.sustain * (sourceCH === cCH1 ? 1 : utils.rv(utils.rf(.92, 1.03))), vals: [sourceCH, note] });

        // Stutter calculations (shared across channels)
        const numStutters = utils.m.round(utils.rv(utils.rv(utils.ri(3, 9), [2, 5], .33), [2, 5], .1));
        if (utils.rf() < utils.rv(.2, [.5, 1], .3)) {
          const duration = .25 * utils.ri(1, 6) * this.sustain / Math.max(1, numStutters);
          const isFadeIn = utils.rf() < 0.5;
          const decay = utils.rf(.75, 1.25);

          for (let i = 0; i < numStutters; i++) {
            const tick = this.on + duration * i;
            let stutterNote = note;
            if (utils.rf() < .25) {
              const octaveShift = utils.ri(-3, 3) * 12;
              stutterNote = Utils.modClamp(note + octaveShift, utils.m.max(0, (ctx.state as any).OCTAVE?.min * 12 - 1 || 0), (ctx.state as any).OCTAVE?.max * 12 - 1 || 127);
            }
            let currentVelocity = 64;
            if (isFadeIn) {
              const fadeInMultiplier = decay * (i / (numStutters * utils.rf(0.4, 2.2) - 1));
              currentVelocity = utils.clamp(utils.m.min(127, utils.ri(33) + 127 * fadeInMultiplier), 0, 127);
            } else {
              const fadeOutMultiplier = 1 - (decay * (i / (numStutters * utils.rf(0.4, 2.2) - 1)));
              currentVelocity = utils.clamp(utils.m.max(0, utils.ri(33) + 127 * fadeOutMultiplier), 0, 127);
            }
            pushEvent(ctx, { tick: tick - duration * utils.rf(.15), vals: [sourceCH, stutterNote] });
            pushEvent(ctx, { tick: tick + duration * utils.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === cCH1 ? currentVelocity * utils.rf(.3, .7) : currentVelocity * utils.rf(.45, .8)] });
          }
          pushEvent(ctx, { tick: this.on + this.sustain * utils.rf(.5, 1.5), vals: [sourceCH, note] });
        }

        // Per-channel second stutter
        if (utils.rf() < utils.rv(.07, [.5, 1], .2)) {
          const numStutters2 = utils.m.round(utils.rv(utils.rv(utils.ri(2, 7), [2, 5], .33), [2, 5], .1));
          const duration2 = .25 * utils.ri(1, 5) * this.sustain / Math.max(1, numStutters2);
          for (let i = 0; i < numStutters2; i++) {
            const tick = this.on + duration2 * i;
            let stutterNote = note;
            if (utils.rf() < .15) {
              const octaveShift = utils.ri(-3, 3) * 12;
              stutterNote = Utils.modClamp(note + octaveShift, utils.m.max(0, (ctx.state as any).OCTAVE?.min * 12 - 1 || 0), (ctx.state as any).OCTAVE?.max * 12 - 1 || 127);
            }
            if (utils.rf() < .6) {
              pushEvent(ctx, { tick: tick - duration2 * utils.rf(.15), vals: [sourceCH, stutterNote] });
              pushEvent(ctx, { tick: tick + duration2 * utils.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === cCH1 ? state.velocity * utils.rf(.3, .7) : this.binVel * utils.rf(.45, .8)] });
            }
          }
          pushEvent(ctx, { tick: this.on + this.sustain * utils.rf(.5, 1.5), vals: [sourceCH, note] });
        }

        // Reflection
        const reflectionCH = reflect[sourceCH];
        pushEvent(ctx, { tick: reflectionCH === cCH2 ? this.on + utils.rv(state.tpSubdiv * utils.rf(.2), [-.01, .1], .5) : this.on + utils.rv(state.tpSubdiv * utils.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === cCH2 ? state.velocity * utils.rf(.5, .8) : this.binVel * utils.rf(.55, .9)] });
        pushEvent(ctx, { tick: this.on + this.sustain * (reflectionCH === cCH2 ? utils.rf(.7, 1.2) : utils.rv(utils.rf(.65, 1.3))), vals: [reflectionCH, note] });

        // Bass
        if (utils.rf() < utils.clamp(.35 * state.bpmRatio3, .2, .7)) {
          const bassCH = reflect2[sourceCH];
          const bassNote = Utils.modClamp(note, 12, 35);
          // Debug: emit log when probabilistic bass is generated (helps test troubleshooting)
          try { if (getPolychronContext().test?.enableLogging) console.error('[PlayNotes.playNotes2] emitting bass', { sourceCH, bassCH, threshold: utils.clamp(.35 * state.bpmRatio3, .2, .7) }); } catch (_e) {}
          pushEvent(ctx, { tick: bassCH === cCH3 ? this.on + utils.rv(state.tpSubsubdiv * utils.rf(.1), [-.01, .1], .5) : this.on + utils.rv(state.tpSubsubdiv * utils.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === cCH3 ? state.velocity * utils.rf(1.15, 1.35) : this.binVel * utils.rf(1.85, 2.45)] });
          pushEvent(ctx, { tick: this.on + this.sustain * (bassCH === cCH3 ? utils.rf(1.1, 3) : utils.rv(utils.rf(.8, 3.5))), vals: [bassCH, bassNote] });
        }
      });
    });
  }
}
```

<!-- END: snippet:PlayNotes -->

#### `setNoteParams()`

Calculate note onset, sustain, velocity for subdivision-level notes.

<!-- BEGIN: snippet:PlayNotes_setNoteParams -->

```typescript
setNoteParams(ctx: any): void {
    if (!ctx) throw new Error('PlayNotes.setNoteParams requires an ICompositionContext (DI-only)');
    const state = ctx.state as any;
    const utils = (ctx as any).utils ?? getPolychronContext().utils;
    const subdivsPerMinute = state.subdivsPerBeat * state.midiBPM;
    // Defensive fallback: ensure tpSubdiv is finite and >0 to avoid generating on==0 when subdivStart==0
    const rawTpSubdiv = state.tpSubdiv;
    const tpSubdiv = (Number.isFinite(rawTpSubdiv) && rawTpSubdiv > 0)
      ? rawTpSubdiv
      : Math.max(1, (Number.isFinite(state.tpDiv) && state.subdivsPerDiv ? (state.tpDiv / Math.max(1, state.subdivsPerDiv)) : 1));
    const subdivStart = Number.isFinite(state.subdivStart) ? state.subdivStart : 0;
    this.on = subdivStart + (tpSubdiv * utils.rv(utils.rf(.2), [-.1, .07], .3));
    this.shortSustain = utils.rv(utils.rf(utils.m.max(state.tpDiv * .5, state.tpDiv / Math.max(1, state.subdivsPerDiv)), (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = utils.rv(utils.rf(state.tpDiv * .8, (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > utils.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * utils.rv(utils.rf(.8, 1.3));
    this.binVel = utils.rv(state.velocity * utils.rf(.42, .57));
  }
```

<!-- END: snippet:PlayNotes_setNoteParams -->

#### `playNotes()`

Generate MIDI note events at subdivision timescale.

<!-- BEGIN: snippet:PlayNotes_playNotes -->

```typescript
playNotes(ctx: ICompositionContext): void {
    this.setNoteParams(ctx);
    this.crossModulateRhythms(ctx);
    const composer = ctx.state.composer;
    const activeMotif = ctx.state.activeMotif ?? null;
    const noteObjects = composer ? composer.getNotes() : [];
    const motifNotes = activeMotif ? activeMotif.applyToNotes(noteObjects) : noteObjects;
    const utils = (ctx as any).utils ?? getPolychronContext().utils;
    if ((this.crossModulation + this.lastCrossMod) / utils.rf(1.4, 2.6) > utils.rv(utils.rf(1.8, 2.8), [-.2, -.3], .05)) {
      motifNotes.forEach(({ note }: { note: number }) => {
        // Play source channels
        source.filter((sourceCH: number) =>
          ctx.state.flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
        ).map((sourceCH: number) => {
          const tickVal = sourceCH === cCH1
            ? this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(1 / 9), [-.1, .1], .3)
            : this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(1 / 3), [-.1, .1], .3);
          if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
            console.error(`[PlayNotes.playNotes] NOTE ON tick=0 detected: on=${this.on} tpSubdiv=${ctx.state.tpSubdiv} subdivStart=${ctx.state.subdivStart} sourceCH=${sourceCH} note=${note}`);
          }
          pushEvent(ctx, { tick: tickVal, type: 'on', vals: [sourceCH, note, sourceCH === cCH1 ? ctx.state.velocity * utils.rf(.95, 1.15) : this.binVel * utils.rf(.95, 1.03)] });
          pushEvent(ctx, { tick: this.on + this.sustain * (sourceCH === cCH1 ? 1 : utils.rv(utils.rf(.92, 1.03))), vals: [sourceCH, note] });
        });

        // Play reflection channels
        reflection.filter((reflectionCH: number) =>
          ctx.state.flipBin ? flipBinT.includes(reflectionCH) : flipBinF.includes(reflectionCH)
        ).map((reflectionCH: number) => {
          const tickVal = reflectionCH === cCH2
            ? this.on + utils.rv(ctx.state.tpSubsubdiv * utils.rf(.2), [-.01, .1], .5)
            : this.on + utils.rv(ctx.state.tpSubsubdiv * utils.rf(1 / 3), [-.01, .1], .5);
          if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
            console.error(`[PlayNotes.playNotes] REFLECTION NOTE ON tick=0 detected: on=${this.on} tpSubsubdiv=${ctx.state.tpSubsubdiv} subsubdivStart=${ctx.state.subsubdivStart} reflectionCH=${reflectionCH} note=${note}`);
          }
          pushEvent(ctx, { tick: tickVal, type: 'on', vals: [reflectionCH, note, reflectionCH === cCH2 ? ctx.state.velocity * utils.rf(.5, .8) : this.binVel * utils.rf(.55, .9)] });
          pushEvent(ctx, { tick: this.on + this.sustain * (reflectionCH === cCH2 ? utils.rf(.7, 1.2) : utils.rv(utils.rf(.65, 1.3))), vals: [reflectionCH, note] });
        });

        // Play bass channels (with probability based on BPM)
        {
          const br3 = Number.isFinite(ctx.state.bpmRatio3) ? ctx.state.bpmRatio3 : 1;
          const threshold = Utils.clamp(.35 * br3, .2, .7);
          if (utils.rf() < threshold) {
            bass.filter((bassCH: number) =>
              ctx.state.flipBin ? flipBinT.includes(bassCH) : flipBinF.includes(bassCH)
            ).map((bassCH: number) => {
              const bassNote = Utils.modClamp(note, 12, 35);
              const tickVal = bassCH === cCH3
                ? this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(.1), [-.01, .1], .5)
                : this.on + utils.rv(ctx.state.tpSubdiv * utils.rf(1 / 3), [-.01, .1], .5);
              if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
                console.error(`[PlayNotes.playNotes] BASS NOTE ON tick=0 detected: on=${this.on} tpSubdiv=${ctx.state.tpSubdiv} subdivStart=${ctx.state.subdivStart} bassCH=${bassCH} note=${bassNote}`);
              }
              pushEvent(ctx, { tick: tickVal, type: 'on', vals: [bassCH, bassNote, bassCH === cCH3 ? ctx.state.velocity * utils.rf(1.15, 1.35) : this.binVel * utils.rf(1.85, 2.45)] });
              pushEvent(ctx, { tick: this.on + this.sustain * (bassCH === cCH3 ? utils.rf(1.1, 3) : utils.rv(utils.rf(.8, 3.5))), vals: [bassCH, bassNote] });
            });
          }
        }
      });
      this.subdivsOff = 0;
      this.subdivsOn++;
    } else {
      this.subdivsOff++;
      this.subdivsOn = 0;
    }
  }
```

<!-- END: snippet:PlayNotes_playNotes -->

#### `setNoteParams2()`

Calculate note onset, sustain, velocity for sub-subdivision-level notes.

<!-- BEGIN: snippet:PlayNotes_setNoteParams2 -->

```typescript
setNoteParams2(ctx: any): void {
    const state = ctx?.state ?? {} as any;
    const utils = getPolychronContext().utils;
    const subdivsPerMinute = state.subdivsPerBeat * state.midiBPM;
    // Defensive fallback for subsubdivision-level timing
    const rawTpSubsub = state.tpSubsubdiv;
    const tpSubsubdiv = (Number.isFinite(rawTpSubsub) && rawTpSubsub > 0)
      ? rawTpSubsub
      : Math.max(1, (Number.isFinite(state.tpSubdiv) && state.subsubdivsPerSub ? (state.tpSubdiv / Math.max(1, state.subsubdivsPerSub)) : 1));
    const subsubdivStart = Number.isFinite(state.subsubdivStart) ? state.subsubdivStart : 0;
    this.on = subsubdivStart + (tpSubsubdiv * utils.rv(utils.rf(.2), [-.1, .07], .3));
    this.shortSustain = utils.rv(utils.rf(utils.m.max(state.tpDiv * .5, state.tpDiv / Math.max(1, state.subdivsPerDiv)), (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .2], .1, [-.05, -.1]);
    this.longSustain = utils.rv(utils.rf(state.tpDiv * .8, (state.tpBeat * (.3 + utils.rf() * .7))), [.1, .3], .1, [-.05, -.1]);
    this.useShort = subdivsPerMinute > utils.ri(400, 650);
    this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * utils.rv(utils.rf(.8, 1.3));
    this.binVel = utils.rv(state.velocity * utils.rf(.42, .57));
  }
```

<!-- END: snippet:PlayNotes_setNoteParams2 -->

#### `playNotes2()`

Generate MIDI note events with stutter/shift effects at sub-subdivision timescale.

<!-- BEGIN: snippet:PlayNotes_playNotes2 -->

```typescript
playNotes2(ctx: ICompositionContext): void {
    // Subsubdivision note generation should use DI-provided context/state and utilities
    this.setNoteParams2(ctx);
    this.crossModulateRhythms(ctx);

    const state = ctx.state as any;
    const utils = getPolychronContext().utils;
    const composer = state.composer;
    const activeMotif = state.activeMotif ?? null;
    const noteObjects = composer ? composer.getNotes() : [];
    const motifNotes = activeMotif ? activeMotif.applyToNotes(noteObjects) : noteObjects;

    motifNotes.forEach(({ note }: { note: number }) => {
      source.filter((sourceCH: number) =>
        state.flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)
      ).forEach((sourceCH: number) => {
        const tickVal = sourceCH === cCH1
          ? this.on + utils.rv(state.tpSubsubdiv * utils.rf(1 / 9), [-.1, .1], .3)
          : this.on + utils.rv(state.tpSubsubdiv * utils.rf(1 / 3), [-.1, .1], .3);
        if (getPolychronContext().test?.enableLogging && Math.round(Number(tickVal)) === 0) {
          console.error(`[PlayNotes.playNotes2] NOTE ON tick=0 detected: on=${this.on} tpSubsubdiv=${state.tpSubsubdiv} subsubdivStart=${state.subsubdivStart} sourceCH=${sourceCH} note=${note}`);
        }
        pushEvent(ctx, { tick: tickVal, type: 'on', vals: [sourceCH, note, sourceCH === cCH1 ? state.velocity * utils.rf(.95, 1.15) : this.binVel * utils.rf(.95, 1.03)] });
        pushEvent(ctx, { tick: this.on + this.sustain * (sourceCH === cCH1 ? 1 : utils.rv(utils.rf(.92, 1.03))), vals: [sourceCH, note] });

        // Stutter calculations (shared across channels)
        const numStutters = utils.m.round(utils.rv(utils.rv(utils.ri(3, 9), [2, 5], .33), [2, 5], .1));
        if (utils.rf() < utils.rv(.2, [.5, 1], .3)) {
          const duration = .25 * utils.ri(1, 6) * this.sustain / Math.max(1, numStutters);
          const isFadeIn = utils.rf() < 0.5;
          const decay = utils.rf(.75, 1.25);

          for (let i = 0; i < numStutters; i++) {
            const tick = this.on + duration * i;
            let stutterNote = note;
            if (utils.rf() < .25) {
              const octaveShift = utils.ri(-3, 3) * 12;
              stutterNote = Utils.modClamp(note + octaveShift, utils.m.max(0, (ctx.state as any).OCTAVE?.min * 12 - 1 || 0), (ctx.state as any).OCTAVE?.max * 12 - 1 || 127);
            }
            let currentVelocity = 64;
            if (isFadeIn) {
              const fadeInMultiplier = decay * (i / (numStutters * utils.rf(0.4, 2.2) - 1));
              currentVelocity = utils.clamp(utils.m.min(127, utils.ri(33) + 127 * fadeInMultiplier), 0, 127);
            } else {
              const fadeOutMultiplier = 1 - (decay * (i / (numStutters * utils.rf(0.4, 2.2) - 1)));
              currentVelocity = utils.clamp(utils.m.max(0, utils.ri(33) + 127 * fadeOutMultiplier), 0, 127);
            }
            pushEvent(ctx, { tick: tick - duration * utils.rf(.15), vals: [sourceCH, stutterNote] });
            pushEvent(ctx, { tick: tick + duration * utils.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === cCH1 ? currentVelocity * utils.rf(.3, .7) : currentVelocity * utils.rf(.45, .8)] });
          }
          pushEvent(ctx, { tick: this.on + this.sustain * utils.rf(.5, 1.5), vals: [sourceCH, note] });
        }

        // Per-channel second stutter
        if (utils.rf() < utils.rv(.07, [.5, 1], .2)) {
          const numStutters2 = utils.m.round(utils.rv(utils.rv(utils.ri(2, 7), [2, 5], .33), [2, 5], .1));
          const duration2 = .25 * utils.ri(1, 5) * this.sustain / Math.max(1, numStutters2);
          for (let i = 0; i < numStutters2; i++) {
            const tick = this.on + duration2 * i;
            let stutterNote = note;
            if (utils.rf() < .15) {
              const octaveShift = utils.ri(-3, 3) * 12;
              stutterNote = Utils.modClamp(note + octaveShift, utils.m.max(0, (ctx.state as any).OCTAVE?.min * 12 - 1 || 0), (ctx.state as any).OCTAVE?.max * 12 - 1 || 127);
            }
            if (utils.rf() < .6) {
              pushEvent(ctx, { tick: tick - duration2 * utils.rf(.15), vals: [sourceCH, stutterNote] });
              pushEvent(ctx, { tick: tick + duration2 * utils.rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === cCH1 ? state.velocity * utils.rf(.3, .7) : this.binVel * utils.rf(.45, .8)] });
            }
          }
          pushEvent(ctx, { tick: this.on + this.sustain * utils.rf(.5, 1.5), vals: [sourceCH, note] });
        }

        // Reflection
        const reflectionCH = reflect[sourceCH];
        pushEvent(ctx, { tick: reflectionCH === cCH2 ? this.on + utils.rv(state.tpSubdiv * utils.rf(.2), [-.01, .1], .5) : this.on + utils.rv(state.tpSubdiv * utils.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === cCH2 ? state.velocity * utils.rf(.5, .8) : this.binVel * utils.rf(.55, .9)] });
        pushEvent(ctx, { tick: this.on + this.sustain * (reflectionCH === cCH2 ? utils.rf(.7, 1.2) : utils.rv(utils.rf(.65, 1.3))), vals: [reflectionCH, note] });

        // Bass
        if (utils.rf() < utils.clamp(.35 * state.bpmRatio3, .2, .7)) {
          const bassCH = reflect2[sourceCH];
          const bassNote = Utils.modClamp(note, 12, 35);
          // Debug: emit log when probabilistic bass is generated (helps test troubleshooting)
          try { if (getPolychronContext().test?.enableLogging) console.error('[PlayNotes.playNotes2] emitting bass', { sourceCH, bassCH, threshold: utils.clamp(.35 * state.bpmRatio3, .2, .7) }); } catch (_e) {}
          pushEvent(ctx, { tick: bassCH === cCH3 ? this.on + utils.rv(state.tpSubsubdiv * utils.rf(.1), [-.01, .1], .5) : this.on + utils.rv(state.tpSubsubdiv * utils.rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === cCH3 ? state.velocity * utils.rf(1.15, 1.35) : this.binVel * utils.rf(1.85, 2.45)] });
          pushEvent(ctx, { tick: this.on + this.sustain * (bassCH === cCH3 ? utils.rf(1.1, 3) : utils.rv(utils.rf(.8, 3.5))), vals: [bassCH, bassNote] });
        }
      });
    });
  }
```

<!-- END: snippet:PlayNotes_playNotes2 -->

#### `crossModulateRhythms()`

Calculate cross-modulation across beat/division/subdivision rhythms for probabilistic note on/off.

<!-- BEGIN: snippet:PlayNotes_crossModulateRhythms -->

```typescript
crossModulateRhythms(ctx: ICompositionContext): void {
    if (!ctx) throw new Error('PlayNotes.crossModulateRhythms requires an ICompositionContext (DI-only)');
    const state = ctx.state as any;
    const utils = (ctx as any).utils ?? (getPolychronContext().utils as any);

    this.lastCrossMod = this.crossModulation;
    this.crossModulation = (
      (state.beatRhythm[state.beatIndex] > 0 ? utils.rf(1.6, 3.2) * 1.25 : utils.m.max(utils.rf(.5, .95), (state.beatsOff) / (state.numerator * state.numerator))) +
      (state.divRhythm[state.divIndex] > 0 ? utils.rf(1.1, 2.1) * 1.15 : utils.m.max(utils.rf(.4, .9), (state.divsOff) / (state.divsPerBeat * state.divsPerBeat))) +
      (state.subdivRhythm[state.subdivIndex] > 0 ? utils.rf(.6, 1.2) * 1.15 : utils.m.max(utils.rf(.2, .4), (state.subdivsOff) / (state.subdivsPerDiv * state.subdivsPerDiv)))
    ) +
      (this.subdivsOn < utils.ri(7, 15) ? utils.rf(.1, .3) : utils.rf(-.1)) + (this.subdivsOff > utils.ri() ? utils.rf(.1, .3) : utils.rf(-.1)) +
      (state.divsOn < utils.ri(9, 15) ? utils.rf(.1, .3) : utils.rf(-.1)) + (state.divsOff > utils.ri(3, 7) ? utils.rf(.1, .3) : utils.rf(-.1)) +
      (state.beatsOn < utils.ri(3) ? utils.rf(.1, .3) : utils.rf(-.1)) + (state.beatsOff > utils.ri(3) ? utils.rf(.1, .3) : utils.rf(-.1)) +
      (this.subdivsOn > utils.ri(7, 15) ? utils.rf(-.3, -.5) : utils.rf(.1)) + (this.subdivsOff < utils.ri() ? utils.rf(-.3, -.5) : utils.rf(.1)) +
      (state.divsOn > utils.ri(9, 15) ? utils.rf(-.2, -.4) : utils.rf(.1)) + (state.divsOff < utils.ri(3, 7) ? utils.rf(-.2, -.4) : utils.rf(.1)) +
      (state.beatsOn > utils.ri(3) ? utils.rf(-.2, -.3) : utils.rf(.1)) + (state.beatsOff < utils.ri(3) ? utils.rf(-.1, -.3) : utils.rf(.1)) +
      (state.subdivsPerMinute > utils.ri(400, 600) ? utils.rf(-.4, -.6) : utils.rf(.1)) + (this.subdivsOn * utils.rf(-.005, -.015)) + (state.beatRhythm[state.beatIndex] < 1 ? utils.rf(.4, .5) : 0) + (state.divRhythm[state.divIndex] < 1 ? utils.rf(.3, .4) : 0) + (state.subdivRhythm[state.subdivIndex] < 1 ? utils.rf(.2, .3) : 0);
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
