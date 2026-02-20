// Consolidated rhythm tracking function — explicit context-based API
const VTrackRhythm = Validator.create('trackRhythm');

trackRhythm = (unit, layer, played) => {
  VTrackRhythm.assertObject(layer, 'layer');
  VTrackRhythm.assertNonEmptyString(unit, 'unit');
  const key = unit.toLowerCase();
  VTrackRhythm.requireEnum(key, ['beat', 'div', 'subdiv', 'subsubdiv'], 'unit');

  const incrementCounter = (counterKey) => {
    const existing = layer[counterKey];
    if (typeof existing === 'undefined') {
      layer[counterKey] = 1;
    } else if (!Number.isFinite(existing)) {
      throw new Error(`trackRhythm: counter "${counterKey}" must be finite when defined`);
    } else {
      layer[counterKey] = existing + 1;
    }
  };

  // If caller explicitly tells us whether a play occurred, respect that
  if (typeof played === 'boolean') {
    if (played) {
      incrementCounter(`${key}sOn`);
      layer[`${key}sOff`] = 0;
    } else {
      layer[`${key}sOn`] = 0;
      incrementCounter(`${key}sOff`);
    }
    return;
  }

  // Otherwise, derive from the rhythm array as before
  const rhythm = layer[`${key}Rhythm`];
  const idx = layer[`${key}Index`];
  // Prefer per-context rhythm/index, but fall back to globals when available.
  let rhythmFinal = Array.isArray(rhythm) ? rhythm : null;
  let idxFinal = (typeof idx !== 'undefined') ? idx : undefined;

  // Try global fallbacks without using globalThis (project convention: naked globals)
  if (!Array.isArray(rhythmFinal) || typeof idxFinal === 'undefined') {
    switch (key) {
      case 'beat':
        if (!Array.isArray(rhythmFinal) && typeof beatRhythm !== 'undefined') rhythmFinal = beatRhythm;
        if (typeof idxFinal === 'undefined' && typeof beatIndex !== 'undefined') idxFinal = beatIndex;
        break;
      case 'div':
        if (!Array.isArray(rhythmFinal) && typeof divRhythm !== 'undefined') rhythmFinal = divRhythm;
        if (typeof idxFinal === 'undefined' && typeof divIndex !== 'undefined') idxFinal = divIndex;
        break;
      case 'subdiv':
        if (!Array.isArray(rhythmFinal) && typeof subdivRhythm !== 'undefined') rhythmFinal = subdivRhythm;
        if (typeof idxFinal === 'undefined' && typeof subdivIndex !== 'undefined') idxFinal = subdivIndex;
        break;
      case 'subsubdiv':
        if (!Array.isArray(rhythmFinal) && typeof subsubdivRhythm !== 'undefined') rhythmFinal = subsubdivRhythm;
        if (typeof idxFinal === 'undefined' && typeof subsubdivIndex !== 'undefined') idxFinal = subsubdivIndex;
        break;
      default:
        throw new Error(`trackRhythm: unknown unit "${unit}"`);
  }
}
  // If still missing or invalid, this is a critical invariance violation — fail fast.
  if (!Array.isArray(rhythmFinal) || typeof idxFinal === 'undefined' || typeof rhythmFinal[idxFinal] === 'undefined') {
    const details = { unit, key, layerHasRhythm: Array.isArray(rhythm), layerIdxDefined: typeof idx !== 'undefined', globalHasRhythm: Array.isArray(rhythmFinal), globalIdxDefined: typeof idxFinal !== 'undefined' };
    throw new Error(`trackRhythm: missing rhythm or index for unit "${unit}" - details: ${JSON.stringify(details)}`);
  }
  const val = rhythmFinal[idxFinal];

  if (val > 0) {
    incrementCounter(`${key}sOn`);
    layer[`${key}sOff`] = 0;
  } else if (val === 0) {
    layer[`${key}sOn`] = 0;
    incrementCounter(`${key}sOff`);
  } else {
    throw new Error(`trackRhythm: rhythm value for unit "${unit}" must be 0 or > 0, received ${String(val)}`);
  }
  return;
}
