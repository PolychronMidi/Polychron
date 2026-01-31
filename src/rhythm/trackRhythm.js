// Consolidated rhythm tracking function — explicit context-based API
function trackRhythm(unit, ctx) {
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

function buildGlobalContext() {
  // Return an object with getters/setters that map to module globals used across timing
  return {
    get beatRhythm() { return beatRhythm; }, set beatRhythm(v) { beatRhythm = v; },
    get beatIndex() { return beatIndex; }, set beatIndex(v) { beatIndex = v; },
    get beatsOn() { return beatsOn; }, set beatsOn(v) { beatsOn = v; },
    get beatsOff() { return beatsOff; }, set beatsOff(v) { beatsOff = v; },

    get divRhythm() { return divRhythm; }, set divRhythm(v) { divRhythm = v; },
    get divIndex() { return divIndex; }, set divIndex(v) { divIndex = v; },
    get divsOn() { return divsOn; }, set divsOn(v) { divsOn = v; },
    get divsOff() { return divsOff; }, set divsOff(v) { divsOff = v; },

    get subdivRhythm() { return subdivRhythm; }, set subdivRhythm(v) { subdivRhythm = v; },
    get subdivIndex() { return subdivIndex; }, set subdivIndex(v) { subdivIndex = v; },
    get subdivsOn() { return subdivsOn; }, set subdivsOn(v) { subdivsOn = v; },
    get subdivsOff() { return subdivsOff; }, set subdivsOff(v) { subdivsOff = v; },

    get subsubdivRhythm() { return subsubdivRhythm; }, set subsubdivRhythm(v) { subsubdivRhythm = v; },
    get subsubdivIndex() { return subsubdivIndex; }, set subsubdivIndex(v) { subsubdivIndex = v; },
    get subsubdivsOn() { return subsubdivsOn; }, set subsubdivsOn(v) { subsubdivsOn = v; },
    get subsubdivsOff() { return subsubdivsOff; }, set subsubdivsOff(v) { subsubdivsOff = v; },
  };
}

try { module.exports = { trackRhythm, buildGlobalContext }; } catch (e) { /* swallow */ }
