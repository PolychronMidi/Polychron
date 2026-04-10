// src/crossLayer/pitchMemoryRecall.js - Long-term thematic pitch memory.
// Remembers significant pitch patterns across sections (NOT reset at section boundaries).
// When convergence, cadence, or downbeat events occur, recalls earlier material
// for thematic unity. This is the only cross-layer module that persists across
// sections by design - it's the long-term memory of the composition.

pitchMemoryRecall = (() => {
  const V = validator.create('pitchMemoryRecall');
  const MAX_MEMORIES = 64;
  const RECALL_PROBABILITY = 0.2;
  const MIN_RECALL_INTERVAL_SEC = 3;

  /**
   * @typedef {{ intervalDna: number[], pitchClasses: number[], strength: number, sectionIdx: number, absoluteSeconds: number }} PitchMemory
   */

  /** @type {PitchMemory[]} */
  const memories = [];
  let lastRecallSec = -Infinity;
  let recallCount = 0;

  /**
   * Memorize a significant pitch pattern for future recall.
   * @param {number[]} intervalDna - sequence of semitone intervals
   * @param {number[]} pitchClasses - pitch classes 0-11
   * @param {{ convergence?: boolean, cadence?: boolean, downbeat?: boolean }} strengthSignals
   * @param {number} sectionIdx
   */
  function memorize(intervalDna, pitchClasses, strengthSignals, sectionIdx) {
    V.assertArray(intervalDna, 'intervalDna');
    if (intervalDna.length < 2) return;
    V.assertArray(pitchClasses, 'pitchClasses');
    if (pitchClasses.length < 2) return;
    V.requireFinite(sectionIdx, 'sectionIdx');

    const sig = (strengthSignals && typeof strengthSignals === 'object') ? strengthSignals : {};
    // Strength is boosted by convergence, cadence, and downbeat events
    let strength = 0.3;
    if (sig.convergence) strength += 0.25;
    if (sig.cadence) strength += 0.2;
    if (sig.downbeat) strength += 0.15;
    strength = clamp(strength, 0, 1);

    // Don't store very weak patterns
    if (strength < 0.35) return;

    const absoluteSeconds = beatStartTime;

    memories.push({
      intervalDna: intervalDna.slice(0, 8), // limit DNA length
      pitchClasses: pitchClasses.slice(0, 8),
      strength,
      sectionIdx,
      absoluteSeconds
    });

    // Evict weakest if over capacity
    if (memories.length > MAX_MEMORIES) {
      let weakestIdx = 0;
      let weakestStrength = Infinity;
      for (let i = 0; i < memories.length; i++) {
        if (memories[i].strength < weakestStrength) {
          weakestStrength = memories[i].strength;
          weakestIdx = i;
        }
      }
      memories.splice(weakestIdx, 1);
    }
  }

  /**
   * Attempt recall of a past pitch pattern relevant to the current musical moment.
   * Triggered by convergence, cadence, or downbeat - uses similarity to current
   * material to find the best match.
   * @param {string} activeLayer
   * @param {number} currentMidi
   * @param {number} absoluteSeconds
   * @returns {{ notes: number[], transform: string, memoryIdx: number } | null}
   */
  function recall(activeLayer, currentMidi, absoluteSeconds) {
    V.requireFinite(currentMidi, 'currentMidi');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');

    if (memories.length === 0) return null;
    if (absoluteSeconds - lastRecallSec < MIN_RECALL_INTERVAL_SEC) return null;
    // R41: regime-responsive recall probability. Coherent = more recall (reinforce patterns),
    // exploring = less recall (seek novelty). System's memory behavior adapts to its state.
    const recallRegime = regimeClassifier.getLastRegime();
    const recallScale = recallRegime === 'coherent' ? 1.4 : recallRegime === 'exploring' ? 0.6 : 1.0;
    // Melodic coupling: stale territory -> pull from memory to break repetition;
    // fresh territory -> let novelty continue, suppress recall.
    const melodicCtxPMR = emergentMelodicEngine.getContext();
    const freshnessEma = melodicCtxPMR ? V.optionalFinite(melodicCtxPMR.freshnessEma, 0.5) : 0.5;
    const freshnessRecallScale = 1.3 - freshnessEma * 0.6; // 0.7 fresh ... 1.3 stale
    if (rf() > RECALL_PROBABILITY * recallScale * freshnessRecallScale) return null;

    // Check if a significant event is happening (convergence/downbeat)
    const hasConvergence = convergenceDetector.wasRecent(absoluteSeconds, activeLayer, 400) ?? false;

    const hasDownbeat = Boolean(emergentDownbeat);

    if (!hasConvergence && !hasDownbeat && rf() > 0.3 * recallScale) return null;

    // Find best matching memory by pitch-class similarity + feedback pitch preference
    const currentPC = currentMidi % 12;
    const feedbackPitchEntry = L0.getLast(L0_CHANNELS.feedbackPitch, { layer: activeLayer, windowSeconds: 2 });
    const feedbackPC = feedbackPitchEntry && Number.isFinite(feedbackPitchEntry.pitchClass) ? feedbackPitchEntry.pitchClass : -1;
    let bestIdx = -1;
    let bestScore = -Infinity;

    const sectionPos = timeStream.getPosition('section');
    for (let i = 0; i < memories.length; i++) {
      const mem = memories[i];
      const hasMatch = mem.pitchClasses.includes(currentPC);
      const hasFeedbackMatch = feedbackPC >= 0 && mem.pitchClasses.includes(feedbackPC);
      const sectionDist = m.abs(sectionPos - mem.sectionIdx);
      const score = mem.strength * 0.4 + (hasMatch ? 0.3 : 0) + (hasFeedbackMatch ? 0.2 : 0) + clamp(sectionDist * 0.1, 0, 0.3);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return null;

    const mem = memories[bestIdx];
    // Transpose the recalled pattern to start from the current note
    const transposition = currentMidi - (mem.pitchClasses[0] + 60); // center around middle C
    const minNote = OCTAVE.min * 12 - 1;
    const maxNote = OCTAVE.max * 12 - 1;
    const notes = [clamp(currentMidi + transposition * 0, minNote, maxNote)];
    for (let di = 0; di < mem.intervalDna.length; di++) {
      notes.push(clamp(notes[notes.length - 1] + mem.intervalDna[di], minNote, maxNote));
    }

    // Boost the recalled memory's strength (reinforcement learning)
    memories[bestIdx].strength = clamp(mem.strength + 0.05, 0, 1);

    lastRecallSec = absoluteSeconds;
    recallCount++;

    const transforms = ['transpose', 'invert', 'retrograde', 'identity'];
    const transform = transforms[ri(transforms.length - 1)];

    return { notes, transform, memoryIdx: bestIdx };
  }

  /** @returns {number} */
  function getMemoryCount() { return memories.length; }

  /** @returns {number} */
  function getRecallCount() { return recallCount; }

  // Persists across section and phrase boundaries by design - this is the
  // composition's long-term thematic memory. Only a full resetAll clears it.
  function reset() {
    memories.length = 0;
    lastRecallSec = -Infinity;
    recallCount = 0;
  }

  return { memorize, recall, getMemoryCount, getRecallCount, reset };
})();
crossLayerRegistry.register('pitchMemoryRecall', pitchMemoryRecall, ['all']);
