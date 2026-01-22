// stage.ts - Audio processing engine with MIDI event generation and binaural effects.
// TypeScript version with full type annotations
// minimalist comments, details at: stage.md

import { otherInstruments, otherBassInstruments, drumSets, BINAURAL } from './sheet.js';
import './writer.js';
import './venue.js';
import { source, reflection, bass, binauralL, binauralR, reflectionBinaural, bassBinaural, cCH1, cCH2, cCH3, lCH1, lCH3, lCH5, rCH1, rCH3, rCH5, drumCH, tuningPitchBend, allNotesOff, rf, ri, ra, rl, m, binauralPlus, binauralMinus, flipBinF2, flipBinT2 } from './backstage.js';
import './rhythm.js';
import './time.js';
import './composers.js';
import './motifs.js';
import './fxManager.js';
import { PlayNotes } from './playNotes.js';

import { ICompositionContext } from './CompositionContext.js';

// Module-scoped temporary variable for FX object spreading
import { requirePush } from './writer.js';


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

  constructor(fxManager?: any) {
    // FX Manager for stutter effects (dependency injected)
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
    // Prefer DI-provided midi lookup, fall back to registered config values from DI container
    const container = ctx?.container as any;
    const getMidiValueFn = container && container.has('getMidiValue') ? container.get('getMidiValue') : undefined;
    // Prefer explicit values on ctx.state (tests set these), fall back to DI container registrations
    const primaryInst = ctx.state.primaryInstrument ?? (container && container.has('primaryInstrument') ? container.get('primaryInstrument') : undefined);
    const secondaryInst = ctx.state.secondaryInstrument ?? (container && container.has('secondaryInstrument') ? container.get('secondaryInstrument') : undefined);
    const bassInst = ctx.state.bassInstrument ?? (container && container.has('bassInstrument') ? container.get('bassInstrument') : undefined);
    const bassInst2 = ctx.state.bassInstrument2 ?? (container && container.has('bassInstrument2') ? container.get('bassInstrument2') : undefined);

    const primaryProg = getMidiValueFn ? getMidiValueFn('program', primaryInst) : getMidiValueFn?.('program', primaryInst);
    const secondaryProg = getMidiValueFn ? getMidiValueFn('program', secondaryInst) : getMidiValueFn?.('program', secondaryInst);
    const bassProg = getMidiValueFn ? getMidiValueFn('program', bassInst) : getMidiValueFn?.('program', bassInst);
    const bass2Prog = getMidiValueFn ? getMidiValueFn('program', bassInst2) : getMidiValueFn?.('program', bassInst2);

    const items1 = ['control_c','program_c'].flatMap((type: string) => [ ...source.map((ch: number) => ({
      type,vals:[ch,...(binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [primaryProg]) : (type==='control_c' ? [10,127] : [primaryProg]))]})), ...reflection.map((ch: number) => ({
      type,vals:[ch,...(binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [secondaryProg]) : (type==='control_c' ? [10,127] : [secondaryProg]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH1,...(type==='control_c' ? [tuningPitchBend] : [primaryProg])]}, { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH2,...(type==='control_c' ? [tuningPitchBend] : [secondaryProg])]}]);
    const pFn1 = requirePush(ctx);
    pFn1(ctx.csvBuffer, ...items1);

    const items2 = ['control_c','program_c'].flatMap((type: string) => [ ...bass.map((ch: number) => ({
      type,vals:[ch,...(binauralL.includes(ch) ? (type==='control_c' ? [10,0] : [bassProg]) : (type==='control_c' ? [10,127] : [bass2Prog]))]})), { type:type==='control_c' ? 'pitch_bend_c' : 'program_c',vals:[cCH3,...(type==='control_c' ? [tuningPitchBend] : [bassProg])]}]);
    const pFn2 = requirePush(ctx);
    pFn2(ctx.csvBuffer, ...items2);
    const pFn3 = requirePush(ctx);
    pFn3(ctx.csvBuffer, { type: 'control_c', vals: [drumCH, 7, 127] });
  }

  /**
   * Randomly updates binaural beat instruments and FX on beat shifts
   * @returns {void}
   */
  setOtherInstruments(ctx: ICompositionContext): void {
    const beatCount = ctx.state.beatCount;
    const beatsUntilBinauralShift = ctx.state.beatsUntilBinauralShift;
    const beatStart = ctx.state.beatStart;

    if (rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
      const items = ['control_c'].flatMap(() => {
        const tmp = { tick: beatStart, type: 'program_c' };
        return [
          ...reflectionBinaural.map((ch: number) => ({ ...tmp, vals: [ch, ra(otherInstruments)] })),
          ...bassBinaural.map((ch: number) => ({ ...tmp, vals: [ch, ra(otherBassInstruments)] })),
          { ...tmp, vals: [drumCH, ra(drumSets)] }
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
      const nextBeatsUntil = ri(numerator, numerator * 2 * bpmRatio3);
        // Use config from sheet where possible (BINAURAL is exported from sheet)
      const nextBinauralFreqOffset = rl(binauralFreqOffset, -1, 1, BINAURAL.min, BINAURAL.max);

      state.beatCount = nextBeatCount;
      state.flipBin = nextFlipBin;
      state.beatsUntilBinauralShift = nextBeatsUntil;
      state.binauralFreqOffset = nextBinauralFreqOffset;

      flipBin = nextFlipBin;
      binauralFreqOffset = nextBinauralFreqOffset;

      allNotesOff(beatStart);
      const itemsBend = [
        ...binauralL.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === lCH1 || ch === lCH3 || ch === lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)] })),
        ...binauralR.map((ch: number) => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === rCH1 || ch === rCH3 || ch === rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)] })),
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
        const currentVolumeF2 = flipBin ? m.floor(100 * (1 - (i / steps))) : m.floor(100 * (i / steps));
        const currentVolumeT2 = flipBin ? m.floor(100 * (i / steps)) : m.floor(100 * (1 - (i / steps)));
        const maxVol = rf(.9, 1.2);
        const itemsF = flipBinF2.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 7, m.round(currentVolumeF2 * maxVol)] }));
        const itemsT = flipBinT2.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 7, m.round(currentVolumeT2 * maxVol)] }));
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
    const resolvedNumStutters = numStutters ?? ri(10, 70);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * rf(.2, 1.5);
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
    const resolvedNumStutters = numStutters ?? ri(30, 90);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * rf(.1, 1.2);
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
    const resolvedNumStutters = numStutters ?? ri(30, 100);
    const tpSec = ctx.state.tpSec;
    const resolvedDuration = duration ?? tpSec * rf(.1, 2);
    this.fx.stutterFX(channels, ctx, resolvedNumStutters, resolvedDuration);
  }

  /**
   * Sets pan positions, balance offsets, and detailed FX parameters for all channels
   * @returns {void}
   */
  setBalanceAndFX(ctx: ICompositionContext): void {
    const beatStart = ctx.state.beatStart;
    const beatCount = ctx.state.beatCount;
    const beatsUntilBinauralShift = ctx.state.beatsUntilBinauralShift;
    const bpmRatio3 = ctx.state.bpmRatio3;
    const _flipBin = ctx.state.flipBin;

    if (rf() < .5 * bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
      this.firstLoop = 1;
      // Ensure we base random limited change on the DI-visible state when available
      const oldBal = (ctx && ctx.state && typeof ctx.state.balOffset === 'number') ? ctx.state.balOffset : this.balOffset;
      // Sync internal balOffset to context to avoid large jumps when Stage instance
      // persisted a different value between tests or across runs
      this.balOffset = oldBal;
      this.balOffset = rl(this.balOffset, -4, 4, 0, 45);
      // Safety clamp to ensure limited change per test expectations
      if (Math.abs(this.balOffset - oldBal) > 4) {
        this.balOffset = oldBal + Math.sign(this.balOffset - oldBal) * 4;
      }
      this.sideBias = rl(this.sideBias, -2, 2, -20, 20);
      this.lBal = m.max(0, m.min(54, this.balOffset + ri(3) + this.sideBias));
      this.rBal = m.min(127, m.max(74, 127 - this.balOffset - ri(3) + this.sideBias));
      this.cBal = m.min(96, (m.max(32, 64 + m.round(ra(this.balOffset / ri(2, 3))) * (rf() < .5 ? -1 : 1) + this.sideBias)));
      this.refVar = ri(1, 10);
      this.cBal2 = rf() < .5 ? this.cBal + m.round(this.refVar * .5) : this.cBal + m.round(this.refVar * -.5);
      this.bassVar = this.refVar * rf(-2, 2);

      // Persist key FX/balance values into DI-based state for consumers and tests
      if (ctx && ctx.state) {
        ctx.state.balOffset = this.balOffset;
        ctx.state.sideBias = this.sideBias;
        ctx.state.lBal = this.lBal;
        ctx.state.rBal = this.rBal;
        ctx.state.cBal = this.cBal;
        ctx.state.cBal2 = this.cBal2;
        ctx.state.bassVar = this.bassVar;
      }
      this.cBal3 = rf() < .5 ? this.cBal2 + m.round(this.bassVar * .5) : this.cBal2 + m.round(this.bassVar * -.5);

      // Build FX control events (pan CC=10 and additional FX CCs) for channels
      const tick = beatStart - 1;
      const itemsFX: any[] = [];

      // Pan (CC 10) events for groups
      if (Array.isArray(source)) itemsFX.push(...source.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.lBal] })));
      if (Array.isArray(reflection)) itemsFX.push(...reflection.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.rBal] })));
      if (Array.isArray(bass)) itemsFX.push(...bass.map((ch: number) => ({ tick, type: 'control_c', vals: [ch, 10, this.cBal3] })));

      // Additional FX controls (CC 1,5,11,7) applied to source/reflection channels
      const fxCCs = [1, 5, 11, 7];
      if (Array.isArray(source)) {
        for (const ch of source) {
          for (const cc of fxCCs) {
            itemsFX.push({ tick, type: 'control_c', vals: [ch, cc, m.round(this.cBal2 * rf(.7, 1.3))] });
          }
        }
      }
      if (Array.isArray(reflection)) {
        for (const ch of reflection) {
          for (const cc of fxCCs) {
            itemsFX.push({ tick, type: 'control_c', vals: [ch, cc, m.round(this.cBal * rf(.7, 1.3))] });
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
  crossModulateRhythms(ctx: ICompositionContext): void {
    this.playNotesHandler.crossModulateRhythms(ctx);
  }

  /**
   * Calculates note timing and sustain parameters for subdivision-based notes
   * Delegates to PlayNotes handler
   * @returns {void}
   */
  setNoteParams(ctx: ICompositionContext): void {
    this.playNotesHandler.setNoteParams(ctx);
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
  setNoteParams2(ctx: ICompositionContext): void {
    this.playNotesHandler.setNoteParams2(ctx);
  }

  /**
   * Generates MIDI note events with complex stutter/shift effects (subsubdivision-based timing)
   * Delegates to PlayNotes handler
   * @returns {void}
   */
  playNotes2(ctx: ICompositionContext): void {
    this.playNotesHandler.playNotes2(ctx);
  }

  /**
   * Convenience shim to expose allNotesOff behavior via Stage instance for tests/users.
   * Delegates to backstage.allNotesOff and returns generated events.
   */
  public allNotesOff(tick?: number): any[] {
    return allNotesOff(tick);
  }
}


// Export Stage instance (created by DIContainer in play.ts)
export const stage = new Stage();
