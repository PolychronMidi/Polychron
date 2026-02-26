// Consolidated rhythm tracking function — explicit context-based API
const V = validator.create('trackRhythm');

trackRhythm = (unit, layer, played) => {
  V.assertObject(layer, 'layer');
  V.assertNonEmptyString(unit, 'unit');
  const key = unit.toLowerCase();
  V.requireEnum(key, ['beat', 'div', 'subdiv', 'subsubdiv'], 'unit');

  const incrementCounter = (counterKey) => {
    const existing = layer[counterKey];
    if (existing === undefined) {
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
  let idxFinal = idx;

  // Try global fallbacks without using globalThis (project convention: naked globals)
  if (!Array.isArray(rhythmFinal) || idxFinal === undefined) {
    switch (key) {
      case 'beat':
        if (!Array.isArray(rhythmFinal)) rhythmFinal = Array.isArray(beatRhythm) ? beatRhythm : null;
        if (idxFinal === undefined) idxFinal = beatIndex;
        break;
      case 'div':
        if (!Array.isArray(rhythmFinal)) rhythmFinal = Array.isArray(divRhythm) ? divRhythm : null;
        if (idxFinal === undefined) idxFinal = divIndex;
        break;
      case 'subdiv':
        if (!Array.isArray(rhythmFinal)) rhythmFinal = Array.isArray(subdivRhythm) ? subdivRhythm : null;
        if (idxFinal === undefined) idxFinal = subdivIndex;
        break;
      case 'subsubdiv':
        if (!Array.isArray(rhythmFinal)) rhythmFinal = Array.isArray(subsubdivRhythm) ? subsubdivRhythm : null;
        if (idxFinal === undefined) idxFinal = subsubdivIndex;
        break;
      default:
        throw new Error(`trackRhythm: unknown unit "${unit}"`);
  }
}
  // If still missing or invalid, this is a critical invariance violation — fail fast.
  if (!Array.isArray(rhythmFinal) || idxFinal === undefined || rhythmFinal[idxFinal] === undefined) {
    const details = { unit, key, layerHasRhythm: Array.isArray(rhythm), layerIdxDefined: idx !== undefined, globalHasRhythm: Array.isArray(rhythmFinal), globalIdxDefined: idxFinal !== undefined };
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
