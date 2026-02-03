// Consolidated rhythm tracking function — explicit context-based API
trackRhythm = (unit, ctx, played) => {
  try {
    if (!ctx) throw new Error('trackRhythm requires a context object');
    const key = (unit || '').toString().toLowerCase();
    const unitNames = ['beat', 'div', 'subdiv', 'subsubdiv'];
    if (!unitNames.includes(key)) {
      console.warn(`trackRhythm: unknown unit "${unit}"`);
      return false;
    }

    // If caller explicitly tells us whether a play occurred, respect that
    if (typeof played === 'boolean') {
      if (played) {
        ctx[`${key}sOn`] = (ctx[`${key}sOn`] || 0) + 1;
        ctx[`${key}sOff`] = 0;
      } else {
        ctx[`${key}sOn`] = 0;
        ctx[`${key}sOff`] = (ctx[`${key}sOff`] || 0) + 1;
      }
      return true;
    }

    // Otherwise, derive from the rhythm array as before
    const rhythm = ctx[`${key}Rhythm`];
    const idx = ctx[`${key}Index`];
    // Prefer per-context rhythm/index, but fall back to globals when available.
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
          break;
      }
    }

    // If still missing or invalid, this is a critical invariance violation — fail fast.
    if (!Array.isArray(rhythmFinal) || typeof idxFinal === 'undefined' || typeof rhythmFinal[idxFinal] === 'undefined') {
      const details = { unit, key, ctxHasRhythm: Array.isArray(rhythm), ctxIdxDefined: typeof idx !== 'undefined', globalHasRhythm: Array.isArray(rhythmFinal), globalIdxDefined: typeof idxFinal !== 'undefined' };
      console.error(`trackRhythm: CRITICAL missing rhythm/index for unit "${unit}"`, details);
      throw new Error(`trackRhythm: missing rhythm or index for unit "${unit}"`);
    }
    const val = rhythmFinal[idxFinal];

    if (val > 0) {
      ctx[`${key}sOn`] = (ctx[`${key}sOn`] || 0) + 1;
      ctx[`${key}sOff`] = 0;
    } else if (val === 0) {
      ctx[`${key}sOn`] = 0;
      ctx[`${key}sOff`] = (ctx[`${key}sOff`] || 0) + 1;
    }
  } catch (e) { console.warn('trackRhythm error:', e); throw e; }
  // Normalize return to boolean for consistent-return rule
  return true;
}
