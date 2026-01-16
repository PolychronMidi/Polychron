"use strict";
// stage.js - Audio processing engine with MIDI event generation and binaural effects.
// minimalist comments, details at: stage.md
require('./sheet');
require('./writer');
require('./venue');
require('./backstage');
require('./rhythm');
require('./time');
require('./composers');
require('./motifs');
require('./fxManager');
// Initialize global temporary variable for FX object spreading
globalThis._ = null;
/**
 * Stage class - Encapsulates all audio processing, effects, and MIDI event generation.
 * Manages binaural beats, stutter effects, pan/balance, FX parameters, and note generation.
 */
class Stage {
    constructor() {
        // FX Manager for stutter effects
        this.fx = fxManager;
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
    setTuningAndInstruments() {
        p(c, ...['control_c', 'program_c'].flatMap(type => [...source.map(ch => ({
                type, vals: [ch, ...(ch.toString().startsWith('lCH') ? (type === 'control_c' ? [10, 0] : [primaryInstrument]) : (type === 'control_c' ? [10, 127] : [primaryInstrument]))]
            })),
            { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c', vals: [cCH1, ...(type === 'control_c' ? [tuningPitchBend] : [primaryInstrument])] },
            { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c', vals: [cCH2, ...(type === 'control_c' ? [tuningPitchBend] : [secondaryInstrument])] }]));
        p(c, ...['control_c', 'program_c'].flatMap(type => [...bass.map(ch => ({
                type, vals: [ch, ...(ch.toString().startsWith('lCH') ? (type === 'control_c' ? [10, 0] : [bassInstrument]) : (type === 'control_c' ? [10, 127] : [bassInstrument2]))]
            })),
            { type: type === 'control_c' ? 'pitch_bend_c' : 'program_c', vals: [cCH3, ...(type === 'control_c' ? [tuningPitchBend] : [bassInstrument])] }]));
        p(c, { type: 'control_c', vals: [drumCH, 7, 127] });
    }
    /**
     * Randomly updates binaural beat instruments and FX on beat shifts
     * @returns {void}
     */
    setOtherInstruments() {
        if (rf() < .3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
            p(c, ...['control_c'].flatMap(() => {
                const tmp = { tick: beatStart, type: 'program_c' };
                return [
                    ...reflectionBinaural.map(ch => ({ ...tmp, vals: [ch, ra(otherInstruments)] })),
                    ...bassBinaural.map(ch => ({ ...tmp, vals: [ch, ra(otherBassInstruments)] })),
                    { ...tmp, vals: [drumCH, ra(drumSets)] }
                ];
            }));
        }
    }
    /**
     * Manages binaural beat pitch shifts and volume crossfades at beat boundaries
     * @returns {void}
     */
    setBinaural() {
        if (beatCount === beatsUntilBinauralShift || this.firstLoop < 1) {
            beatCount = 0;
            flipBin = !flipBin;
            allNotesOff(beatStart);
            beatsUntilBinauralShift = ri(numerator, numerator * 2 * bpmRatio3);
            binauralFreqOffset = rl(binauralFreqOffset, -1, 1, BINAURAL.min, BINAURAL.max);
            p(c, ...binauralL.map(ch => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === lCH1 || ch === lCH3 || ch === lCH5 ? (flipBin ? binauralMinus : binauralPlus) : (flipBin ? binauralPlus : binauralMinus)] })), ...binauralR.map(ch => ({ tick: beatStart, type: 'pitch_bend_c', vals: [ch, ch === rCH1 || ch === rCH3 || ch === rCH5 ? (flipBin ? binauralPlus : binauralMinus) : (flipBin ? binauralMinus : binauralPlus)] })));
            // flipBin (flip binaural) volume transition
            const startTick = beatStart - tpSec / 4;
            const endTick = beatStart + tpSec / 4;
            const steps = 10;
            const tickIncrement = (endTick - startTick) / steps;
            for (let i = steps / 2 - 1; i <= steps; i++) {
                const tick = startTick + (tickIncrement * i);
                const currentVolumeF2 = flipBin ? m.floor(100 * (1 - (i / steps))) : m.floor(100 * (i / steps));
                const currentVolumeT2 = flipBin ? m.floor(100 * (i / steps)) : m.floor(100 * (1 - (i / steps)));
                const maxVol = rf(.9, 1.2);
                flipBinF2.forEach(ch => {
                    p(c, { tick: tick, type: 'control_c', vals: [ch, 7, m.round(currentVolumeF2 * maxVol)] });
                });
                flipBinT2.forEach(ch => {
                    p(c, { tick: tick, type: 'control_c', vals: [ch, 7, m.round(currentVolumeT2 * maxVol)] });
                });
            }
        }
    }
    /**
     * Applies rapid volume stutter/fade effect to selected channels (delegates to FxManager)
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events
     * @param {number} [duration] - Duration of stutter effect in ticks
     * @returns {void}
     */
    stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
        this.fx.stutterFade(channels, numStutters, duration);
    }
    /**
     * Applies rapid pan stutter effect to selected channels (delegates to FxManager)
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events
     * @param {number} [duration] - Duration of stutter effect in ticks
     * @returns {void}
     */
    stutterPan(channels, numStutters = ri(30, 90), duration = tpSec * rf(.1, 1.2)) {
        this.fx.stutterPan(channels, numStutters, duration);
    }
    /**
     * Applies rapid FX parameter stutter effect to selected channels (delegates to FxManager)
     * @param {Array} channels - Array of channel numbers to potentially stutter
     * @param {number} [numStutters] - Number of stutter events
     * @param {number} [duration] - Duration of stutter effect in ticks
     * @returns {void}
     */
    stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
        this.fx.stutterFX(channels, numStutters, duration);
    }
    /**
     * Sets pan positions, balance offsets, and detailed FX parameters for all channels
     * @returns {void}
     */
    setBalanceAndFX() {
        if (rf() < .5 * bpmRatio3 || beatCount % beatsUntilBinauralShift < 1 || this.firstLoop < 1) {
            this.firstLoop = 1;
            this.balOffset = rl(this.balOffset, -4, 4, 0, 45);
            this.sideBias = rl(this.sideBias, -2, 2, -20, 20);
            this.lBal = m.max(0, m.min(54, this.balOffset + ri(3) + this.sideBias));
            this.rBal = m.min(127, m.max(74, 127 - this.balOffset - ri(3) + this.sideBias));
            this.cBal = m.min(96, (m.max(32, 64 + m.round(rv(this.balOffset / ri(2, 3))) * (rf() < .5 ? -1 : 1) + this.sideBias)));
            this.refVar = ri(1, 10);
            this.cBal2 = rf() < .5 ? this.cBal + m.round(this.refVar * .5) : this.cBal + m.round(this.refVar * -.5);
            this.bassVar = this.refVar * rf(-2, 2);
            this.cBal3 = rf() < .5 ? this.cBal2 + m.round(this.bassVar * .5) : this.cBal2 + m.round(this.bassVar * -.5);
            p(c, ...['control_c'].flatMap(() => {
                const tmp = { tick: beatStart - 1, type: 'control_c' };
                _ = tmp;
                return [
                    ...source2.map(ch => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? this.lBal : this.rBal) : ch.toString().startsWith('rCH') ? (flipBin ? this.rBal : this.lBal) : ch === drumCH ? this.cBal3 + m.round((rf(-.5, .5) * this.bassVar)) : this.cBal] })),
                    ...reflection.map(ch => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? (rf() < .1 ? this.lBal + this.refVar * 2 : this.lBal + this.refVar) : (rf() < .1 ? this.rBal - this.refVar * 2 : this.rBal - this.refVar)) : ch.toString().startsWith('rCH') ? (flipBin ? (rf() < .1 ? this.rBal - this.refVar * 2 : this.rBal - this.refVar) : (rf() < .1 ? this.lBal + this.refVar * 2 : this.lBal + this.refVar)) : this.cBal2 + m.round((rf(-.5, .5) * this.refVar))] })),
                    ...bass.map(ch => ({ ...tmp, vals: [ch, 10, ch.toString().startsWith('lCH') ? (flipBin ? this.lBal + this.bassVar : this.rBal - this.bassVar) : ch.toString().startsWith('rCH') ? (flipBin ? this.rBal - this.bassVar : this.lBal + this.bassVar) : this.cBal3 + m.round((rf(-.5, .5) * this.bassVar))] })),
                    ...source2.map(ch => rlFX(ch, 1, 0, 60, (c) => c === cCH1, 0, 10)),
                    ...source2.map(ch => rlFX(ch, 5, 125, 127, (c) => c === cCH1, 126, 127)),
                    ...source2.map(ch => rlFX(ch, 11, 64, 127, (c) => c === cCH1 || c === drumCH, 115, 127)),
                    ...source2.map(ch => rlFX(ch, 65, 45, 64, (c) => c === cCH1, 35, 64)),
                    ...source2.map(ch => rlFX(ch, 67, 63, 64)),
                    ...source2.map(ch => rlFX(ch, 68, 63, 64)),
                    ...source2.map(ch => rlFX(ch, 69, 63, 64)),
                    ...source2.map(ch => rlFX(ch, 70, 0, 127)),
                    ...source2.map(ch => rlFX(ch, 71, 0, 127)),
                    ...source2.map(ch => rlFX(ch, 72, 64, 127)),
                    ...source2.map(ch => rlFX(ch, 73, 0, 64)),
                    ...source2.map(ch => rlFX(ch, 74, 80, 127)),
                    ...source2.map(ch => rlFX(ch, 91, 0, 33)),
                    ...source2.map(ch => rlFX(ch, 92, 0, 33)),
                    ...source2.map(ch => rlFX(ch, 93, 0, 33)),
                    ...source2.map(ch => rlFX(ch, 94, 0, 5, (c) => c === drumCH, 0, 64)),
                    ...source2.map(ch => rlFX(ch, 95, 0, 33)),
                    ...reflection.map(ch => rlFX(ch, 1, 0, 90, (c) => c === cCH2, 0, 15)),
                    ...reflection.map(ch => rlFX(ch, 5, 125, 127, (c) => c === cCH2, 126, 127)),
                    ...reflection.map(ch => rlFX(ch, 11, 77, 111, (c) => c === cCH2, 66, 99)),
                    ...reflection.map(ch => rlFX(ch, 65, 45, 64, (c) => c === cCH2, 35, 64)),
                    ...reflection.map(ch => rlFX(ch, 67, 63, 64)),
                    ...reflection.map(ch => rlFX(ch, 68, 63, 64)),
                    ...reflection.map(ch => rlFX(ch, 69, 63, 64)),
                    ...reflection.map(ch => rlFX(ch, 70, 0, 127)),
                    ...reflection.map(ch => rlFX(ch, 71, 0, 127)),
                    ...reflection.map(ch => rlFX(ch, 72, 64, 127)),
                    ...reflection.map(ch => rlFX(ch, 73, 0, 64)),
                    ...reflection.map(ch => rlFX(ch, 74, 80, 127)),
                    ...reflection.map(ch => rlFX(ch, 91, 0, 77, (c) => c === cCH2, 0, 32)),
                    ...reflection.map(ch => rlFX(ch, 92, 0, 77, (c) => c === cCH2, 0, 32)),
                    ...reflection.map(ch => rlFX(ch, 93, 0, 77, (c) => c === cCH2, 0, 32)),
                    ...reflection.map(ch => rlFX(ch, 94, 0, 64, (c) => c === cCH2, 0, 11)),
                    ...reflection.map(ch => rlFX(ch, 95, 0, 77, (c) => c === cCH2, 0, 32)),
                    ...bass.map(ch => rlFX(ch, 1, 0, 60, (c) => c === cCH3, 0, 10)),
                    ...bass.map(ch => rlFX(ch, 5, 125, 127, (c) => c === cCH3, 126, 127)),
                    ...bass.map(ch => rlFX(ch, 11, 88, 127, (c) => c === cCH3, 115, 127)),
                    ...bass.map(ch => rlFX(ch, 65, 45, 64, (c) => c === cCH3, 35, 64)),
                    ...bass.map(ch => rlFX(ch, 67, 63, 64)),
                    ...bass.map(ch => rlFX(ch, 68, 63, 64)),
                    ...bass.map(ch => rlFX(ch, 69, 63, 64)),
                    ...bass.map(ch => rlFX(ch, 70, 0, 127)),
                    ...bass.map(ch => rlFX(ch, 71, 0, 127)),
                    ...bass.map(ch => rlFX(ch, 72, 64, 127)),
                    ...bass.map(ch => rlFX(ch, 73, 0, 64)),
                    ...bass.map(ch => rlFX(ch, 74, 80, 127)),
                    ...bass.map(ch => rlFX(ch, 91, 0, 99, (c) => c === cCH3, 0, 64)),
                    ...bass.map(ch => rlFX(ch, 92, 0, 99, (c) => c === cCH3, 0, 64)),
                    ...bass.map(ch => rlFX(ch, 93, 0, 99, (c) => c === cCH3, 0, 64)),
                    ...bass.map(ch => rlFX(ch, 94, 0, 64, (c) => c === cCH3, 0, 11)),
                    ...bass.map(ch => rlFX(ch, 95, 0, 99, (c) => c === cCH3, 0, 64)),
                ];
            }));
        }
    }
    /**
     * Calculates cross-modulation value based on rhythm state across all levels
     * @returns {void}
     */
    crossModulateRhythms() {
        this.lastCrossMod = this.crossModulation;
        this.crossModulation = 0;
        this.crossModulation += beatRhythm[beatIndex] > 0 ? rf(1.5, 3) : m.max(rf(.625, 1.25), (1 / numerator) * beatsOff + (1 / numerator) * beatsOn) +
            divRhythm[divIndex] > 0 ? rf(1, 2) : m.max(rf(.5, 1), (1 / divsPerBeat) * divsOff + (1 / divsPerBeat) * divsOn) +
            subdivRhythm[subdivIndex] > 0 ? rf(.5, 1) : m.max(rf(.25, .5), (1 / subdivsPerDiv) * subdivsOff + (1 / subdivsPerDiv) * subdivsOn) +
            (subdivsOn < ri(7, 15) ? rf(.1, .3) : rf(-.1)) + (subdivsOff > ri() ? rf(.1, .3) : rf(-.1)) +
            (divsOn < ri(9, 15) ? rf(.1, .3) : rf(-.1)) + (divsOff > ri(3, 7) ? rf(.1, .3) : rf(-.1)) +
            (beatsOn < ri(3) ? rf(.1, .3) : rf(-.1)) + (beatsOff > ri(3) ? rf(.1, .3) : rf(-.1)) +
            (subdivsOn > ri(7, 15) ? rf(-.3, -.5) : rf(.1)) + (subdivsOff < ri() ? rf(-.3, -.5) : rf(.1)) +
            (divsOn > ri(9, 15) ? rf(-.2, -.4) : rf(.1)) + (divsOff < ri(3, 7) ? rf(-.2, -.4) : rf(.1)) +
            (beatsOn > ri(3) ? rf(-.2, -.3) : rf(.1)) + (beatsOff < ri(3) ? rf(-.1, -.3) : rf(.1)) +
            (subdivsPerMinute > ri(400, 600) ? rf(-.4, -.6) : rf(.1)) + (subdivsOn * rf(-.05, -.15)) + (beatRhythm[beatIndex] < 1 ? rf(.4, .5) : 0) + (divRhythm[divIndex] < 1 ? rf(.3, .4) : 0) + (subdivRhythm[subdivIndex] < 1 ? rf(.2, .3) : 0);
    }
    /**
     * Calculates note timing and sustain parameters for subdivision-based notes
     * @returns {void}
     */
    setNoteParams() {
        this.on = subdivStart + (tpSubdiv * rv(rf(.2), [-.1, .07], .3));
        this.shortSustain = rv(rf(m.max(tpDiv * .5, tpDiv / subdivsPerDiv), (tpBeat * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
        this.longSustain = rv(rf(tpDiv * .8, (tpBeat * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -.1]);
        this.useShort = subdivsPerMinute > ri(400, 650);
        this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * rv(rf(.8, 1.3));
        this.binVel = rv(velocity * rf(.42, .57));
    }
    /**
     * Generates MIDI note events for source channels (subdivision-based timing)
     * @returns {void}
     */
    playNotes() {
        this.setNoteParams();
        this.crossModulateRhythms();
        const noteObjects = composer ? composer.getNotes() : [];
        const motifNotes = activeMotif ? applyMotifToNotes(noteObjects, activeMotif) : noteObjects;
        if ((this.crossModulation + this.lastCrossMod) / rf(1.8, 2.2) > rv(rf(1.8, 2.8), [-.2, -.3], .05)) {
            if (composer)
                motifNotes.forEach(({ note }) => {
                    // Play source channels
                    source.filter(sourceCH => flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)).map(sourceCH => {
                        p(c, { tick: sourceCH === cCH1 ? this.on + rv(tpSubdiv * rf(1 / 9), [-.1, .1], .3) : this.on + rv(tpSubdiv * rf(1 / 3), [-.1, .1], .3), type: 'on', vals: [sourceCH, note, sourceCH === cCH1 ? velocity * rf(.95, 1.15) : this.binVel * rf(.95, 1.03)] });
                        p(c, { tick: this.on + this.sustain * (sourceCH === cCH1 ? 1 : rv(rf(.92, 1.03))), vals: [sourceCH, note] });
                    });
                    // Play reflection channels
                    reflection.filter(reflectionCH => flipBin ? flipBinT.includes(reflectionCH) : flipBinF.includes(reflectionCH)).map(reflectionCH => {
                        p(c, { tick: reflectionCH === cCH2 ? this.on + rv(tpSubdiv * rf(.2), [-.01, .1], .5) : this.on + rv(tpSubdiv * rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === cCH2 ? velocity * rf(.5, .8) : this.binVel * rf(.55, .9)] });
                        p(c, { tick: this.on + this.sustain * (reflectionCH === cCH2 ? rf(.7, 1.2) : rv(rf(.65, 1.3))), vals: [reflectionCH, note] });
                    });
                    // Play bass channels (with probability based on BPM)
                    if (rf() < clamp(.35 * bpmRatio3, .2, .7)) {
                        bass.filter(bassCH => flipBin ? flipBinT.includes(bassCH) : flipBinF.includes(bassCH)).map(bassCH => {
                            const bassNote = modClamp(note, 12, 35);
                            p(c, { tick: bassCH === cCH3 ? this.on + rv(tpSubdiv * rf(.1), [-.01, .1], .5) : this.on + rv(tpSubdiv * rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === cCH3 ? velocity * rf(1.15, 1.35) : this.binVel * rf(1.85, 2.45)] });
                            p(c, { tick: this.on + this.sustain * (bassCH === cCH3 ? rf(1.1, 3) : rv(rf(.8, 3.5))), vals: [bassCH, bassNote] });
                        });
                    }
                });
            subdivsOff = 0;
            subdivsOn++;
        }
        else {
            subdivsOff++;
            subdivsOn = 0;
        }
    }
    /**
     * Calculates note timing and sustain parameters for subsubdivision-based notes
     * @returns {void}
     */
    setNoteParams2() {
        this.on = subsubdivStart + (tpSubsubdiv * rv(rf(.2), [-.1, .07], .3));
        this.shortSustain = rv(rf(m.max(tpDiv * .5, tpDiv / subdivsPerDiv), (tpBeat * (.3 + rf() * .7))), [.1, .2], .1, [-.05, -.1]);
        this.longSustain = rv(rf(tpDiv * .8, (tpBeat * (.3 + rf() * .7))), [.1, .3], .1, [-.05, -.1]);
        this.useShort = subdivsPerMinute > ri(400, 650);
        this.sustain = (this.useShort ? this.shortSustain : this.longSustain) * rv(rf(.8, 1.3));
        this.binVel = rv(velocity * rf(.42, .57));
    }
    /**
     * Generates MIDI note events with complex stutter/shift effects (subsubdivision-based timing)
     * @returns {void}
     */
    playNotes2() {
        this.setNoteParams2();
        this.crossModulateRhythms();
        let reflectionCH;
        let bassCH;
        let bassNote;
        const noteObjects = composer ? composer.getNotes() : [];
        const motifNotes = activeMotif ? applyMotifToNotes(noteObjects, activeMotif) : noteObjects;
        if (true) {
            if (composer)
                motifNotes.forEach(({ note }) => {
                    source.filter(sourceCH => flipBin ? flipBinT.includes(sourceCH) : flipBinF.includes(sourceCH)).map(sourceCH => {
                        p(c, { tick: sourceCH === cCH1 ? this.on + rv(tpSubsubdiv * rf(1 / 9), [-.1, .1], .3) : this.on + rv(tpSubsubdiv * rf(1 / 3), [-.1, .1], .3), type: 'on', vals: [sourceCH, note, sourceCH === cCH1 ? velocity * rf(.95, 1.15) : this.binVel * rf(.95, 1.03)] });
                        p(c, { tick: this.on + this.sustain * (sourceCH === cCH1 ? 1 : rv(rf(.92, 1.03))), vals: [sourceCH, note] });
                        // Stutter-Shift: Random note stutter and octave shift.
                        const stutters = new Map();
                        const shifts = new Map();
                        let stutterApplied = false;
                        let globalStutterData = null;
                        if (!stutterApplied && rf() < rv(.2, [.5, 1], .3)) {
                            // Calculate stutter once for all Source channels
                            const numStutters = m.round(rv(rv(ri(3, 9), [2, 5], .33), [2, 5], .1));
                            globalStutterData = {
                                numStutters: numStutters,
                                duration: .25 * ri(1, 6) * this.sustain / numStutters,
                                minVelocity: 11,
                                maxVelocity: 111,
                                isFadeIn: rf() < 0.5,
                                decay: rf(.75, 1.25)
                            };
                            stutterApplied = true;
                        }
                        if (globalStutterData) {
                            const { numStutters, duration, minVelocity, maxVelocity, isFadeIn, decay } = globalStutterData;
                            for (let i = 0; i < numStutters; i++) {
                                const tick = this.on + duration * i;
                                let stutterNote = note;
                                if (rf() < .25) {
                                    if (!shifts.has(sourceCH))
                                        shifts.set(sourceCH, ri(-3, 3) * 12);
                                    const octaveShift = shifts.get(sourceCH);
                                    stutterNote = modClamp(note + octaveShift, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
                                }
                                let currentVelocity;
                                if (isFadeIn) {
                                    const fadeInMultiplier = decay * (i / (numStutters * rf(0.4, 2.2) - 1));
                                    currentVelocity = clamp(m.min(maxVelocity, ri(33) + maxVelocity * fadeInMultiplier), 0, 100);
                                }
                                else {
                                    const fadeOutMultiplier = 1 - (decay * (i / (numStutters * rf(0.4, 2.2) - 1)));
                                    currentVelocity = clamp(m.max(0, ri(33) + maxVelocity * fadeOutMultiplier), 0, 100);
                                }
                                p(c, { tick: tick - duration * rf(.15), vals: [sourceCH, stutterNote] });
                                p(c, { tick: tick + duration * rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === cCH1 ? currentVelocity * rf(.3, .7) : currentVelocity * rf(.45, .8)] });
                            }
                            p(c, { tick: this.on + this.sustain * rf(.5, 1.5), vals: [sourceCH, note] });
                        }
                        if (rf() < rv(.07, [.5, 1], .2)) { // Source Channels Stutter-Shift #2: Unique per channel.
                            if (!stutters.has(sourceCH))
                                stutters.set(sourceCH, m.round(rv(rv(ri(2, 7), [2, 5], .33), [2, 5], .1)));
                            const numStutters = stutters.get(sourceCH);
                            const duration = .25 * ri(1, 5) * this.sustain / numStutters;
                            for (let i = 0; i < numStutters; i++) {
                                const tick = this.on + duration * i;
                                let stutterNote = note;
                                if (rf() < .15) {
                                    if (!shifts.has(sourceCH))
                                        shifts.set(sourceCH, ri(-3, 3) * 12);
                                    const octaveShift = shifts.get(sourceCH);
                                    stutterNote = modClamp(note + octaveShift, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
                                }
                                if (rf() < .6) {
                                    p(c, { tick: tick - duration * rf(.15), vals: [sourceCH, stutterNote] });
                                    p(c, { tick: tick + duration * rf(.15, .6), type: 'on', vals: [sourceCH, stutterNote, sourceCH === cCH1 ? velocity * rf(.3, .7) : this.binVel * rf(.45, .8)] });
                                }
                            }
                            p(c, { tick: this.on + this.sustain * rf(.5, 1.5), vals: [sourceCH, note] });
                        }
                        reflectionCH = reflect[sourceCH];
                        p(c, { tick: reflectionCH === cCH2 ? this.on + rv(tpSubsubdiv * rf(.2), [-.01, .1], .5) : this.on + rv(tpSubsubdiv * rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [reflectionCH, note, reflectionCH === cCH2 ? velocity * rf(.5, .8) : this.binVel * rf(.55, .9)] });
                        p(c, { tick: this.on + this.sustain * (reflectionCH === cCH2 ? rf(.7, 1.2) : rv(rf(.65, 1.3))), vals: [reflectionCH, note] });
                        if (rf() < .2) { // Reflection Channels Stutter-Shift
                            if (!stutters.has(reflectionCH))
                                stutters.set(reflectionCH, m.round(rv(rv(ri(2, 7), [2, 5], .33), [2, 5], .1)));
                            const numStutters = stutters.get(reflectionCH);
                            const duration = .25 * ri(1, 8) * this.sustain / numStutters;
                            for (let i = 0; i < numStutters; i++) {
                                const tick = this.on + duration * i;
                                let stutterNote = note;
                                if (rf() < .7) {
                                    if (!shifts.has(reflectionCH))
                                        shifts.set(reflectionCH, ri(-3, 3) * 12);
                                    const octaveShift = shifts.get(reflectionCH);
                                    stutterNote = modClamp(note + octaveShift, m.max(0, OCTAVE.min * 12 - 1), OCTAVE.max * 12 - 1);
                                }
                                if (rf() < .5) {
                                    p(c, { tick: tick - duration * rf(.3), vals: [reflectionCH, stutterNote] });
                                    p(c, { tick: tick + duration * rf(.25, .7), type: 'on', vals: [reflectionCH, stutterNote, reflectionCH === cCH2 ? velocity * rf(.25, .65) : this.binVel * rf(.4, .75)] });
                                }
                            }
                            p(c, { tick: this.on + this.sustain * rf(.75, 2), vals: [reflectionCH, note] });
                        }
                        if (rf() < clamp(.35 * bpmRatio3, .2, .7)) {
                            bassCH = reflect2[sourceCH];
                            bassNote = modClamp(note, 12, 35);
                            p(c, { tick: bassCH === cCH3 ? this.on + rv(tpSubsubdiv * rf(.1), [-.01, .1], .5) : this.on + rv(tpSubsubdiv * rf(1 / 3), [-.01, .1], .5), type: 'on', vals: [bassCH, bassNote, bassCH === cCH3 ? velocity * rf(1.15, 1.35) : this.binVel * rf(1.85, 2.45)] });
                            p(c, { tick: this.on + this.sustain * (bassCH === cCH3 ? rf(1.1, 3) : rv(rf(.8, 3.5))), vals: [bassCH, bassNote] });
                            if (rf() < .7) { // Bass Channels Stutter-Shift
                                if (!stutters.has(bassCH))
                                    stutters.set(bassCH, m.round(rv(rv(ri(2, 5), [2, 3], .33), [2, 10], .1)));
                                const numStutters = stutters.get(bassCH);
                                const duration = .25 * ri(1, 8) * this.sustain / numStutters;
                                for (let i = 0; i < numStutters; i++) {
                                    const tick = this.on + duration * i;
                                    let stutterNote = bassNote;
                                    if (rf() < .5) {
                                        if (!shifts.has(bassCH))
                                            shifts.set(bassCH, ri(-2, 2) * 12);
                                        const octaveShift = shifts.get(bassCH);
                                        stutterNote = modClamp(bassNote + octaveShift, 0, 59);
                                    }
                                    if (rf() < .3) {
                                        p(c, { tick: tick - duration * rf(.3), vals: [bassCH, stutterNote] });
                                        p(c, { tick: tick + duration * rf(.25, .7), type: 'on', vals: [bassCH, stutterNote, bassCH === cCH3 ? velocity * rf(.55, .85) : this.binVel * rf(.75, 1.05)] });
                                    }
                                }
                                p(c, { tick: this.on + this.sustain * rf(.15, .35), vals: [bassCH, note] });
                            }
                        }
                    });
                });
        }
    }
}
// Export Stage instance to global namespace for tests
globalThis.stage = new Stage();
if (typeof globalThis !== 'undefined') {
    globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
    globalThis.__POLYCHRON_TEST__.stage = globalThis.stage;
}
//# sourceMappingURL=stage.js.map