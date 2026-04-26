moduleLifecycle.declare({
  name: 'motifIdentityMemory',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['motifIdentityMemory'],
  crossLayerScopes: ['all', 'phrase'],
  init: (deps) => {
  const V = deps.validator.create('motifIdentityMemory');
  const MAX_NOTES = 24;
  const MAX_IDENTITIES = 16;

  /** @type {Map<string, number[]>} */
  const notesByLayer = new Map();
  /** @type {Map<string, Array<{ intervalDna: string, contour: string, confidence: number, absoluteSeconds: number }>>} */
  const identitiesByLayer = new Map();
  // R34: pattern histogram for saturation detection
  /** @type {Map<string, Map<string, number>>} */
  const patternHistByLayer = new Map();

  /** @param {string} layer */
  function ensureNotes(layer) {
    if (!notesByLayer.has(layer)) notesByLayer.set(layer, []);
    const row = notesByLayer.get(layer);
    if (!row) throw new Error('motifIdentityMemory: failed to initialize notes for layer ' + layer);
    return row;
  }

  /** @param {string} layer */
  function ensureIdentities(layer) {
    if (!identitiesByLayer.has(layer)) identitiesByLayer.set(layer, []);
    const row = identitiesByLayer.get(layer);
    if (!row) throw new Error('motifIdentityMemory: failed to initialize identities for layer ' + layer);
    return row;
  }

  /**
   * @param {string} layer
   * @param {number} midi
   * @param {number} absoluteSeconds
   */
  function recordNote(layer, midi, absoluteSeconds) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    // R36: emission accountability -- use actual emitted note if available
    const deltaEntry = L0.getLast(L0_CHANNELS.emissionDelta, { layer, since: absoluteSeconds - 0.05, windowSeconds: 0.05 });
    const actualMidi = deltaEntry && Number.isFinite(deltaEntry.emitted) ? deltaEntry.emitted : midi;

    const notes = ensureNotes(layer);
    notes.push(actualMidi);
    if (notes.length > MAX_NOTES) notes.shift();

    if (notes.length < 4) return null;

    const window = notes.slice(-4);
    const intervals = [];
    for (let i = 1; i < window.length; i++) intervals.push(window[i] - window[i - 1]);
    const intervalDna = intervals.join(',');

    const up = intervals.filter(v => v > 0).length;
    const down = intervals.filter(v => v < 0).length;
    const contour = up > down ? 'up' : down > up ? 'down' : 'mixed';
    const confidence = clamp((m.abs(intervals[0]) + m.abs(intervals[1]) + m.abs(intervals[2])) / 18, 0, 1);

    const identity = { intervalDna, contour, confidence, absoluteSeconds };
    const identities = ensureIdentities(layer);
    identities.push(identity);
    // R34: track pattern frequency for saturation detection
    if (!patternHistByLayer.has(layer)) patternHistByLayer.set(layer, new Map());
    const hist = /** @type {Map<string, number>} */ (patternHistByLayer.get(layer));
    hist.set(intervalDna, (hist.get(intervalDna) ?? 0) + 1);
    const patternCount = hist.get(intervalDna) ?? 0;
    const isSaturated = patternCount > 4;
    L0.post(L0_CHANNELS.motifIdentity, layer, absoluteSeconds, { intervalDna, contour, confidence, saturated: isSaturated });
    if (identities.length > MAX_IDENTITIES) identities.shift();

    return identity;
  }

  /** @param {string} layer */
  function getActiveIdentity(layer) {
    const identities = ensureIdentities(layer);
    if (identities.length === 0) return null;
    return identities[identities.length - 1];
  }

  /**
   * @param {string} layer
   * @returns {{ transform: 'retrograde'|'inversion'|'augmentation'|'retrograde-inversion', bias: number } | null}
   */
  function chooseEchoTransform(layer) {
    const identity = getActiveIdentity(layer);
    if (!identity) return null;

    let transform = /** @type {'retrograde'|'inversion'|'augmentation'|'retrograde-inversion'} */ ('retrograde');
    if (identity.contour === 'up') transform = 'retrograde-inversion';
    else if (identity.contour === 'down') transform = 'inversion';
    else if (identity.confidence > 0.55) transform = 'augmentation';
    // R34: if pattern is saturated, force a different transform to break repetition
    const hist = patternHistByLayer.get(layer);
    const isSaturated = hist && (hist.get(identity.intervalDna) ?? 0) > 4;
    if (isSaturated) {
      const transforms = /** @type {Array<'retrograde'|'inversion'|'augmentation'|'retrograde-inversion'>} */ (['retrograde', 'inversion', 'augmentation', 'retrograde-inversion']);
      transform = transforms[ri(0, 3)];
    }
    // Melodic coupling: thematicDensity biases toward augmentation when themes are established.
    // Strong thematic recall -> stretch the familiar; fresh territory -> let contour drive.
    const melodicCtxMIM = emergentMelodicEngine.getContext();
    const thematicDensity = melodicCtxMIM ? V.optionalFinite(melodicCtxMIM.thematicDensity, 0) : 0;
    if (!isSaturated && thematicDensity >= 1 && identity.confidence > 0.4) transform = 'augmentation';

    return { transform, bias: identity.confidence };
  }

  function reset() {
    notesByLayer.clear();
    identitiesByLayer.clear();
    patternHistByLayer.clear();
  }

  return { recordNote, getActiveIdentity, chooseEchoTransform, reset };
  },
});
