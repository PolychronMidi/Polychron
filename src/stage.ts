// stage.ts - Audio processing engine with MIDI event generation and binaural effects.
// TypeScript version with full type annotations
// minimalist comments, details at: stage.md

import './sheet.js';
import './writer.js';
import './venue.js';
import './backstage.js';
import './rhythm.js';
import './time.js';
import './composers.js';
import './motifs.js';
import './fxManager.js';
import { PlayNotes } from './playNotes.js';
import { ICompositionContext } from './CompositionContext.js';

// Module-scoped temporary variable for FX object spreading
import { requirePush } from './writer.js';

declare const globalThis: any;
let _: any = null;

/**
 * Stage class - Encapsulates all audio processing, effects, and MIDI event generation.
 * Manages binaural beats, stutter effects, pan/balance, FX parameters, and note generation.
 */
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
  setTuningAndInstruments(ctx?: ICompositionContext): void {
    const primaryProg = globalThis.getMidiValue('program', globalThis.primaryInstrument);
    const secondaryProg = globalThis.getMidiValue('program', globalThis.secondaryInstrument);
    const bassProg = globalThis.getMidiValue('program', globalThis.bassInstrument);
    const bass2Prog = globalThis.getMidiValue('program', globalThis.bassInstrument2);

    const items1 = ['control_c','program_c'].flatMap((type: string) => [ ...globalThis.source.map((ch: number) => ({
      type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [primaryProg]) : (type==='control_c' ? [10,127] : [primaryProg]))]})), ...globalThis.reflection.map((ch: number) => ({
      type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [secondaryProg]) : (type==='control_c' ? [10,127] : [secondaryProg]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH1,...(type==='control_c' ? [globalThis.tuningPitchBend] : [primaryProg])]}, { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH2,...(type==='control_c' ? [globalThis.tuningPitchBend] : [secondaryProg])]}]);
    const pFn1 = requirePush(ctx);
    pFn1(ctx.csvBuffer, ...items1);

    const items2 = ['control_c','program_c'].flatMap((type: string) => [ ...globalThis.bass.map((ch: number) => ({
      type,vals:[ch,...(globalThis.binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [bassProg]) : (type==='control_c' ? [10,127] : [bass2Prog]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[globalThis.cCH3,...(type==='control_c' ? [globalThis.tuningPitchBend] : [bassProg])]}]);
    const pFn2 = requirePush(ctx);
    pFn2(ctx.csvBuffer, ...items2);
    const pFn3 = requirePush(ctx);
    pFn3(ctx.csvBuffer, { type: 'control_c', vals: [globalThis.drumCH, 7, 127] });
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

// Export Stage instance (created by DIContainer in play.ts)
export const stage = new Stage();
