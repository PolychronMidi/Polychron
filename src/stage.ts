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

// Initialize global temporary variable for FX object spreading
declare const globalThis: any;
globalThis._ = null;

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
  setOtherInstruments(): void {
    if (globalThis.rf() < .3 || globalThis.beatCount % globalThis.beatsUntilBinauralShift < 1 || this.firstLoop<1 ) {
  globalThis.p(globalThis.c,...['control_c'].flatMap(()=>{ const tmp={ tick:globalThis.beatStart,type:'program_c' };
    return [
      ...globalThis.reflectionBinaural.map((ch: number) => ({...tmp,vals:[ch,globalThis.ra(globalThis.otherInstruments)]})),
      ...globalThis.bassBinaural.map((ch: number) => ({...tmp,vals:[ch,globalThis.ra(globalThis.otherBassInstruments)]})),
      { ...tmp,vals:[globalThis.drumCH,globalThis.ra(globalThis.drumSets)] }
    ];  })  );  }
  }

  /**
   * Manages binaural beat pitch shifts and volume crossfades at beat boundaries
   * @returns {void}
   */
  setBinaural(): void {
    if (globalThis.beatCount===globalThis.beatsUntilBinauralShift || this.firstLoop<1 ) {
    globalThis.beatCount=0; globalThis.flipBin=!globalThis.flipBin; globalThis.allNotesOff(globalThis.beatStart);
    globalThis.beatsUntilBinauralShift=globalThis.ri(globalThis.numerator,globalThis.numerator*2*globalThis.bpmRatio3);
    globalThis.binauralFreqOffset=globalThis.rl(globalThis.binauralFreqOffset,-1,1,globalThis.BINAURAL.min,globalThis.BINAURAL.max);
    globalThis.p(globalThis.c,...globalThis.binauralL.map((ch: number) => ({tick:globalThis.beatStart,type:'pitch_bend_c',vals:[ch,ch===globalThis.lCH1 || ch===globalThis.lCH3 || ch===globalThis.lCH5 ? (globalThis.flipBin ? globalThis.binauralMinus : globalThis.binauralPlus) : (globalThis.flipBin ? globalThis.binauralPlus : globalThis.binauralMinus)]})),
    ...globalThis.binauralR.map((ch: number) => ({tick:globalThis.beatStart,type:'pitch_bend_c',vals:[ch,ch===globalThis.rCH1 || ch===globalThis.rCH3 || ch===globalThis.rCH5 ? (globalThis.flipBin ? globalThis.binauralPlus : globalThis.binauralMinus) : (globalThis.flipBin ? globalThis.binauralMinus : globalThis.binauralPlus)]})),
    );
    // flipBin (flip binaural) volume transition
    const startTick = globalThis.beatStart - globalThis.tpSec/4;
    const endTick = globalThis.beatStart + globalThis.tpSec/4;
    const steps = 10;
    const tickIncrement = (endTick - startTick) / steps;
    for (let i = steps/2-1; i <= steps; i++) {
      const tick = startTick + (tickIncrement * i);
      const currentVolumeF2 = globalThis.flipBin ? globalThis.m.floor(100 * (1 - (i / steps))) : globalThis.m.floor(100 * (i / steps));
      const currentVolumeT2 = globalThis.flipBin ? globalThis.m.floor(100 * (i / steps)) : globalThis.m.floor(100 * (1 - (i / steps)));
      const maxVol = globalThis.rf(.9,1.2);
      globalThis.flipBinF2.forEach((ch: number) => {
        globalThis.p(globalThis.c,{tick:tick,type:'control_c',vals:[ch,7,globalThis.m.round(currentVolumeF2*maxVol)]});
      });
      globalThis.flipBinT2.forEach((ch: number) => {
        globalThis.p(globalThis.c,{tick:tick,type:'control_c',vals:[ch,7,globalThis.m.round(currentVolumeT2*maxVol)]});
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
  stutterFade(channels: number[], numStutters = globalThis.ri(10, 70), duration = globalThis.tpSec * globalThis.rf(.2, 1.5)): void {
    this.fx.stutterFade(channels, numStutters, duration);
  }

  /**
   * Applies rapid pan stutter effect to selected channels (delegates to FxManager)
   * @param channels - Array of channel numbers to potentially stutter
   * @param numStutters - Number of stutter events
   * @param duration - Duration of stutter effect in ticks
   * @returns {void}
   */
  stutterPan(channels: number[], numStutters = globalThis.ri(30, 90), duration = globalThis.tpSec * globalThis.rf(.1, 1.2)): void {
    this.fx.stutterPan(channels, numStutters, duration);
  }

  /**
   * Applies rapid FX parameter stutter effect to selected channels (delegates to FxManager)
   * @param channels - Array of channel numbers to potentially stutter
   * @param numStutters - Number of stutter events
   * @param duration - Duration of stutter effect in ticks
   * @returns {void}
   */
  stutterFX(channels: number[], numStutters = globalThis.ri(30, 100), duration = globalThis.tpSec * globalThis.rf(.1, 2)): void {
    this.fx.stutterFX(channels, numStutters, duration);
  }

  /**
   * Sets pan positions, balance offsets, and detailed FX parameters for all channels
   * @returns {void}
   */
  setBalanceAndFX(): void {
  const beatStart = globalThis.beatStart !== undefined ? globalThis.beatStart : 0;
  if (globalThis.rf() < .5*globalThis.bpmRatio3 || globalThis.beatCount % globalThis.beatsUntilBinauralShift < 1 || this.firstLoop<1 ) { this.firstLoop=1;
    this.balOffset=globalThis.rl(this.balOffset,-4,4,0,45);
    this.sideBias=globalThis.rl(this.sideBias,-2,2,-20,20);
    this.lBal=globalThis.m.max(0,globalThis.m.min(54,this.balOffset + globalThis.ri(3) + this.sideBias));
    this.rBal=globalThis.m.min(127,globalThis.m.max(74,127 - this.balOffset - globalThis.ri(3) + this.sideBias));
    this.cBal=globalThis.m.min(96,(globalThis.m.max(32,64 + globalThis.m.round(globalThis.rv(this.balOffset / globalThis.ri(2,3))) * (globalThis.rf() < .5 ? -1 : 1) + this.sideBias)));
    this.refVar=globalThis.ri(1,10); this.cBal2=globalThis.rf()<.5?this.cBal+globalThis.m.round(this.refVar*.5) : this.cBal+globalThis.m.round(this.refVar*-.5);
    this.bassVar=this.refVar*globalThis.rf(-2,2); this.cBal3=globalThis.rf()<.5?this.cBal2+globalThis.m.round(this.bassVar*.5) : this.cBal2+globalThis.m.round(this.bassVar*-.5);
    globalThis.p(globalThis.c,...['control_c'].flatMap(()=>{ const tmp={ tick:beatStart-1,type:'control_c' }; _=tmp;
  return [
      ...globalThis.source2.map((ch: number) => ({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (globalThis.flipBin ? this.lBal : this.rBal) : ch.toString().startsWith('rCH') ? (globalThis.flipBin ? this.rBal : this.lBal) : ch===globalThis.drumCH ? this.cBal3+globalThis.m.round((globalThis.rf(-.5,.5)*this.bassVar)) : this.cBal]})),
      ...globalThis.reflection.map((ch: number) => ({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (globalThis.flipBin ? (globalThis.rf()<.1 ? this.lBal+this.refVar*2 : this.lBal+this.refVar) : (globalThis.rf()<.1 ? this.rBal-this.refVar*2 : this.rBal-this.refVar)) : ch.toString().startsWith('rCH') ? (globalThis.flipBin ? (globalThis.rf()<.1 ? this.rBal-this.refVar*2 : this.rBal-this.refVar) : (globalThis.rf()<.1 ? this.lBal+this.refVar*2 : this.lBal+this.refVar)) : this.cBal2+globalThis.m.round((globalThis.rf(-.5,.5)*this.refVar)) ]})),
      ...globalThis.bass.map((ch: number) => ({...tmp,vals:[ch,10,ch.toString().startsWith('lCH') ? (globalThis.flipBin ? this.lBal+this.bassVar : this.rBal-this.bassVar) : ch.toString().startsWith('rCH') ? (globalThis.flipBin ? this.rBal-this.bassVar : this.lBal+this.bassVar) : this.cBal3+globalThis.m.round((globalThis.rf(-.5,.5)*this.bassVar)) ]})),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,1,0,60,(c: number) => c===globalThis.cCH1,0,10)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,5,125,127,(c: number) => c===globalThis.cCH1,126,127)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,11,64,127,(c: number) => c===globalThis.cCH1||c===globalThis.drumCH,115,127)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,65,45,64,(c: number) => c===globalThis.cCH1,35,64)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,67,63,64)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,68,63,64)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,69,63,64)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,70,0,127)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,71,0,127)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,72,64,127)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,73,0,64)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,74,80,127)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,91,0,33)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,92,0,33)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,93,0,33)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,94,0,5,(c: number) => c===globalThis.drumCH,0,64)),
      ...globalThis.source2.map((ch: number) => globalThis.rlFX(ch,95,0,33)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,1,0,90,(c: number) => c===globalThis.cCH2,0,15)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,5,125,127,(c: number) => c===globalThis.cCH2,126,127)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,11,77,111,(c: number) => c===globalThis.cCH2,66,99)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,65,45,64,(c: number) => c===globalThis.cCH2,35,64)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,67,63,64)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,68,63,64)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,69,63,64)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,70,0,127)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,71,0,127)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,72,64,127)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,73,0,64)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,74,80,127)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,91,0,77,(c: number) => c===globalThis.cCH2,0,32)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,92,0,77,(c: number) => c===globalThis.cCH2,0,32)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,93,0,77,(c: number) => c===globalThis.cCH2,0,32)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,94,0,64,(c: number) => c===globalThis.cCH2,0,11)),
      ...globalThis.reflection.map((ch: number) => globalThis.rlFX(ch,95,0,77,(c: number) => c===globalThis.cCH2,0,32)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,1,0,60,(c: number) => c===globalThis.cCH3,0,10)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,5,125,127,(c: number) => c===globalThis.cCH3,126,127)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,11,88,127,(c: number) => c===globalThis.cCH3,115,127)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,65,45,64,(c: number) => c===globalThis.cCH3,35,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,67,63,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,68,63,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,69,63,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,70,0,127)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,71,0,127)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,72,64,127)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,73,0,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,74,80,127)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,91,0,99,(c: number) => c===globalThis.cCH3,0,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,92,0,99,(c: number) => c===globalThis.cCH3,0,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,93,0,99,(c: number) => c===globalThis.cCH3,0,64)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,94,0,64,(c: number) => c===globalThis.cCH3,0,11)),
      ...globalThis.bass.map((ch: number) => globalThis.rlFX(ch,95,0,99,(c: number) => c===globalThis.cCH3,0,64)),
    ];  })  );  }
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

// Export Stage instance (created by DIContainer in play.ts)
export const stage = new Stage();
