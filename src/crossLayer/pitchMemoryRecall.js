// src/crossLayer/pitchMemoryRecall.js — Long-term thematic pitch memory.
// Remembers significant pitch patterns across sections (NOT reset at section boundaries).
// When convergence, cadence, or downbeat events occur, recalls earlier material
// for thematic unity. This is the only cross-layer module that persists across
// sections by design — it's the long-term memory of the composition.

PitchMemoryRecall = (() => {
  const V = Validator.create('PitchMemoryRecall');
  const MAX_MEMORIES = 64;
  const RECALL_PROBABILITY = 0.2;
  const MIN_RECALL_INTERVAL_MS = 3000;

  /**
   * @typedef {{ intervalDna: number[], pitchClasses: number[], strength: number, sectionIdx: number, absTimeMs: number }} PitchMemory
   */

  /** @type {PitchMemory[]} */
  const memories = [];
  let lastRecallMs = -Infinity;
  let recallCount = 0;

  /**
   * Memorize a significant pitch pattern for future recall.
   * @param {number[]} intervalDna - sequence of semitone intervals
   * @param {number[]} pitchClasses - pitch classes 0–11
   * @param {{ convergence?: boolean, cadence?: boolean, downbeat?: boolean }} strengthSignals
   * @param {number} sectionIdx
   */
  function memorize(intervalDna, pitchClasses, strengthSignals, sectionIdx) {
    if (!Array.isArray(intervalDna) || intervalDna.length < 2) return;
    if (!Array.isArray(pitchClasses) || pitchClasses.length < 2) return;
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

    const absTimeMs = Number.isFinite(beatStartTime) ? beatStartTime * 1000 : 0;

    memories.push({
      intervalDna: intervalDna.slice(0, 8), // limit DNA length
      pitchClasses: pitchClasses.slice(0, 8),
      strength,
      sectionIdx,
      absTimeMs
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
   * Triggered by convergence, cadence, or downbeat — uses similarity to current
   * material to find the best match.
   * @param {string} activeLayer
   * @param {number} currentMidi
   * @param {number} absTimeMs
   * @returns {{ notes: number[], transform: string, memoryIdx: number } | null}
   */
  function recall(activeLayer, currentMidi, absTimeMs) {
    V.requireFinite(currentMidi, 'currentMidi');
    V.requireFinite(absTimeMs, 'absTimeMs');

    if (memories.length === 0) return null;
    if (absTimeMs - lastRecallMs < MIN_RECALL_INTERVAL_MS) return null;
    if (rf() > RECALL_PROBABILITY) return null;

    // Check if a significant event is happening (convergence/downbeat)
    const hasConvergence = (typeof ConvergenceDetector !== 'undefined' && ConvergenceDetector &&
      typeof ConvergenceDetector.wasRecent === 'function')
      ? ConvergenceDetector.wasRecent(absTimeMs, activeLayer, 400)
      : false;

    const hasDownbeat = (typeof EmergentDownbeat !== 'undefined' && EmergentDownbeat)
      ? false // downbeat detection is tick-level, checked externally
      : false;

    if (!hasConvergence && !hasDownbeat && rf() > 0.3) return null;

    // Find best matching memory by pitch-class similarity
    const currentPC = currentMidi % 12;
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < memories.length; i++) {
      const mem = memories[i];
      // Similarity: how many pitch classes match
      const pcOverlap = mem.pitchClasses.filter(pc => pc === currentPC).length;
      // Prefer memories from different sections (thematic recall, not repetition)
      const sectionDist = Math.abs((typeof sectionIndex === 'number' ? sectionIndex : 0) - mem.sectionIdx);
      const score = mem.strength * 0.4 + (pcOverlap > 0 ? 0.3 : 0) + clamp(sectionDist * 0.1, 0, 0.3);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return null;

    const mem = memories[bestIdx];
    // Transpose the recalled pattern to start from the current note
    const transposition = currentMidi - (mem.pitchClasses[0] + 60); // center around middle C
    const notes = mem.intervalDna.reduce((acc, interval) => {
      const lastNote = acc[acc.length - 1];
      const next = lastNote + interval;
      const clamped = clamp(next, OCTAVE.min * 12 - 1, OCTAVE.max * 12 - 1);
      acc.push(clamped);
      return acc;
    }, [clamp(currentMidi + transposition * 0, OCTAVE.min * 12 - 1, OCTAVE.max * 12 - 1)]);

    // Boost the recalled memory's strength (reinforcement learning)
    memories[bestIdx].strength = clamp(mem.strength + 0.05, 0, 1);

    lastRecallMs = absTimeMs;
    recallCount++;

    const transforms = ['transpose', 'invert', 'retrograde', 'identity'];
    const transform = transforms[ri(transforms.length - 1)];

    return { notes, transform, memoryIdx: bestIdx };
  }

  /** @returns {number} */
  function getMemoryCount() { return memories.length; }

  /** @returns {number} */
  function getRecallCount() { return recallCount; }

  // NO reset() — this module intentionally persists across sections

  return { memorize, recall, getMemoryCount, getRecallCount };
})();
