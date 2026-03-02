motifIdentityMemory = (() => {
  const V = validator.create('motifIdentityMemory');
  const MAX_NOTES = 24;
  const MAX_IDENTITIES = 16;

  /** @type {Map<string, number[]>} */
  const notesByLayer = new Map();
  /** @type {Map<string, Array<{ intervalDna: string, contour: string, confidence: number, absTimeMs: number }>>} */
  const identitiesByLayer = new Map();

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
   * @param {number} absTimeMs
   */
  function recordNote(layer, midi, absTimeMs) {
    V.requireFinite(midi, 'midi');
    V.requireFinite(absTimeMs, 'absTimeMs');

    const notes = ensureNotes(layer);
    notes.push(midi);
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

    const identity = { intervalDna, contour, confidence, absTimeMs };
    const identities = ensureIdentities(layer);
    identities.push(identity);
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

    return { transform, bias: identity.confidence };
  }

  function reset() {
    notesByLayer.clear();
    identitiesByLayer.clear();
  }

  return { recordNote, getActiveIdentity, chooseEchoTransform, reset };
})();
crossLayerRegistry.register('motifIdentityMemory', motifIdentityMemory, ['all', 'phrase']);
