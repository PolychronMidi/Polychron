// stage.ts - Audio processing engine with MIDI event generation and binaural effects.
// TypeScript version with full type annotations
// minimalist comments, details at: stage.md

import './sheet';
import './writer';
import './venue';
import './backstage';
import './rhythm';
import './time';
import './composers';
import './motifs';
import './fxManager';

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

  // Cross-modulation state
  private lastCrossMod: number;
  private crossModulation: number;

  // Note generation state
  private on: number;
  private shortSustain: number;
  private longSustain: number;
  private sustain: number;
  private binVel: number;
  private useShort: boolean;

  constructor() {
    // FX Manager for stutter effects
    this.fx = globalThis.fxManager;

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

    // Cross-modulation state
    this.lastCrossMod = 0;
    this.crossModulation = 0;

    // Note generation state
    this.on = 0;
    this.shortSustain = 0;
    this.longSustain = 0;
    this.sustain = 0;
    this.binVel = 0;
    this.useShort = false;
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
   * @returns {void}
   */
  crossModulateRhythms(): void {
    this.lastCrossMod=this.crossModulation; this.crossModulation=0;
    this.crossModulation+=globalThis.beatRhythm[globalThis.beatIndex] > 0 ? globalThis.rf(1.5,3) : globalThis.m.max(globalThis.rf(.625,1.25),(1 / globalThis.numerator) * globalThis.beatsOff + (1 / globalThis.numerator) * globalThis.beatsOn) +
    globalThis.divRhythm[globalThis.divIndex] > 0 ? globalThis.rf(1,2) : globalThis.m.max(globalThis.rf(.5,1),(1 / globalThis.divsPerBeat) * globalThis.divsOff + (1 / globalThis.divsPerBeat) * globalThis.divsOn ) +
    globalThis.subdivRhythm[globalThis.subdivIndex] > 0 ? globalThis.rf(.5,1) : globalThis.m.max(globalThis.rf(.25,.5),(1 / globalThis.subdivsPerDiv) * globalThis.subdivsOff + (1 / globalThis.subdivsPerDiv) * globalThis.subdivsOn) +
    (globalThis.subdivsOn < globalThis.ri(7,15) ? globalThis.rf(.1,.3) : globalThis.rf(-.1)) + (globalThis.subdivsOff > globalThis.ri() ? globalThis.rf(.1,.3) : globalThis.rf(-.1)) +
    (globalThis.divsOn < globalThis.ri(9,15) ? globalThis.rf(.1,.3) : globalThis.rf(-.1)) + (globalThis.divsOff > globalThis.ri(3,7) ? globalThis.rf(.1,.3) : globalThis.rf(-.1)) +
    (globalThis.beatsOn < globalThis.ri(3) ? globalThis.rf(.1,.3) : globalThis.rf(-.1)) + (globalThis.beatsOff > globalThis.ri(3) ? globalThis.rf(.1,.3) : globalThis.rf(-.1)) +
    (globalThis.subdivsOn > globalThis.ri(7,15) ? globalThis.rf(-.3,-.5) : globalThis.rf(.1)) + (globalThis.subdivsOff < globalThis.ri() ? globalThis.rf(-.3,-.5) : globalThis.rf(.1)) +
    (globalThis.divsOn > globalThis.ri(9,15) ? globalThis.rf(-.2,-.4) : globalThis.rf(.1)) + (globalThis.divsOff < globalThis.ri(3,7) ? globalThis.rf(-.2,-.4) : globalThis.rf(.1)) +
    (globalThis.beatsOn > globalThis.ri(3) ? globalThis.rf(-.2,-.3) : globalThis.rf(.1)) + (globalThis.beatsOff < globalThis.ri(3) ? globalThis.rf(-.1,-.3) : globalThis.rf(.1)) +
    (globalThis.subdivsPerMinute > globalThis.ri(400,600) ? globalThis.rf(-.4,-.6) : globalThis.rf(.1)) + (globalThis.subdivsOn * globalThis.rf(-.05,-.15)) + (globalThis.beatRhythm[globalThis.beatIndex]<1?globalThis.rf(.4,.5):0) + (globalThis.divRhythm[globalThis.divIndex]<1?globalThis.rf(.3,.4):0) + (globalThis.subdivRhythm[globalThis.subdivIndex]<1?globalThis.rf(.2,.3):0);
  }

  /**
   * Calculates note timing and sustain parameters for subdivision-based notes
   * @returns {void}
   */
  setNoteParams(): void {
    const subdivsPerMinute = globalThis.subdivsPerBeat * globalThis.midiBPM;
    this.on=globalThis.subdivStart+(globalThis.tpSubdiv*globalThis.rv(globalThis.rf(.2),[-.1,.07],.3));
    this.shortSustain=globalThis.rv(globalThis.rf(globalThis.m.max(globalThis.tpDiv*.5,globalThis.tpDiv / globalThis.subdivsPerDiv),(globalThis.tpBeat*(.3+globalThis.rf()*.7))),[.1,.2],.1,[-.05,-.1]);
    this.longSustain=globalThis.rv(globalThis.rf(globalThis.tpDiv*.8,(globalThis.tpBeat*(.3+globalThis.rf()*.7))),[.1,.3],.1,[-.05,-.1]);
    this.useShort=subdivsPerMinute > globalThis.ri(400,650);
    this.sustain=(this.useShort ? this.shortSustain : this.longSustain)*globalThis.rv(globalThis.rf(.8,1.3));
    this.binVel=globalThis.rv(globalThis.velocity * globalThis.rf(.42,.57));
  }

  /**
   * Generates MIDI note events for source channels (subdivision-based timing)
   * @returns {void}
   */
  playNotes(): void {
    this.setNoteParams();
    this.crossModulateRhythms();
    const noteObjects = globalThis.composer ? globalThis.composer.getNotes() : [];
    const motifNotes = globalThis.activeMotif ? globalThis.applyMotifToNotes(noteObjects, globalThis.activeMotif) : noteObjects;
    if((this.crossModulation+this.lastCrossMod)/globalThis.rf(1.4,2.6)>globalThis.rv(globalThis.rf(1.8,2.8),[-.2,-.3],.05)){
  motifNotes.forEach(({ note }: { note: number }) => {
    // Play source channels
    globalThis.source.filter((sourceCH: number) =>
      globalThis.flipBin ? globalThis.flipBinT.includes(sourceCH) : globalThis.flipBinF.includes(sourceCH)
    ).map((sourceCH: number) => {

      globalThis.p(globalThis.c,{tick:sourceCH===globalThis.cCH1 ? this.on + globalThis.rv(globalThis.tpSubdiv*globalThis.rf(1/9),[-.1,.1],.3) : this.on + globalThis.rv(globalThis.tpSubdiv*globalThis.rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,note,sourceCH===globalThis.cCH1 ? globalThis.velocity*globalThis.rf(.95,1.15) : this.binVel*globalThis.rf(.95,1.03)]});
      globalThis.p(globalThis.c,{tick:this.on+this.sustain*(sourceCH===globalThis.cCH1 ? 1 : globalThis.rv(globalThis.rf(.92,1.03))),vals:[sourceCH,note]});

    });

    // Play reflection channels
    globalThis.reflection.filter((reflectionCH: number) =>
      globalThis.flipBin ? globalThis.flipBinT.includes(reflectionCH) : globalThis.flipBinF.includes(reflectionCH)
    ).map((reflectionCH: number) => {

      globalThis.p(globalThis.c,{tick:reflectionCH===globalThis.cCH2 ? this.on+globalThis.rv(globalThis.tpSubdiv*globalThis.rf(.2),[-.01,.1],.5) : this.on+globalThis.rv(globalThis.tpSubdiv*globalThis.rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,note,reflectionCH===globalThis.cCH2 ? globalThis.velocity*globalThis.rf(.5,.8) : this.binVel*globalThis.rf(.55,.9)]});
      globalThis.p(globalThis.c,{tick:this.on+this.sustain*(reflectionCH===globalThis.cCH2 ? globalThis.rf(.7,1.2) : globalThis.rv(globalThis.rf(.65,1.3))),vals:[reflectionCH,note]});

    });

    // Play bass channels (with probability based on BPM)
    if (globalThis.rf()<globalThis.clamp(.35*globalThis.bpmRatio3,.2,.7)) {
      globalThis.bass.filter((bassCH: number) =>
        globalThis.flipBin ? globalThis.flipBinT.includes(bassCH) : globalThis.flipBinF.includes(bassCH)
      ).map((bassCH: number) => {
        const bassNote = globalThis.modClamp(note,12,35);

        globalThis.p(globalThis.c,{tick:bassCH===globalThis.cCH3 ? this.on+globalThis.rv(globalThis.tpSubdiv*globalThis.rf(.1),[-.01,.1],.5) : this.on+globalThis.rv(globalThis.tpSubdiv*globalThis.rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===globalThis.cCH3 ? globalThis.velocity*globalThis.rf(1.15,1.35) : this.binVel*globalThis.rf(1.85,2.45)]});
        globalThis.p(globalThis.c,{tick:this.on+this.sustain*(bassCH===globalThis.cCH3 ? globalThis.rf(1.1,3) : globalThis.rv(globalThis.rf(.8,3.5))),vals:[bassCH,bassNote]});

      });
    }
  }); globalThis.subdivsOff=0; globalThis.subdivsOn++; } else { globalThis.subdivsOff++; globalThis.subdivsOn=0; }
  }

  /**
   * Calculates note timing and sustain parameters for subsubdivision-based notes
   * @returns {void}
   */
  setNoteParams2(): void {
    const subdivsPerMinute = globalThis.subdivsPerBeat * globalThis.midiBPM;
    this.on=globalThis.subsubdivStart+(globalThis.tpSubsubdiv*globalThis.rv(globalThis.rf(.2),[-.1,.07],.3));
    this.shortSustain=globalThis.rv(globalThis.rf(globalThis.m.max(globalThis.tpDiv*.5,globalThis.tpDiv / globalThis.subdivsPerDiv),(globalThis.tpBeat*(.3+globalThis.rf()*.7))),[.1,.2],.1,[-.05,-.1]);
    this.longSustain=globalThis.rv(globalThis.rf(globalThis.tpDiv*.8,(globalThis.tpBeat*(.3+globalThis.rf()*.7))),[.1,.3],.1,[-.05,-.1]);
    this.useShort=subdivsPerMinute > globalThis.ri(400,650);
    this.sustain=(this.useShort ? this.shortSustain : this.longSustain)*globalThis.rv(globalThis.rf(.8,1.3));
    this.binVel=globalThis.rv(globalThis.velocity * globalThis.rf(.42,.57));
  }

  /**
   * Generates MIDI note events with complex stutter/shift effects (subsubdivision-based timing)
   * @returns {void}
   */
  playNotes2(): void {
    this.setNoteParams2();
    this.crossModulateRhythms();
    let reflectionCH: number; let bassCH: number; let bassNote: number;
    const noteObjects = globalThis.composer ? globalThis.composer.getNotes() : [];
    const motifNotes = globalThis.activeMotif ? globalThis.applyMotifToNotes(noteObjects, globalThis.activeMotif) : noteObjects;
    if(true){
  motifNotes.forEach(({ note }: { note: number }) => { globalThis.source.filter((sourceCH: number) =>
    globalThis.flipBin ? globalThis.flipBinT.includes(sourceCH) : globalThis.flipBinF.includes(sourceCH)
    ).map((sourceCH: number) => {

    globalThis.p(globalThis.c,{tick:sourceCH===globalThis.cCH1 ? this.on + globalThis.rv(globalThis.tpSubsubdiv*globalThis.rf(1/9),[-.1,.1],.3) : this.on + globalThis.rv(globalThis.tpSubsubdiv*globalThis.rf(1/3),[-.1,.1],.3),type:'on',vals:[sourceCH,note,sourceCH===globalThis.cCH1 ? globalThis.velocity*globalThis.rf(.95,1.15) : this.binVel*globalThis.rf(.95,1.03)]});
    globalThis.p(globalThis.c,{tick:this.on+this.sustain*(sourceCH===globalThis.cCH1 ? 1 : globalThis.rv(globalThis.rf(.92,1.03))),vals:[sourceCH,note]});

    // Stutter-Shift: Random note stutter and octave shift.
    const stutters = new Map<number, number>(); const shifts = new Map<number, number>();
    let stutterApplied = false; let globalStutterData: any = null;
    if (!stutterApplied && globalThis.rf() < globalThis.rv(.2,[.5,1],.3)) {
      // Calculate stutter once for all Source channels
      const numStutters = globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(3,9),[2,5],.33),[2,5],.1));
      globalStutterData = {
        numStutters: numStutters,
        duration: .25 * globalThis.ri(1,6) * this.sustain / numStutters,
        minVelocity: 11,
        maxVelocity: 111,
        isFadeIn: globalThis.rf() < 0.5,
        decay: globalThis.rf(.75,1.25)
      };
      stutterApplied = true;
    }
    if (globalStutterData) {
      const {numStutters, duration, minVelocity, maxVelocity, isFadeIn, decay} = globalStutterData;
      for (let i = 0; i < numStutters; i++) {
        const tick = this.on + duration * i; let stutterNote = note;
        if (globalThis.rf() < .25) {
          if (!shifts.has(sourceCH)) shifts.set(sourceCH, globalThis.ri(-3,3)*12);
          const octaveShift = shifts.get(sourceCH)!;
          stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min*12-1), globalThis.OCTAVE.max*12-1);
        }
        let currentVelocity: number;
        if (isFadeIn) {
          const fadeInMultiplier = decay * (i / (numStutters * globalThis.rf(0.4,2.2) - 1));
          currentVelocity = globalThis.clamp(globalThis.m.min(maxVelocity, globalThis.ri(33) + maxVelocity * fadeInMultiplier),0,100);
        } else {
          const fadeOutMultiplier = 1 - (decay * (i / (numStutters * globalThis.rf(0.4,2.2) - 1)));
          currentVelocity = globalThis.clamp(globalThis.m.max(0, globalThis.ri(33) + maxVelocity * fadeOutMultiplier),0,100);
        }
        globalThis.p(globalThis.c,{tick:tick - duration * globalThis.rf(.15),vals:[sourceCH,stutterNote]});
        globalThis.p(globalThis.c,{tick:tick + duration * globalThis.rf(.15,.6),type:'on',vals:[sourceCH,stutterNote,sourceCH===globalThis.cCH1 ? currentVelocity * globalThis.rf(.3,.7) : currentVelocity * globalThis.rf(.45,.8)]});
      }
      globalThis.p(globalThis.c,{tick:this.on + this.sustain * globalThis.rf(.5,1.5),vals:[sourceCH,note]});
    }
    if (globalThis.rf()<globalThis.rv(.07,[.5,1],.2)){ // Source Channels Stutter-Shift #2: Unique per channel.
      if (!stutters.has(sourceCH)) stutters.set(sourceCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2,7),[2,5],.33),[2,5],.1)));
      const numStutters = stutters.get(sourceCH)!;
      const duration = .25 * globalThis.ri(1,5) * this.sustain / numStutters;
      for (let i = 0; i < numStutters; i++) {
        const tick = this.on + duration * i; let stutterNote = note;
        if(globalThis.rf()<.15){
          if (!shifts.has(sourceCH)) shifts.set(sourceCH, globalThis.ri(-3,3)*12);
          const octaveShift = shifts.get(sourceCH)!;
          stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min*12-1), globalThis.OCTAVE.max*12-1);
        }
        if(globalThis.rf()<.6){
        globalThis.p(globalThis.c,{tick:tick - duration * globalThis.rf(.15),vals:[sourceCH,stutterNote]});
        globalThis.p(globalThis.c,{tick:tick + duration * globalThis.rf(.15,.6),type:'on',vals:[sourceCH,stutterNote,sourceCH===globalThis.cCH1 ? globalThis.velocity * globalThis.rf(.3,.7) : this.binVel * globalThis.rf(.45,.8)]});
        }
      }
      globalThis.p(globalThis.c,{tick:this.on + this.sustain * globalThis.rf(.5,1.5),vals:[sourceCH,note]});
    }

    reflectionCH = globalThis.reflect[sourceCH];
    globalThis.p(globalThis.c,{tick:reflectionCH===globalThis.cCH2 ? this.on+globalThis.rv(globalThis.tpSubsubdiv*globalThis.rf(.2),[-.01,.1],.5) : this.on+globalThis.rv(globalThis.tpSubsubdiv*globalThis.rf(1/3),[-.01,.1],.5),type:'on',vals:[reflectionCH,note,reflectionCH===globalThis.cCH2 ? globalThis.velocity*globalThis.rf(.5,.8) : this.binVel*globalThis.rf(.55,.9)]});
    globalThis.p(globalThis.c,{tick:this.on+this.sustain*(reflectionCH===globalThis.cCH2 ? globalThis.rf(.7,1.2) : globalThis.rv(globalThis.rf(.65,1.3))),vals:[reflectionCH,note]});
    if (globalThis.rf()<.2){ // Reflection Channels Stutter-Shift
      if (!stutters.has(reflectionCH)) stutters.set(reflectionCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2,7),[2,5],.33),[2,5],.1)));
      const numStutters = stutters.get(reflectionCH)!;
      const duration = .25 * globalThis.ri(1,8) * this.sustain / numStutters;
      for (let i = 0; i < numStutters; i++) {
        const tick = this.on + duration * i; let stutterNote = note;
        if(globalThis.rf()<.7){
          if (!shifts.has(reflectionCH)) shifts.set(reflectionCH, globalThis.ri(-3,3)*12);
          const octaveShift = shifts.get(reflectionCH)!;
          stutterNote = globalThis.modClamp(note + octaveShift, globalThis.m.max(0, globalThis.OCTAVE.min*12-1), globalThis.OCTAVE.max*12-1);
        }
        if(globalThis.rf()<.5){
        globalThis.p(globalThis.c,{tick:tick - duration * globalThis.rf(.3),vals:[reflectionCH,stutterNote]});
        globalThis.p(globalThis.c,{tick:tick + duration * globalThis.rf(.25,.7),type:'on',vals:[reflectionCH,stutterNote,reflectionCH===globalThis.cCH2 ? globalThis.velocity * globalThis.rf(.25,.65) : this.binVel * globalThis.rf(.4,.75)]});
        }
      }
      globalThis.p(globalThis.c,{tick:this.on + this.sustain * globalThis.rf(.75,2),vals:[reflectionCH,note]});
    }

    if (globalThis.rf()<globalThis.clamp(.35*globalThis.bpmRatio3,.2,.7)) {
      bassCH = globalThis.reflect2[sourceCH]; bassNote = globalThis.modClamp(note,12,35);
      globalThis.p(globalThis.c,{tick:bassCH===globalThis.cCH3 ? this.on+globalThis.rv(globalThis.tpSubsubdiv*globalThis.rf(.1),[-.01,.1],.5) : this.on+globalThis.rv(globalThis.tpSubsubdiv*globalThis.rf(1/3),[-.01,.1],.5),type:'on',vals:[bassCH,bassNote,bassCH===globalThis.cCH3 ? globalThis.velocity*globalThis.rf(1.15,1.35) : this.binVel*globalThis.rf(1.85,2.45)]});
      globalThis.p(globalThis.c,{tick:this.on+this.sustain*(bassCH===globalThis.cCH3 ? globalThis.rf(1.1,3) : globalThis.rv(globalThis.rf(.8,3.5))),vals:[bassCH,bassNote]});
      if (globalThis.rf()<.7){ // Bass Channels Stutter-Shift
        if (!stutters.has(bassCH)) stutters.set(bassCH, globalThis.m.round(globalThis.rv(globalThis.rv(globalThis.ri(2,5),[2,3],.33),[2,10],.1)));
        const numStutters = stutters.get(bassCH)!;
        const duration = .25 * globalThis.ri(1,8) * this.sustain / numStutters;
        for (let i = 0; i < numStutters; i++) {
          const tick = this.on + duration * i; let stutterNote = bassNote;
          if(globalThis.rf()<.5){
            if (!shifts.has(bassCH)) shifts.set(bassCH, globalThis.ri(-2,2)*12);
            const octaveShift = shifts.get(bassCH)!;
            stutterNote = globalThis.modClamp(bassNote + octaveShift, 0, 59);
          }
          if(globalThis.rf()<.3){
          globalThis.p(globalThis.c,{tick:tick - duration * globalThis.rf(.3),vals:[bassCH,stutterNote]});
          globalThis.p(globalThis.c,{tick:tick + duration * globalThis.rf(.25,.7),type:'on',vals:[bassCH,stutterNote,bassCH===globalThis.cCH3 ? globalThis.velocity * globalThis.rf(.55,.85) : this.binVel * globalThis.rf(.75,1.05)]});
          }
        }
        globalThis.p(globalThis.c,{tick:this.on + this.sustain * globalThis.rf(.15,.35),vals:[bassCH,note]});
      }
    }

    }); }); }
  }
}

// Export Stage instance to global namespace for tests
globalThis.stage = new Stage();
if (typeof globalThis !== 'undefined') {
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  globalThis.__POLYCHRON_TEST__.stage = globalThis.stage;
}