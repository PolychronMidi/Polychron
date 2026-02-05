// Consolidated rhythm tracking function — explicit context-based API
trackRhythm = (unit, layer, played) => {
  try {
    if (!layer) throw new Error('trackRhythm requires a context object');
    const key = (unit || '').toString().toLowerCase();
    const unitNames = ['beat', 'div', 'subdiv', 'subsubdiv'];
    if (!unitNames.includes(key)) {
      console.warn(`trackRhythm: unknown unit "${unit}"`);
      return false;
    }

    // If caller explicitly tells us whether a play occurred, respect that
    if (typeof played === 'boolean') {
      if (played) {
        layer[`${key}sOn`] = (layer[`${key}sOn`] || 0) + 1;
        layer[`${key}sOff`] = 0;
      } else {
        layer[`${key}sOn`] = 0;
        layer[`${key}sOff`] = (layer[`${key}sOff`] || 0) + 1;
      }
      return true;
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
          console.warn(`trackRhythm: unknown unit "${unit}"`);
          break;
      }
    }

    // If still missing or invalid, this is a critical invariance violation — fail fast.
    if (!Array.isArray(rhythmFinal) || typeof idxFinal === 'undefined' || typeof rhythmFinal[idxFinal] === 'undefined') {
      const details = { unit, key, layerHasRhythm: Array.isArray(rhythm), layerIdxDefined: typeof idx !== 'undefined', globalHasRhythm: Array.isArray(rhythmFinal), globalIdxDefined: typeof idxFinal !== 'undefined' };
      console.error(`trackRhythm: CRITICAL missing rhythm/index for unit "${unit}"`, details);
      throw new Error(`trackRhythm: missing rhythm or index for unit "${unit}"`);
    }
    const val = rhythmFinal[idxFinal];

    if (val > 0) {
      layer[`${key}sOn`] = (layer[`${key}sOn`] || 0) + 1;
      layer[`${key}sOff`] = 0;
    } else if (val === 0) {
      layer[`${key}sOn`] = 0;
      layer[`${key}sOff`] = (layer[`${key}sOff`] || 0) + 1;
    }
  } catch (e) { console.warn('trackRhythm error:', e); throw e; }
  // Normalize return to boolean for consistent-return rule
  return true;
}
