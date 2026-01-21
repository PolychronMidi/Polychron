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
  setTuningAndInstruments(ctx: ICompositionContext): void {
    const getMidiValueFn = (ctx && ctx.container && ctx.container.has('getMidiValue')) ? ctx.container.get('getMidiValue') : (globalThis as any).getMidiValue;
    const primaryProg = getMidiValueFn('program', (globalThis as any).primaryInstrument);
    const secondaryProg = getMidiValueFn('program', (globalThis as any).secondaryInstrument);
    const bassProg = getMidiValueFn('program', (globalThis as any).bassInstrument);
    const bass2Prog = getMidiValueFn('program', (globalThis as any).bassInstrument2);

    const items1 = ['control_c','program_c'].flatMap((type: string) => [ ...(globalThis as any).source.map((ch: number) => ({
      type,vals:[ch,...((globalThis as any).binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [primaryProg]) : (type==='control_c' ? [10,127] : [primaryProg]))]})), ...(globalThis as any).reflection.map((ch: number) => ({
      type,vals:[ch,...((globalThis as any).binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [secondaryProg]) : (type==='control_c' ? [10,127] : [secondaryProg]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[(globalThis as any).cCH1,...(type==='control_c' ? [(globalThis as any).tuningPitchBend] : [primaryProg])]}, { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[(globalThis as any).cCH2,...(type==='control_c' ? [(globalThis as any).tuningPitchBend] : [secondaryProg])]}]);
    const pFn1 = requirePush(ctx);
    pFn1(ctx.csvBuffer, ...items1);

    const items2 = ['control_c','program_c'].flatMap((type: string) => [ ...(globalThis as any).bass.map((ch: number) => ({
      type,vals:[ch,...((globalThis as any).binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [bassProg]) : (type==='control_c' ? [10,127] : [bass2Prog]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[(globalThis as any).cCH3,...(type==='control_c' ? [(globalThis as any).tuningPitchBend] : [bassProg])]}]);
    const pFn2 = requirePush(ctx);
    pFn2(ctx.csvBuffer, ...items2);
    const pFn3 = requirePush(ctx);
    pFn3(ctx.csvBuffer, { type: 'control_c', vals: [(globalThis as any).drumCH, 7, 127] });
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
      const items = ['control_c'].flatMap(() => {
        const tmp = { tick: beatStart, type: 'program_c' };
        return [
          ...g.reflectionBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherInstruments)] })),
          ...g.bassBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherBassInstruments)] })),
          { ...tmp, vals: [g.drumCH, g.ra(g.drumSets)] }
        ];
      });
      const pFn = requirePush(ctx);
      pFn(ctx.csvBuffer, ...items);
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
      const itemsBend = [
        ...g.binauralL.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.lCH1 || ch === g.lCH3 || ch === g.lCH5 ? (flipBin ? g.binauralMinus : g.binauralPlus) : (flipBin ? g.binauralPlus : g.binauralMinus)] })),
        ...g.binauralR.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.rCH1 || ch === g.rCH3 || ch === g.rCH5 ? (flipBin ? g.binauralPlus : g.binauralMinus) : (flipBin ? g.binauralMinus : g.binauralPlus)] })),
      ];
      const pBend = requirePush(ctx);
      pBend(ctx.csvBuffer, ...itemsBend);
      // flipBin (flip binaural) volume change
      const startTick = beatStart - tpSec / 4;
      const endTick = beatStart + tpSec / 4;
      const steps = 10;
      const tickIncrement = (endTick - startTick) / steps;
      for (let i = steps / 2 - 1; i <= steps; i++) {
        const tick = startTick + tickIncrement * i;
        const currentVolumeF2 = flipBin ? g.m.floor(100 * (1 - (i / steps))) : g.m.floor(100 * (i / steps));
        const currentVolumeT2 = flipBin ? g.m.floor(100 * (i / steps)) : g.m.floor(100 * (1 - (i / steps)));
        const maxVol = g.rf(.9, 1.2);
        const itemsF = g.flipBinF2.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeF2 * maxVol)] }));
        const itemsT = g.flipBinT2.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeT2 * maxVol)] }));
        const pFade = requirePush(ctx);
        if (itemsF.length) pFade(ctx.csvBuffer, ...itemsF);
        if (itemsT.length) pFade(ctx.csvBuffer, ...itemsT);
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
    this.fx.stutterFade(channels, ctx, resolvedNumStutters, resolvedDuration);
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
    this.fx.stutterPan(channels, ctx, resolvedNumStutters, resolvedDuration);
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
    this.fx.stutterFX(channels, ctx, resolvedNumStutters, resolvedDuration);
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

      // Build FX control events (pan CC=10 and additional FX CCs) for channels
      const tick = beatStart - 1;
      const itemsFX: any[] = [];

      // Pan (CC 10) events for groups
      if (Array.isArray(g.source)) itemsFX.push(...g.source.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.lBal] })));
      if (Array.isArray(g.reflection)) itemsFX.push(...g.reflection.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.rBal] })));
      if (Array.isArray(g.bass)) itemsFX.push(...g.bass.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.cBal3] })));

      // Additional FX controls (CC 1,5,11,7) applied to source/reflection channels
      const fxCCs = [1, 5, 11, 7];
      if (Array.isArray(g.source)) {
        for (const ch of g.source) {
          for (const cc of fxCCs) {
            itemsFX.push({ tick, type: 'control_c', vals: [ch, cc, g.m.round(this.cBal2 * g.rf(.7, 1.3))] });
          }
        }
      }
      if (Array.isArray(g.reflection)) {
        for (const ch of g.reflection) {
          for (const cc of fxCCs) {
            itemsFX.push({ tick, type: 'control_c', vals: [ch, cc, g.m.round(this.cBal * g.rf(.7, 1.3))] });
          }
        }
      }

      const pFX = requirePush(ctx);
      if (itemsFX.length) pFX(ctx.csvBuffer, ...itemsFX);
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
  playNotes(ctx: ICompositionContext): void {
    this.playNotesHandler.playNotes(ctx);
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
  playNotes2(ctx: ICompositionContext): void {
    this.playNotesHandler.playNotes2(ctx);
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
setTuningAndInstruments(ctx: ICompositionContext): void {
    const getMidiValueFn = (ctx && ctx.container && ctx.container.has('getMidiValue')) ? ctx.container.get('getMidiValue') : (globalThis as any).getMidiValue;
    const primaryProg = getMidiValueFn('program', (globalThis as any).primaryInstrument);
    const secondaryProg = getMidiValueFn('program', (globalThis as any).secondaryInstrument);
    const bassProg = getMidiValueFn('program', (globalThis as any).bassInstrument);
    const bass2Prog = getMidiValueFn('program', (globalThis as any).bassInstrument2);

    const items1 = ['control_c','program_c'].flatMap((type: string) => [ ...(globalThis as any).source.map((ch: number) => ({
      type,vals:[ch,...((globalThis as any).binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [primaryProg]) : (type==='control_c' ? [10,127] : [primaryProg]))]})), ...(globalThis as any).reflection.map((ch: number) => ({
      type,vals:[ch,...((globalThis as any).binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [secondaryProg]) : (type==='control_c' ? [10,127] : [secondaryProg]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[(globalThis as any).cCH1,...(type==='control_c' ? [(globalThis as any).tuningPitchBend] : [primaryProg])]}, { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[(globalThis as any).cCH2,...(type==='control_c' ? [(globalThis as any).tuningPitchBend] : [secondaryProg])]}]);
    const pFn1 = requirePush(ctx);
    pFn1(ctx.csvBuffer, ...items1);

    const items2 = ['control_c','program_c'].flatMap((type: string) => [ ...(globalThis as any).bass.map((ch: number) => ({
      type,vals:[ch,...((globalThis as any).binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [bassProg]) : (type==='control_c' ? [10,127] : [bass2Prog]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[(globalThis as any).cCH3,...(type==='control_c' ? [(globalThis as any).tuningPitchBend] : [bassProg])]}]);
    const pFn2 = requirePush(ctx);
    pFn2(ctx.csvBuffer, ...items2);
    const pFn3 = requirePush(ctx);
    pFn3(ctx.csvBuffer, { type: 'control_c', vals: [(globalThis as any).drumCH, 7, 127] });
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
      const items = ['control_c'].flatMap(() => {
        const tmp = { tick: beatStart, type: 'program_c' };
        return [
          ...g.reflectionBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherInstruments)] })),
          ...g.bassBinaural.map((ch: number) => ({ ...tmp, vals: [ch, g.ra(g.otherBassInstruments)] })),
          { ...tmp, vals: [g.drumCH, g.ra(g.drumSets)] }
        ];
      });
      const pFn = requirePush(ctx);
      pFn(ctx.csvBuffer, ...items);
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
      const itemsBend = [
        ...g.binauralL.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.lCH1 || ch === g.lCH3 || ch === g.lCH5 ? (flipBin ? g.binauralMinus : g.binauralPlus) : (flipBin ? g.binauralPlus : g.binauralMinus)] })),
        ...g.binauralR.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === g.rCH1 || ch === g.rCH3 || ch === g.rCH5 ? (flipBin ? g.binauralPlus : g.binauralMinus) : (flipBin ? g.binauralMinus : g.binauralPlus)] })),
      ];
      const pBend = requirePush(ctx);
      pBend(ctx.csvBuffer, ...itemsBend);
      // flipBin (flip binaural) volume change
      const startTick = beatStart - tpSec / 4;
      const endTick = beatStart + tpSec / 4;
      const steps = 10;
      const tickIncrement = (endTick - startTick) / steps;
      for (let i = steps / 2 - 1; i <= steps; i++) {
        const tick = startTick + tickIncrement * i;
        const currentVolumeF2 = flipBin ? g.m.floor(100 * (1 - (i / steps))) : g.m.floor(100 * (i / steps));
        const currentVolumeT2 = flipBin ? g.m.floor(100 * (i / steps)) : g.m.floor(100 * (1 - (i / steps)));
        const maxVol = g.rf(.9, 1.2);
        const itemsF = g.flipBinF2.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeF2 * maxVol)] }));
        const itemsT = g.flipBinT2.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 7, g.m.round(currentVolumeT2 * maxVol)] }));
        const pFade = requirePush(ctx);
        if (itemsF.length) pFade(ctx.csvBuffer, ...itemsF);
        if (itemsT.length) pFade(ctx.csvBuffer, ...itemsT);
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

      // Build FX control events (pan CC=10 and additional FX CCs) for channels
      const tick = beatStart - 1;
      const itemsFX: any[] = [];

      // Pan (CC 10) events for groups
      if (Array.isArray(g.source)) itemsFX.push(...g.source.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.lBal] })));
      if (Array.isArray(g.reflection)) itemsFX.push(...g.reflection.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.rBal] })));
      if (Array.isArray(g.bass)) itemsFX.push(...g.bass.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.cBal3] })));

      // Additional FX controls (CC 1,5,11,7) applied to source/reflection channels
      const fxCCs = [1, 5, 11, 7];
      if (Array.isArray(g.source)) {
        for (const ch of g.source) {
          for (const cc of fxCCs) {
            itemsFX.push({ tick, type: 'control_c', vals: [ch, cc, g.m.round(this.cBal2 * g.rf(.7, 1.3))] });
          }
        }
      }
      if (Array.isArray(g.reflection)) {
        for (const ch of g.reflection) {
          for (const cc of fxCCs) {
            itemsFX.push({ tick, type: 'control_c', vals: [ch, cc, g.m.round(this.cBal * g.rf(.7, 1.3))] });
          }
        }
      }

      const pFX = requirePush(ctx);
      if (itemsFX.length) pFX(ctx.csvBuffer, ...itemsFX);
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
    this.fx.stutterFade(channels, ctx, resolvedNumStutters, resolvedDuration);
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
    this.fx.stutterPan(channels, ctx, resolvedNumStutters, resolvedDuration);
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
    this.fx.stutterFX(channels, ctx, resolvedNumStutters, resolvedDuration);
  }
```

<!-- END: snippet:Stage_stutterFX -->

#### `playNotes()`

Generate subdivision-level note events (delegates to PlayNotes).

<!-- BEGIN: snippet:Stage_playNotes -->

```typescript
playNotes(ctx: ICompositionContext): void {
    this.playNotesHandler.playNotes(ctx);
  }
```

<!-- END: snippet:Stage_playNotes -->

#### `playNotes2()`

Generate sub-subdivision-level note events with stutters (delegates to PlayNotes).

<!-- BEGIN: snippet:Stage_playNotes2 -->

```typescript
playNotes2(ctx: ICompositionContext): void {
    this.playNotesHandler.playNotes2(ctx);
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
