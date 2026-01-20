# stage.ts - Audio Processing & MIDI Event Generation Engine

> **Status**: Core Audio Engine  
> **Dependencies**: fxManager, PlayNotes, CompositionContext, all output/timing modules


## Overview

`stage.ts` contains the `Stage` class, the main audio processing engine that manages MIDI event generation, binaural beat shifting, stutter effects, balance/pan randomization, and FX parameter automation. It delegates note generation to `PlayNotes` while managing all stage-level effects and instrument routing.

**Core Responsibilities:**
- Initialize instruments with tuning, programs, and pitch bends
- Manage binaural beat shifts with frequency offsets and volume crossfades
- Apply stutter effects (fade, pan, FX) to channels via fxManager
- Set and randomize balance, pan, and FX parameters per beat
- Route notes to source/reflection/bass channels with random variation
- Delegate subdivision-level and sub-subdivision-level note generation to PlayNotes

---

## Architecture

The Stage encapsulates all effects that happen at beat/measure boundaries:

1. **setTuningAndInstruments()** – Initialize all channels with programs, pan, pitch bend for tuning
2. **setOtherInstruments()** – Probabilistically update binaural and drum instruments
3. **setBinaural()** – Manage binaural beat shifts (frequency offset, volume fades, pitch bend)
4. **setBalanceAndFX()** – Set pan/balance/FX parameters for all channels per beat
5. **stutterFade/stutterPan/stutterFX()** – Apply rapid FX to subsets of channels
6. **playNotes() / playNotes2()** – Generate actual note events via PlayNotes handler

---

## API

### `class Stage`

Audio processing engine with effect management.

<!-- BEGIN: snippet:Stage -->

```typescript
export class Stage {
  // FX Manager for stutter effects
  private fx: any;

  // PlayNotes handler for note generation (public for testing)
  public playNotesHandler: PlayNotes;

  // Balance and FX state
  private firstLoop: number;
  private balOffset: number;
  private sideBias: number;
  private lBal: number;
  private rBal: number;
  private cBal: number;
  private cBal2: number;
  private cBal3: number;
  private refVar: number;
  private bassVar: number;

  constructor(fxManager: any = (globalThis as any).fxManager) {
    // FX Manager for stutter effects (dependency injected or fallback to global)
    this.fx = fxManager;

    // PlayNotes handler for note generation
    this.playNotesHandler = new PlayNotes();

    // Balance and FX state
    this.firstLoop = 0;
    this.balOffset = 0;
    this.sideBias = 0;
    this.lBal = 0;
    this.rBal = 127;
    this.cBal = 64;
    this.cBal2 = 64;
    this.cBal3 = 64;
    this.refVar = 1;
    this.bassVar = 0;
  }

  /**
   * Sets program, pitch bend, and volume for all instrument channels
   * @returns {void}
   */
  setTuningAndInstruments(): void {
    const primaryProg = globalThis.getMidiValue('program', globalThis.primaryInstrument);
    const secondaryProg = globalThis.getMidiValue('program', globalThis.secondaryInstrument);
    const bassProg = globalThis.getMidiValue('program', globalThis.bassInstrument);
    const bass2Prog = globalThis.getMidiValue('program', globalThis.bassInstrument2);

    globalThis.p(globalThis.c,...['control_c','program_c'].flatMap((type: string) => [ ...globalThis.source.map((ch: number) => ({
    type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [primaryProg]) : (type==='control_c' ? [10,127] : [primaryProg]))]})), ...globalThis.reflection.map((ch: number) => ({
    type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [secondaryProg]) : (type==='control_c' ? [10,127] : [secondaryProg]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH1,...(type==='control_c' ? [globalThis.tuningPitchBend] : [primaryProg])]}, { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH2,...(type==='control_c' ? [globalThis.tuningPitchBend] : [secondaryProg])]}]));

    globalThis.p(globalThis.c,...['control_c','program_c'].flatMap((type: string) => [ ...globalThis.bass.map((ch: number) => ({
      type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [bassProg]) : (type==='control_c' ? [10,127] : [bass2Prog]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH3,...(type==='control_c' ? [globalThis.tuningPitchBend] : [bassProg])]}]));
    globalThis.p(globalThis.c,{type:'control_c', vals:[globalThis.drumCH, 7, 127]});
  }

  /**
   * Randomly updates binaural beat instruments and FX on beat shifts
   * @returns {void}
   */
  setOtherInstruments(ctx: ICompositionContext): void {
    const g = globalThis as any;
    const beatCount = ctx.state.beatCount;
    const beatsUntilBinauralShift = ctx.state.beatsUntilBinauralShift;
    const beatStart = ctx.state.beatStart;

    if (g.rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
      g.p(g.c, ...['control_c'].flatMap(() => {
        const tmp = { tick: beatStart, type: 'program_c' };
        return [
          ...g.reflectionBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherInstruments)] })),
          ...g.bassBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherBassInstruments)] })),
          { ...tmp, vals: [g.drumCH, g.ra(g.drumSets)] }
        ];
      }));
    }
  }

  /**
   * Manages binaural beat pitch shifts and volume crossfades at beat boundaries
   * @returns {void}
   */
  setBinaural(ctx: ICompositionContext): void {
    const g = globalThis as any;
    const state = ctx.state;
    const beatCount = state.beatCount;
    const beatsUntilBinauralShift = state.beatsUntilBinauralShift;
    const beatStart = state.beatStart;
    const numerator = state.numerator;
    const bpmRatio3 = state.bpmRatio3;
    const tpSec = state.tpSec;
    let flipBin = state.flipBin;
    let binauralFreqOffset = state.binauralFreqOffset;

    if (beatCount === beatsUntilBinauralShift || this.firstLoop < 1) {
      const nextBeatCount = 0;
      const nextFlipBin = !flipBin;
      const nextBeatsUntil = g.ri(numerator, numerator * 2 * bpmRatio3);
      const nextBinauralFreqOffset = g.rl(binauralFreqOffset, -1, 1, g.BINAURAL.min, g.BINAURAL.max);

      state.beatCount = nextBeatCount;
      state.flipBin = nextFlipBin;
      state.beatsUntilBinauralShift = nextBeatsUntil;
      state.binauralFreqOffset = nextBinauralFreqOffset;

      flipBin = nextFlipBin;
      binauralFreqOffset = nextBinauralFreqOffset;

      g.allNotesOff(beatStart);
      g.p(g.c,
        ...g.binauralL.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.lCH1 || ch === g.lCH3 || ch === g.lCH5 ? (flipBin ? g.binauralMinus : g.binauralPlus) : (flipBin ? g.binauralPlus : g.binauralMinus)] })),
        ...g.binauralR.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.rCH1 || ch === g.rCH3 || ch === g.rCH5 ? (flipBin ? g.binauralPlus : g.binauralMinus) : (flipBin ? g.binauralMinus : g.binauralPlus)] })),
      );
      // flipBin (flip binaural) volume transition
      const startTick = beatStart - tpSec / 4;
      const endTick = beatStart + tpSec / 4;
      const steps = 10;
      const tickIncrement = (endTick - startTick) / steps;
      for (let i = steps / 2 - 1; i <= steps; i++) {
        const tick = startTick + tickIncrement * i;
        const currentVolumeF2 = flipBin ? g.m.floor(100 * (1 - (i / steps))) : g.m.floor(100 * (i / steps));
        const currentVolumeT2 = flipBin ? g.m.floor(100 * (i / steps)) : g.m.floor(100 * (1 - (i / steps)));
        const maxVol = g.rf(.9, 1.2);
        g.flipBinF2.forEach((ch: number) => {
          g.p(g.c, { tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeF2 * maxVol)] });
        });
        g.flipBinT2.forEach((ch: number) => {
          g.p(g.c, { tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeT2 * maxVol)] });
        });
      }
    }
  }

  /**
   * Applies rapid volume stutter/fade effect to selected channels (delegates to FxManager)
   * @param channels - Array of channel numbers to potentially stutter
   * @param numStutters - Number of stutter events
   * @param duration - Duration of stutter effect in ticks
   * @returns {void}
   */
  stutterFade(channels: number[], ctx: ICompositionContext, numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    const resolvedNumStutters = numStutters ?? g.ri(10, 70);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * g.rf(.2, 1.5);
    this.fx.stutterFade(channels, resolvedNumStutters, resolvedDuration);
  }

  /**
   * Applies rapid pan stutter effect to selected channels (delegates to FxManager)
   * @param channels - Array of channel numbers to potentially stutter
   * @param numStutters - Number of stutter events
   * @param duration - Duration of stutter effect in ticks
   * @returns {void}
   */
  stutterPan(channels: number[], ctx: ICompositionContext, numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    const resolvedNumStutters = numStutters ?? g.ri(30, 90);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * g.rf(.1, 1.2);
    this.fx.stutterPan(channels, resolvedNumStutters, resolvedDuration);
  }

  /**
   * Applies rapid FX parameter stutter effect to selected channels (delegates to FxManager)
   * @param channels - Array of channel numbers to potentially stutter
   * @param numStutters - Number of stutter events
   * @param duration - Duration of stutter effect in ticks
   * @returns {void}
   */
  stutterFX(channels: number[], ctx: ICompositionContext, numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    const resolvedNumStutters = numStutters ?? g.ri(30, 100);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * g.rf(.1, 2);
    this.fx.stutterFX(channels, resolvedNumStutters, resolvedDuration);
  }

  /**
   * Sets pan positions, balance offsets, and detailed FX parameters for all channels
   * @returns {void}
   */
  setBalanceAndFX(ctx: ICompositionContext): void {
    const g = globalThis as any;
    const beatStart = ctx.state.beatStart;
    const beatCount = ctx.state.beatCount;
    const beatsUntilBinauralShift = ctx.state.beatsUntilBinauralShift;
    const bpmRatio3 = ctx.state.bpmRatio3;
    const flipBin = ctx.state.flipBin;

    if (g.rf() < .5 * bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
      this.firstLoop = 1;
      this.balOffset = g.rl(this.balOffset, -4, 4, 0, 45);
      this.sideBias = g.rl(this.sideBias, -2, 2, -20, 20);
      this.lBal = g.m.max(0, g.m.min(54, this.balOffset + g.ri(3) + this.sideBias));
      this.rBal = g.m.min(127, g.m.max(74, 127 - this.balOffset - g.ri(3) + this.sideBias));
      this.cBal = g.m.min(96, (g.m.max(32, 64 + g.m.round(g.rv(this.balOffset / g.ri(2, 3))) * (g.rf() < .5 ? -1 : 1) + this.sideBias)));
      this.refVar = g.ri(1, 10);
      this.cBal2 = g.rf() < .5 ? this.cBal + g.m.round(this.refVar * .5) : this.cBal + g.m.round(this.refVar * -.5);
      this.bassVar = this.refVar * g.rf(-2, 2);
      this.cBal3 = g.rf() < .5 ? this.cBal2 + g.m.round(this.bassVar * .5) : this.cBal2 + g.m.round(this.bassVar * -.5);
      g.p(g.c, ...['control_c'].flatMap(() => {
        const tmp = { tick: beatStart - 1, type: 'control_c' }; _ = tmp;
        return [
          ...g.source2.map((ch: number) => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? this.lBal : this.rBal) : ch.toString().startsWith('rCH') ? (flipBin ? this.rBal : this.lBal) : ch === g.drumCH ? this.cBal3 + g.m.round((g.rf(-.5, .5) * this.bassVar)) : this.cBal] })),
          ...g.reflection.map((ch: number) => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? (g.rf() < .1 ? this.lBal + this.refVar * 2 : this.lBal + this.refVar) : (g.rf() < .1 ? this.rBal - this.refVar * 2 : this.rBal - this.refVar)) : ch.toString().startsWith('rCH') ? (flipBin ? (g.rf() < .1 ? this.rBal - this.refVar * 2 : this.rBal - this.refVar) : (g.rf() < .1 ? this.lBal + this.refVar * 2 : this.lBal + this.refVar)) : this.cBal2 + g.m.round((g.rf(-.5, .5) * this.refVar)) ] })),
          ...g.bass.map((ch: number) => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? this.lBal + this.bassVar : this.rBal - this.bassVar) : ch.toString().startsWith('rCH') ? (flipBin ? this.rBal - this.bassVar : this.lBal + this.bassVar) : this.cBal3 + g.m.round((g.rf(-.5, .5) * this.bassVar)) ] })),
          ...g.source2.map((ch: number) => g.rlFX(ch, 1, 0, 60, (c: number) => c === g.cCH1, 0, 10)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 5, 125, 127, (c: number) => c === g.cCH1, 126, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 11, 64, 127, (c: number) => c === g.cCH1 || c === g.drumCH, 115, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 65, 45, 64, (c: number) => c === g.cCH1, 35, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 67, 63, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 68, 63, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 69, 63, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 70, 0, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 71, 0, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 72, 64, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 73, 0, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 74, 80, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 91, 0, 33)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 92, 0, 33)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 93, 0, 33)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 94, 0, 5, (c: number) => c === g.drumCH, 0, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 95, 0, 33)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 1, 0, 90, (c: number) => c === g.cCH2, 0, 15)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 5, 125, 127, (c: number) => c === g.cCH2, 126, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 11, 77, 111, (c: number) => c === g.cCH2, 66, 99)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 65, 45, 64, (c: number) => c === g.cCH2, 35, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 67, 63, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 68, 63, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 69, 63, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 70, 0, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 71, 0, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 72, 64, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 73, 0, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 74, 80, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 91, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 92, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 93, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 94, 0, 64, (c: number) => c === g.cCH2, 0, 11)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 95, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 1, 0, 60, (c: number) => c === g.cCH3, 0, 10)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 5, 125, 127, (c: number) => c === g.cCH3, 126, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 11, 88, 127, (c: number) => c === g.cCH3, 115, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 65, 45, 64, (c: number) => c === g.cCH3, 35, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 67, 63, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 68, 63, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 69, 63, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 70, 0, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 71, 0, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 72, 64, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 73, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 74, 80, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 91, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 92, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 93, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 94, 0, 64, (c: number) => c === g.cCH3, 0, 11)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 95, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
        ];
      }));
    }
  }

  /**
   * Calculates cross-modulation value based on rhythm state across all levels
   * Delegates to PlayNotes handler
   * @returns {void}
   */
  crossModulateRhythms(): void {
    this.playNotesHandler.crossModulateRhythms();
  }

  /**
   * Calculates note timing and sustain parameters for subdivision-based notes
   * Delegates to PlayNotes handler
   * @returns {void}
   */
  setNoteParams(): void {
    this.playNotesHandler.setNoteParams();
  }

  /**
   * Generates MIDI note events for source channels (subdivision-based timing)
   * Delegates to PlayNotes handler
   * @returns {void}
   */
  playNotes(): void {
    this.playNotesHandler.playNotes();
  }

  /**
   * Calculates note timing and sustain parameters for subsubdivision-based notes
   * Delegates to PlayNotes handler
   * @returns {void}
   */
  setNoteParams2(): void {
    this.playNotesHandler.setNoteParams2();
  }

  /**
   * Generates MIDI note events with complex stutter/shift effects (subsubdivision-based timing)
   * Delegates to PlayNotes handler
   * @returns {void}
   */
  playNotes2(): void {
    this.playNotesHandler.playNotes2();
  }
}
```

<!-- END: snippet:Stage -->

#### Constructor

```typescript
constructor(fxManager?: any)
```

Dependency-inject fxManager or fall back to global instance.

#### `setTuningAndInstruments()`

Initialize all instrument channels with programs, pan, and tuning pitch bend.

<!-- BEGIN: snippet:Stage_setTuningAndInstruments -->

```typescript
setTuningAndInstruments(): void {
    const primaryProg = globalThis.getMidiValue('program', globalThis.primaryInstrument);
    const secondaryProg = globalThis.getMidiValue('program', globalThis.secondaryInstrument);
    const bassProg = globalThis.getMidiValue('program', globalThis.bassInstrument);
    const bass2Prog = globalThis.getMidiValue('program', globalThis.bassInstrument2);

    globalThis.p(globalThis.c,...['control_c','program_c'].flatMap((type: string) => [ ...globalThis.source.map((ch: number) => ({
    type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [primaryProg]) : (type==='control_c' ? [10,127] : [primaryProg]))]})), ...globalThis.reflection.map((ch: number) => ({
    type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [secondaryProg]) : (type==='control_c' ? [10,127] : [secondaryProg]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH1,...(type==='control_c' ? [globalThis.tuningPitchBend] : [primaryProg])]}, { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH2,...(type==='control_c' ? [globalThis.tuningPitchBend] : [secondaryProg])]}]));

    globalThis.p(globalThis.c,...['control_c','program_c'].flatMap((type: string) => [ ...globalThis.bass.map((ch: number) => ({
      type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [bassProg]) : (type==='control_c' ? [10,127] : [bass2Prog]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH3,...(type==='control_c' ? [globalThis.tuningPitchBend] : [bassProg])]}]));
    globalThis.p(globalThis.c,{type:'control_c', vals:[globalThis.drumCH, 7, 127]});
  }
```

<!-- END: snippet:Stage_setTuningAndInstruments -->

#### `setOtherInstruments(ctx)`

Probabilistically update binaural/drum instruments on 30% chance or binaural shift.

<!-- BEGIN: snippet:Stage_setOtherInstruments -->

```typescript
setOtherInstruments(ctx: ICompositionContext): void {
    const g = globalThis as any;
    const beatCount = ctx.state.beatCount;
    const beatsUntilBinauralShift = ctx.state.beatsUntilBinauralShift;
    const beatStart = ctx.state.beatStart;

    if (g.rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
      g.p(g.c, ...['control_c'].flatMap(() => {
        const tmp = { tick: beatStart, type: 'program_c' };
        return [
          ...g.reflectionBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherInstruments)] })),
          ...g.bassBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherBassInstruments)] })),
          { ...tmp, vals: [g.drumCH, g.ra(g.drumSets)] }
        ];
      }));
    }
  }
```

<!-- END: snippet:Stage_setOtherInstruments -->

#### `setBinaural(ctx)`

Manage binaural frequency shifts, pitch bend modulation, and volume crossfades.

<!-- BEGIN: snippet:Stage_setBinaural -->

```typescript
setBinaural(ctx: ICompositionContext): void {
    const g = globalThis as any;
    const state = ctx.state;
    const beatCount = state.beatCount;
    const beatsUntilBinauralShift = state.beatsUntilBinauralShift;
    const beatStart = state.beatStart;
    const numerator = state.numerator;
    const bpmRatio3 = state.bpmRatio3;
    const tpSec = state.tpSec;
    let flipBin = state.flipBin;
    let binauralFreqOffset = state.binauralFreqOffset;

    if (beatCount === beatsUntilBinauralShift || this.firstLoop < 1) {
      const nextBeatCount = 0;
      const nextFlipBin = !flipBin;
      const nextBeatsUntil = g.ri(numerator, numerator * 2 * bpmRatio3);
      const nextBinauralFreqOffset = g.rl(binauralFreqOffset, -1, 1, g.BINAURAL.min, g.BINAURAL.max);

      state.beatCount = nextBeatCount;
      state.flipBin = nextFlipBin;
      state.beatsUntilBinauralShift = nextBeatsUntil;
      state.binauralFreqOffset = nextBinauralFreqOffset;

      flipBin = nextFlipBin;
      binauralFreqOffset = nextBinauralFreqOffset;

      g.allNotesOff(beatStart);
      g.p(g.c,
        ...g.binauralL.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.lCH1 || ch === g.lCH3 || ch === g.lCH5 ? (flipBin ? g.binauralMinus : g.binauralPlus) : (flipBin ? g.binauralPlus : g.binauralMinus)] })),
        ...g.binauralR.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.rCH1 || ch === g.rCH3 || ch === g.rCH5 ? (flipBin ? g.binauralPlus : g.binauralMinus) : (flipBin ? g.binauralMinus : g.binauralPlus)] })),
      );
      // flipBin (flip binaural) volume transition
      const startTick = beatStart - tpSec / 4;
      const endTick = beatStart + tpSec / 4;
      const steps = 10;
      const tickIncrement = (endTick - startTick) / steps;
      for (let i = steps / 2 - 1; i <= steps; i++) {
        const tick = startTick + tickIncrement * i;
        const currentVolumeF2 = flipBin ? g.m.floor(100 * (1 - (i / steps))) : g.m.floor(100 * (i / steps));
        const currentVolumeT2 = flipBin ? g.m.floor(100 * (i / steps)) : g.m.floor(100 * (1 - (i / steps)));
        const maxVol = g.rf(.9, 1.2);
        g.flipBinF2.forEach((ch: number) => {
          g.p(g.c, { tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeF2 * maxVol)] });
        });
        g.flipBinT2.forEach((ch: number) => {
          g.p(g.c, { tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeT2 * maxVol)] });
        });
      }
    }
  }
```

<!-- END: snippet:Stage_setBinaural -->

#### `setBalanceAndFX(ctx)`

Set pan/balance offsets and FX parameters (CC1, CC5, CC11, CC65-74, CC91-95) for all channels.

<!-- BEGIN: snippet:Stage_setBalanceAndFX -->

```typescript
setBalanceAndFX(ctx: ICompositionContext): void {
    const g = globalThis as any;
    const beatStart = ctx.state.beatStart;
    const beatCount = ctx.state.beatCount;
    const beatsUntilBinauralShift = ctx.state.beatsUntilBinauralShift;
    const bpmRatio3 = ctx.state.bpmRatio3;
    const flipBin = ctx.state.flipBin;

    if (g.rf() < .5 * bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
      this.firstLoop = 1;
      this.balOffset = g.rl(this.balOffset, -4, 4, 0, 45);
      this.sideBias = g.rl(this.sideBias, -2, 2, -20, 20);
      this.lBal = g.m.max(0, g.m.min(54, this.balOffset + g.ri(3) + this.sideBias));
      this.rBal = g.m.min(127, g.m.max(74, 127 - this.balOffset - g.ri(3) + this.sideBias));
      this.cBal = g.m.min(96, (g.m.max(32, 64 + g.m.round(g.rv(this.balOffset / g.ri(2, 3))) * (g.rf() < .5 ? -1 : 1) + this.sideBias)));
      this.refVar = g.ri(1, 10);
      this.cBal2 = g.rf() < .5 ? this.cBal + g.m.round(this.refVar * .5) : this.cBal + g.m.round(this.refVar * -.5);
      this.bassVar = this.refVar * g.rf(-2, 2);
      this.cBal3 = g.rf() < .5 ? this.cBal2 + g.m.round(this.bassVar * .5) : this.cBal2 + g.m.round(this.bassVar * -.5);
      g.p(g.c, ...['control_c'].flatMap(() => {
        const tmp = { tick: beatStart - 1, type: 'control_c' }; _ = tmp;
        return [
          ...g.source2.map((ch: number) => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? this.lBal : this.rBal) : ch.toString().startsWith('rCH') ? (flipBin ? this.rBal : this.lBal) : ch === g.drumCH ? this.cBal3 + g.m.round((g.rf(-.5, .5) * this.bassVar)) : this.cBal] })),
          ...g.reflection.map((ch: number) => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? (g.rf() < .1 ? this.lBal + this.refVar * 2 : this.lBal + this.refVar) : (g.rf() < .1 ? this.rBal - this.refVar * 2 : this.rBal - this.refVar)) : ch.toString().startsWith('rCH') ? (flipBin ? (g.rf() < .1 ? this.rBal - this.refVar * 2 : this.rBal - this.refVar) : (g.rf() < .1 ? this.lBal + this.refVar * 2 : this.lBal + this.refVar)) : this.cBal2 + g.m.round((g.rf(-.5, .5) * this.refVar)) ] })),
          ...g.bass.map((ch: number) => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? this.lBal + this.bassVar : this.rBal - this.bassVar) : ch.toString().startsWith('rCH') ? (flipBin ? this.rBal - this.bassVar : this.lBal + this.bassVar) : this.cBal3 + g.m.round((g.rf(-.5, .5) * this.bassVar)) ] })),
          ...g.source2.map((ch: number) => g.rlFX(ch, 1, 0, 60, (c: number) => c === g.cCH1, 0, 10)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 5, 125, 127, (c: number) => c === g.cCH1, 126, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 11, 64, 127, (c: number) => c === g.cCH1 || c === g.drumCH, 115, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 65, 45, 64, (c: number) => c === g.cCH1, 35, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 67, 63, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 68, 63, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 69, 63, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 70, 0, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 71, 0, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 72, 64, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 73, 0, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 74, 80, 127)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 91, 0, 33)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 92, 0, 33)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 93, 0, 33)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 94, 0, 5, (c: number) => c === g.drumCH, 0, 64)),
          ...g.source2.map((ch: number) => g.rlFX(ch, 95, 0, 33)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 1, 0, 90, (c: number) => c === g.cCH2, 0, 15)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 5, 125, 127, (c: number) => c === g.cCH2, 126, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 11, 77, 111, (c: number) => c === g.cCH2, 66, 99)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 65, 45, 64, (c: number) => c === g.cCH2, 35, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 67, 63, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 68, 63, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 69, 63, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 70, 0, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 71, 0, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 72, 64, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 73, 0, 64)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 74, 80, 127)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 91, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 92, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 93, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 94, 0, 64, (c: number) => c === g.cCH2, 0, 11)),
          ...g.reflection.map((ch: number) => g.rlFX(ch, 95, 0, 77, (c: number) => c === g.cCH2, 0, 32)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 1, 0, 60, (c: number) => c === g.cCH3, 0, 10)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 5, 125, 127, (c: number) => c === g.cCH3, 126, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 11, 88, 127, (c: number) => c === g.cCH3, 115, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 65, 45, 64, (c: number) => c === g.cCH3, 35, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 67, 63, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 68, 63, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 69, 63, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 70, 0, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 71, 0, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 72, 64, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 73, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 74, 80, 127)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 91, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 92, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 93, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 94, 0, 64, (c: number) => c === g.cCH3, 0, 11)),
          ...g.bass.map((ch: number) => g.rlFX(ch, 95, 0, 99, (c: number) => c === g.cCH3, 0, 64)),
        ];
      }));
    }
  }
```

<!-- END: snippet:Stage_setBalanceAndFX -->

#### `stutterFade(channels, ctx, numStutters?, duration?)`

Apply volume stutter/fade effect (delegates to fxManager).

<!-- BEGIN: snippet:Stage_stutterFade -->

```typescript
stutterFade(channels: number[], ctx: ICompositionContext, numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    const resolvedNumStutters = numStutters ?? g.ri(10, 70);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * g.rf(.2, 1.5);
    this.fx.stutterFade(channels, resolvedNumStutters, resolvedDuration);
  }
```

<!-- END: snippet:Stage_stutterFade -->

#### `stutterPan(channels, ctx, numStutters?, duration?)`

Apply pan stutter effect (delegates to fxManager).

<!-- BEGIN: snippet:Stage_stutterPan -->

```typescript
stutterPan(channels: number[], ctx: ICompositionContext, numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    const resolvedNumStutters = numStutters ?? g.ri(30, 90);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * g.rf(.1, 1.2);
    this.fx.stutterPan(channels, resolvedNumStutters, resolvedDuration);
  }
```

<!-- END: snippet:Stage_stutterPan -->

#### `stutterFX(channels, ctx, numStutters?, duration?)`

Apply FX parameter stutter effect (delegates to fxManager).

<!-- BEGIN: snippet:Stage_stutterFX -->

```typescript
stutterFX(channels: number[], ctx: ICompositionContext, numStutters?: number, duration?: number): void {
    const g = globalThis as any;
    const resolvedNumStutters = numStutters ?? g.ri(30, 100);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * g.rf(.1, 2);
    this.fx.stutterFX(channels, resolvedNumStutters, resolvedDuration);
  }
```

<!-- END: snippet:Stage_stutterFX -->

#### `playNotes()`

Generate subdivision-level note events (delegates to PlayNotes).

<!-- BEGIN: snippet:Stage_playNotes -->

```typescript
playNotes(): void {
    this.playNotesHandler.playNotes();
  }
```

<!-- END: snippet:Stage_playNotes -->

#### `playNotes2()`

Generate sub-subdivision-level note events with stutters (delegates to PlayNotes).

<!-- BEGIN: snippet:Stage_playNotes2 -->

```typescript
playNotes2(): void {
    this.playNotesHandler.playNotes2();
  }
```

<!-- END: snippet:Stage_playNotes2 -->

### State Properties

- `balOffset`, `sideBias` – Pan balance randomization
- `lBal`, `rBal`, `cBal`, `cBal2`, `cBal3` – Channel-specific balance values
- `refVar`, `bassVar` – Variation amplitudes for reflection/bass channels
- `flipBin` – Binaural phase flip flag
- `firstLoop` – One-time initialization flag

---

## FX Parameters Managed

Per beat, Stage sets CC values for each channel:

- **CC1** (Modulation) – 0-60 range with special handling for primary channels
- **CC5** (Portamento Time) – 125-127
- **CC11** (Expression) – 64-127 range
- **CC65-95** – Effect control parameters (sustain, sostenuto, modulation wheel, soft/hard pedal, pressure, timbre, etc.)

---

## Usage Example

```typescript
import { Stage } from '../src/stage';
import { fxManager } from '../src/fxManager';

const stage = new Stage(fxManager);
stage.setTuningAndInstruments();

// In composition loop at beat boundary:
for (let beatIndex = 0; beatIndex < numerator; beatIndex++) {
  stage.setOtherInstruments(ctx);
  stage.setBinaural(ctx);
  stage.setBalanceAndFX(ctx);
  stage.stutterFX(channels, ctx);
  stage.playNotes();  // subdivision-level notes
  stage.playNotes2(); // sub-subdivision-level with stutters
}
```

---

## Related Modules

- play.ts ([code](../src/play.ts)) ([doc](play.md)) - Orchestrates Stage calls in main loop
- playNotes.ts ([code](../src/playNotes.ts)) ([doc](playNotes.md)) - Generates actual MIDI notes
- fxManager.ts ([code](../src/fxManager.ts)) ([doc](fxManager.md)) - Provides stutter effects
- CompositionContext.ts ([code](../src/CompositionContext.ts)) ([doc](CompositionContext.md)) - Provides timing state
- writer.ts ([code](../src/writer.ts)) ([doc](writer.md)) - Emits MIDI events via global `p()` function
