// Consolidated rhythm tracking function — explicit context-based API
trackRhythm = function trackRhythm(unit, ctx) {
  try {
    if (!ctx) throw new Error('trackRhythm requires a context object');
    const key = (unit || '').toString().toLowerCase();
    const unitNames = ['beat', 'div', 'subdiv', 'subsubdiv'];
    if (!unitNames.includes(key)) return; // noop for unknown units

    const rhythm = ctx[`${key}Rhythm`];
    const idx = ctx[`${key}Index`];
    const val = (rhythm && typeof idx !== 'undefined' && typeof rhythm[idx] !== 'undefined') ? rhythm[idx] : 0;

    if (val > 0) {
      ctx[`${key}sOn`] = (ctx[`${key}sOn`] || 0) + 1;
      ctx[`${key}sOff`] = 0;
    } else {
      ctx[`${key}sOn`] = 0;
      ctx[`${key}sOff`] = (ctx[`${key}sOff`] || 0) + 1;
    }
  } catch (e) { /* swallow to avoid impacting runtime */ }
}
