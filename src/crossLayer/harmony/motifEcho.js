// src/crossLayer/motifEcho.js - Cross-layer motif echo / imitative counterpoint.
// When playMotifs generates a motif in L1, stores its interval sequence.
// After a delay (1-4 beats in L2's time), injects a transformed echo
// (retrograde, inversion, augmentation) into L2's motif pool.
// Creates fugue-like imitative counterpoint across polyrhythmic layers.

motifEcho = (() => {
  const V = validator.create('motifEcho');
  const CHANNEL = 'motifEcho';
  const ECHO_DELAY_BEATS_MIN = 1;
  const ECHO_DELAY_BEATS_MAX = 4;
  const MAX_PENDING_ECHOES = 8;
  const BASE_ECHO_PROBABILITY = 0.35;
  const TRANSFORMS = ['retrograde', 'inversion', 'augmentation', 'retrograde-inversion'];
  let cimScale = 0.5;

  /** @type {Array<{ intervals: number[], originLayer: string, captureSec: number, deliverSec: number, transform: string }>} */
  const pendingEchoes = [];

  /** @type {Map<string, number[]>} last few notes per layer to extract intervals */
  const recentNotes = new Map();
  const RECENT_WINDOW = 6;

  /**
   * Record a note to build interval sequences.
   * @param {number} midi - MIDI note
   * @param {string} layer - source layer
   * @param {number} absoluteSeconds - absolute ms
   */
  function recordNote(midi, layer, absoluteSeconds) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    if (!recentNotes.has(layer)) recentNotes.set(layer, []);
    const notes = recentNotes.get(layer);
    if (!notes) throw new Error('motifEcho.recordNote: missing recent notes for layer ' + layer);
    notes.push(midi);
    if (notes.length > RECENT_WINDOW) notes.shift();

    // When we accumulate enough notes, potentially capture a motif fragment
    // R51: CIM-modulated echo probability -- coordinated = more imitative echo, independent = less
    // R55: thematic density gate -- high recall suppresses new capture (preserve existing material)
    const melodicCtx = emergentMelodicEngine.getContext();
    const thematicMult = melodicCtx ? clamp(1.0 - melodicCtx.thematicDensity * 0.45, 0.55, 1.0) : 1.0;
    // Rhythmic coupling: strong emergent rhythm structure = natural thematic imitation moment.
    const rhythmEntryME = L0.getLast('emergentRhythm', { layer: 'both' });
    const rhythmBiasME = rhythmEntryME && Number.isFinite(rhythmEntryME.biasStrength) ? rhythmEntryME.biasStrength : 0;
    // R77 E2: harmonic-journey-eval gate -- suppress capture after key change (old-key motifs wrong tonal region)
    const journeyEntryME = L0.getLast('harmonic-journey-eval', { layer: 'both', since: absoluteSeconds - 2, windowSeconds: 2 });
    const journeySuppress = journeyEntryME && Number.isFinite(journeyEntryME.distance) && journeyEntryME.distance > 2
      ? clamp(journeyEntryME.distance * 0.08, 0, 0.45)
      : 0;
    // R78: phase-lock coupling -- repel mode opens space for imitation (layers offset creates echo opportunity),
    // lock mode suppresses echo (synchronized layers reinforce directly, no need for delayed imitation).
    const phaseModeEcho = safePreBoot.call(() => rhythmicPhaseLock.getMode(), 'drift');
    const phaseEchoScale = phaseModeEcho === 'repel' ? 1.15 : phaseModeEcho === 'lock' ? 0.88 : 1.0;
    // R90 E1: contourShape antagonism bridge with entropyRegulator (VIRGIN pair r=-0.503) -- falling melodic contour
    // boosts echo probability (descending = nostalgic repetition, imitative memory natural).
    // Rising contour suppresses echo (ascending = forward-looking, not looking back at old motifs).
    // Counterpart: entropyRegulator RAISES entropy under same signal (rising motion expands variety).
    const contourShapeScaleME = melodicCtx
      ? (melodicCtx.contourShape === 'rising' ? 0.88 : melodicCtx.contourShape === 'falling' ? 1.12 : 1.0)
      : 1.0;
    const echoProbability = BASE_ECHO_PROBABILITY * (0.4 + cimScale * 1.2) * thematicMult * (1.0 + rhythmBiasME * 0.18) * (1 - journeySuppress) * phaseEchoScale * contourShapeScaleME;
    if (notes.length >= 3 && rf() < echoProbability && pendingEchoes.length < MAX_PENDING_ECHOES) {
      captureMotif(layer, absoluteSeconds);
    }
  }

  /**
   * Capture current interval sequence and schedule echo for the other layer.
   * @param {string} layer
   * @param {number} absoluteSeconds
   */
  function captureMotif(layer, absoluteSeconds) {
    const notes = recentNotes.get(layer);
    if (!notes || notes.length < 3) throw new Error("motifEcho: notes must have >= 3 entries");

    // Extract interval sequence (relative intervals between consecutive notes)
    const intervals = [];
    for (let i = 1; i < notes.length; i++) {
      intervals.push(notes[i] - notes[i - 1]);
    }

    // Pick transform type - modulated by harmonic distance
    let transform = TRANSFORMS[ri(TRANSFORMS.length - 1)];
    const harmonicEntry = L0.getLast('harmonic', { layer: 'both' });
    if (harmonicEntry && Number.isFinite(harmonicEntry.excursion) && harmonicEntry.excursion > 3) {
      transform = rf() < 0.6 ? 'retrograde-inversion' : 'inversion';
    }
    // R55: contour-aware transform -- echo mirrors the melodic arc direction
    const captureCtx = emergentMelodicEngine.getContext();
    if (captureCtx && rf() < 0.55) {
      if (captureCtx.contourShape === 'rising')  transform = rf() < 0.65 ? 'retrograde' : transform;
      else if (captureCtx.contourShape === 'falling') transform = rf() < 0.65 ? 'inversion' : transform;
      else if (captureCtx.contourShape === 'arching') transform = rf() < 0.55 ? 'retrograde-inversion' : transform;
    }
    const identityChoice = motifIdentityMemory.chooseEchoTransform(layer);
    if (identityChoice && typeof identityChoice.transform === 'string' && rf() < clamp(identityChoice.bias, 0, 1)) {
      transform = identityChoice.transform;
    }

    // Schedule delivery after a random delay in beats
    const delayBeats = ri(ECHO_DELAY_BEATS_MIN, ECHO_DELAY_BEATS_MAX);
    const deliverSec = absoluteSeconds + delayBeats * (spBeat > 0 ? spBeat : 0.5);

    pendingEchoes.push({
      intervals,
      originLayer: layer,
      captureSec: absoluteSeconds,
      deliverSec: deliverSec,
      transform
    });

    // Post to ATG for visibility
    L0.post(CHANNEL, layer, absoluteSeconds, {
      intervals,
      transform,
      delayBeats
    });
  }

  /**
   * Transform an interval sequence.
   * @param {number[]} intervals
   * @param {string} transform
   * @returns {number[]} transformed intervals
   */
  function applyTransform(intervals, transform) {
    switch (transform) {
      case 'retrograde':
        return [...intervals].reverse();
      case 'inversion':
        return intervals.map(i => -i);
      case 'augmentation':
        return intervals.map(i => m.round(i * 1.5));
      case 'retrograde-inversion':
        return [...intervals].reverse().map(i => -i);
      default:
        return intervals;
    }
  }

  /**
   * Check for pending echoes ready to deliver to the active layer.
   * Returns transformed note offsets that can bias the next motif selection.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - receiving layer
   * @param {number} currentMidi - the note currently being placed (as anchor)
   * @returns {{ notes: number[], transform: string, echoIndex: number } | null}
   */
  function deliverEcho(absoluteSeconds, activeLayer, currentMidi) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.requireFinite(currentMidi, 'currentMidi');

    // Find the first pending echo whose delivery time has passed and targets this layer
    for (let i = 0; i < pendingEchoes.length; i++) {
      const echo = pendingEchoes[i];
      const targetLayer = crossLayerHelpers.getOtherLayer(echo.originLayer);
      if (targetLayer !== activeLayer) continue;
      if (absoluteSeconds < echo.deliverSec) continue;

      // Deliver this echo
      pendingEchoes.splice(i, 1);

      const transformed = applyTransform(echo.intervals, echo.transform);

      // Convert intervals to absolute MIDI notes anchored on currentMidi
  const { lo, hi } = crossLayerHelpers.getOctaveBounds();
      const notes = [currentMidi];
      let cursor = currentMidi;
      for (let j = 0; j < transformed.length; j++) {
        cursor = clamp(cursor + transformed[j], lo, hi);
        notes.push(cursor);
      }

      return { notes, transform: echo.transform, echoIndex: i };
    }
    return null;
  }

  /** @returns {number} count of pending echoes */
  function getPendingCount() { return pendingEchoes.length; }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  function reset() {
    pendingEchoes.length = 0;
    recentNotes.clear();
    cimScale = 0.5;
  }

  return { recordNote, captureMotif, applyTransform, deliverEcho, getPendingCount, setCoordinationScale, reset };
})();
crossLayerRegistry.register('motifEcho', motifEcho, ['all', 'phrase']);
