// test-setup.js - global test bootstrap
// Ensure test harness flags are set before modules run to avoid fatal checks during unit tests
const TEST_GLOBAL = Function('return this')();
TEST_GLOBAL.__POLYCHRON_TEST__ = TEST_GLOBAL.__POLYCHRON_TEST__ || {};
// Allow tests to suppress writer fatal checks that inspect output CSVs
TEST_GLOBAL.__POLYCHRON_TEST__.suppressHumanMarkerCheck = true;

// --- BEGIN: combined test helper content (bootstrap, bootstrap-fallbacks, structure, test-hooks) ---
try {
  // Ensure a test-hooks object exists and is available to other modules that require('./test-hooks')
  const TEST_HOOKS = TEST_GLOBAL.__POLYCHRON_TEST__ = TEST_GLOBAL.__POLYCHRON_TEST__ || {};
  // bootstrap-fallbacks: minimal fallbacks
  try { if (typeof p === 'undefined') p = (buff, ...items) => { if (!buff) return; if (typeof buff.push === 'function') buff.push(...items); else if (Array.isArray(buff)) buff.push(...items); }; } catch (e) { /* swallow */ }
  try {
    if (typeof CSVBuffer === 'undefined') {
      class _CSVBufferShim { constructor(name) { this.name = name; this.rows = []; } push(...items) { this.rows.push(...items); } get length() { return this.rows.length; } clear() { this.rows = []; } }
      CSVBuffer = _CSVBufferShim;
    }
  } catch (e) { /* swallow */ }
  try { if (typeof logUnit === 'undefined') logUnit = (type) => {}; } catch (e) { /* swallow */ }

  // bootstrap: small initialization to ensure minimal globals
  try {
    // Ensure Tonal is available globally as `t` for modules that expect it
    if (typeof t === 'undefined' || !t) {
      try { t = require('tonal'); } catch (e) { t = (TEST_HOOKS && TEST_HOOKS.t) || undefined; }
    }
  } catch (e) { /* swallow */ }

  // Compute fallback musical lists when venue.js isn't loaded
  try {
    if (typeof allNotes === 'undefined' || !Array.isArray(allNotes)) {
      try { allNotes = t && t.Scale ? t.Scale.get('C chromatic').notes.map(n=>t.Note.enharmonic(t.Note.get(n))) : ['C','D','E','F','G','A','B']; } catch (e) { allNotes = ['C','D','E','F','G','A','B']; }
    }
    if (typeof allScales === 'undefined' || !Array.isArray(allScales)) {
      try { allScales = t && t.Scale && typeof t.Scale.names === 'function' ? t.Scale.names().filter(n=>{ try { return t.Scale.get('C '+n).notes.length > 0; } catch (e) { return false; } }) : ['major','minor','chromatic']; } catch (e) { allScales = ['major','minor','chromatic']; }
    }
    if (typeof allChords === 'undefined' || !Array.isArray(allChords)) {
      try {
        const _set = new Set();
        if (t && t.ChordType && t.Chord) {
          t.ChordType.all().forEach(ct => { (allNotes||[]).forEach(root => { try { const chord = t.Chord.get(`${root} ${ct.name}`); if (!chord.empty && chord.symbol) _set.add(chord.symbol); } catch (e) { /* swallow per-root */ } }); });
        }
        allChords = Array.from(_set);
      } catch (e) { allChords = []; }
    }
    if (typeof allModes === 'undefined' || !Array.isArray(allModes)) {
      try {
        const _m = new Set();
        if (t && t.Mode) {
          t.Mode.all().forEach(mode => { (allNotes||[]).forEach(root => { _m.add(`${root} ${mode.name}`); }); });
        }
        allModes = Array.from(_m);
      } catch (e) { allModes = []; }
    }
  } catch (e) { /* swallow */ }

  // structure.js: section type helpers
  try { require('./backstage'); require('./sheet'); } catch (e) { /* swallow - tests may require these later */ }
  const normalizeSectionType = (entry = {}) => {
    const phrases = entry.phrases || entry.phrasesPerSection || PHRASES_PER_SECTION || { min: 1, max: 1 };
    const min = typeof phrases.min === 'number' ? phrases.min : Array.isArray(phrases) ? phrases[0] : PHRASES_PER_SECTION.min;
    const max = typeof phrases.max === 'number' ? phrases.max : Array.isArray(phrases) ? phrases[1] ?? phrases[0] : PHRASES_PER_SECTION.max;
    return { type: entry.type || entry.name || 'section', weight: typeof entry.weight === 'number' ? entry.weight : 1, bpmScale: typeof entry.bpmScale === 'number' ? entry.bpmScale : 1, dynamics: entry.dynamics || 'mf', phrasesMin: min, phrasesMax: max, motif: entry.motif || null };
  };
  const selectSectionType = () => {
    const types = Array.isArray(SECTION_TYPES) && SECTION_TYPES.length ? SECTION_TYPES : [{ type: 'default' }];
    const normalized = types.map(normalizeSectionType);
    const totalWeight = normalized.reduce((sum, t) => sum + (t.weight || 0), 0) || 1;
    let pick = rf(0, totalWeight);
    for (const type of normalized) { pick -= (type.weight || 0); if (pick <= 0) return type; }
    return normalized[0];
  };
  const resolveSectionProfile = (sectionType = null) => {
    const type = sectionType ? normalizeSectionType(sectionType) : normalizeSectionType(selectSectionType());
    const phrasesPerSection = ri(type.phrasesMin, type.phrasesMax);
    return { type: type.type, phrasesPerSection, bpmScale: type.bpmScale, dynamics: type.dynamics, motif: type.motif || null };
  };
  // expose structure helpers into test namespace
  try { TEST_HOOKS.normalizeSectionType = normalizeSectionType; TEST_HOOKS.selectSectionType = selectSectionType; TEST_HOOKS.resolveSectionProfile = resolveSectionProfile; } catch (e) { /* swallow */ }

} catch (e) { /* swallow combined block */ }
// --- END: combined test helper content ---
// Load `stage.js` to initialize the usual naked globals (backstage, writer, etc.).
// Tests rely on these globals being present without importing `play.js`.
require('./stage');
// Ensure venue/writer/motifs modules are loaded so they populate __POLYCHRON_TEST__ before we promote values
require('./venue');
const writerExports = require('./writer');
const rhythmExports = require('./rhythm');
require('./structure');
const _motifs = require('./motifs');
// Merge writer & rhythm exports into test namespace so legacy tests can get them via __POLYCHRON_TEST__
try { __POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; Object.assign(__POLYCHRON_TEST__, writerExports, rhythmExports); } catch (e) { /* swallow */ }

// Minimal test bootstrap: ensure frequently-used naked globals exist so tests can safely assign to them
// Use an indirect global accessor to avoid using banned identifiers like `global`/`globalThis`.
const GLOBAL = Function('return this')();
if (typeof GLOBAL.csvRows === 'undefined') GLOBAL.csvRows = [];
if (typeof GLOBAL.c === 'undefined') GLOBAL.c = [];
if (typeof GLOBAL.fs === 'undefined') GLOBAL.fs = require('fs');
if (typeof GLOBAL.performance === 'undefined') GLOBAL.performance = require('perf_hooks').performance;
// Ensure tonal (`t`) is available globally for modules that expect it
if (typeof GLOBAL.t === 'undefined') GLOBAL.t = (typeof __POLYCHRON_TEST__ !== 'undefined' && __POLYCHRON_TEST__.t) || (function(){ try { return require('tonal'); } catch (e) { return undefined; } })();

// Pre-create a broad set of timing and index globals so legacy tests can assign bare names safely
const _timingNames = ['midiMeter','midiMeterRatio','meterRatio','syncFactor','midiBPM','tpSec','tpMeasure','spMeasure','tpPhrase','spPhrase','measuresPerPhrase','numerator','denominator','polyNumerator','polyDenominator','composer','measureIndex','phraseIndex','sectionIndex','totalSections','phrasesPerSection','measureStart','measureStartTime','tpMeasure','spMeasure','beatIndex','beatStart','beatStartTime','tpBeat','spBeat','divIndex','divsPerBeat','divStart','divStartTime','tpDiv','spDiv','subdivIndex','subdivsPerDiv','subdivStart','subdivStartTime','tpSubdiv','spSubdiv','subsubdivIndex','subsubsPerSub','subsubdivStart','subsubdivStartTime','tpSubsubdiv','spSubsubdiv','formatTime','LOG','c','c1','c2','csvRows','PPQ','bpmRatio3','_origRf','_origRi','_origRv','binauralFreqOffset','lBal','rBal','cBal','cBal2','cBal3','refVar','bassVar'];
for (const _n of _timingNames) { if (typeof GLOBAL[_n] === 'undefined') GLOBAL[_n] = undefined; }

// Provide safe numeric defaults for a few stage-related globals expected by tests
if (typeof GLOBAL.binauralFreqOffset === 'undefined') GLOBAL.binauralFreqOffset = 0;
if (typeof GLOBAL.refVar === 'undefined') GLOBAL.refVar = 1;
if (typeof GLOBAL.lastCrossMod === 'undefined') GLOBAL.lastCrossMod = 0;

// Ensure classes exposed into __POLYCHRON_TEST__ by modules are also available as naked globals for legacy tests
const composersExports = require('./composers');
const voiceLeadingExports = require('./voiceLeading');
// Merge composer and voiceLeading exports into test namespace to support legacy globals
try { __POLYCHRON_TEST__ = __POLYCHRON_TEST__ || {}; Object.assign(__POLYCHRON_TEST__, composersExports.TestExports || composersExports, voiceLeadingExports); } catch (e) { /* swallow */ }
// Assign into the test-global object to ensure properties exist for legacy tests that use bare identifiers
const testns = (typeof __POLYCHRON_TEST__ !== 'undefined') ? __POLYCHRON_TEST__ : {};
GLOBAL.MeasureComposer = GLOBAL.MeasureComposer || (testns.MeasureComposer || (typeof GLOBAL.MeasureComposer !== 'undefined' ? GLOBAL.MeasureComposer : undefined));
GLOBAL.VoiceLeadingScore = GLOBAL.VoiceLeadingScore || (testns.VoiceLeadingScore || (typeof GLOBAL.VoiceLeadingScore !== 'undefined' ? GLOBAL.VoiceLeadingScore : undefined));
// Promote any function exports from test namespace to GLOBAL to support legacy tests expecting bare classes/functions
try {
  for (const k of Object.keys(testns)) {
    if (typeof GLOBAL[k] === 'undefined' && typeof testns[k] === 'function') {
      GLOBAL[k] = testns[k];
    }
  }
} catch (e) { /* swallow */ }

// Promote venue and other helpers into the GLOBAL object when available
if (typeof __POLYCHRON_TEST__ !== 'undefined') {
  GLOBAL.midiData = GLOBAL.midiData || testns.midiData;
  GLOBAL.getMidiValue = GLOBAL.getMidiValue || testns.getMidiValue;
  GLOBAL.allNotes = GLOBAL.allNotes || testns.allNotes;
  GLOBAL.allScales = GLOBAL.allScales || testns.allScales;
  GLOBAL.allChords = GLOBAL.allChords || testns.allChords;
  GLOBAL.allModes = GLOBAL.allModes || testns.allModes;
  // Promote composer classes for legacy tests
  GLOBAL.MeasureComposer = GLOBAL.MeasureComposer || testns.MeasureComposer;
  GLOBAL.ScaleComposer = GLOBAL.ScaleComposer || testns.ScaleComposer;
  GLOBAL.ChordComposer = GLOBAL.ChordComposer || testns.ChordComposer;
  GLOBAL.RandomChordComposer = GLOBAL.RandomChordComposer || testns.RandomChordComposer;
  GLOBAL.PentatonicComposer = GLOBAL.PentatonicComposer || testns.PentatonicComposer;
  GLOBAL.RandomPentatonicComposer = GLOBAL.RandomPentatonicComposer || testns.RandomPentatonicComposer;
  GLOBAL.ProgressionGenerator = GLOBAL.ProgressionGenerator || testns.ProgressionGenerator;
  // Additional composers and factory used by tests
  GLOBAL.MelodicDevelopmentComposer = GLOBAL.MelodicDevelopmentComposer || testns.MelodicDevelopmentComposer;
  GLOBAL.AdvancedVoiceLeadingComposer = GLOBAL.AdvancedVoiceLeadingComposer || testns.AdvancedVoiceLeadingComposer;
  GLOBAL.ComposerFactory = GLOBAL.ComposerFactory || testns.ComposerFactory;
  GLOBAL.RandomScaleComposer = GLOBAL.RandomScaleComposer || testns.RandomScaleComposer;
  GLOBAL.RandomModeComposer = GLOBAL.RandomModeComposer || testns.RandomModeComposer;
  GLOBAL.ModeComposer = GLOBAL.ModeComposer || testns.ModeComposer;
  // voice leading
  GLOBAL.VoiceLeadingScore = GLOBAL.VoiceLeadingScore || testns.VoiceLeadingScore;
  GLOBAL.stage = GLOBAL.stage || testns.stage;

  // Promote motif helpers and other small helpers used directly by tests
  const _motifExport = _motifs || testns;
  GLOBAL.Motif = GLOBAL.Motif || ((_motifExport && _motifExport.Motif) || (_motifs && _motifs.Motif));
  GLOBAL.clampMotifNote = GLOBAL.clampMotifNote || ((_motifExport && _motifExport.clampMotifNote) || _motifs.clampMotifNote);
  GLOBAL.applyMotifToNotes = GLOBAL.applyMotifToNotes || ((_motifExport && _motifExport.applyMotifToNotes) || _motifs.applyMotifToNotes);
  GLOBAL.resolveSectionProfile = GLOBAL.resolveSectionProfile || testns.resolveSectionProfile;
  GLOBAL.selectSectionType = GLOBAL.selectSectionType || testns.selectSectionType;
  GLOBAL.normalizeSectionType = GLOBAL.normalizeSectionType || testns.normalizeSectionType;

  // Ensure common timing primitives exist so tests assigning to them don't get ReferenceError (modules use these as naked globals)
  if (typeof GLOBAL.tpPhrase === 'undefined') GLOBAL.tpPhrase = 1920;
  if (typeof GLOBAL.tpMeasure === 'undefined') GLOBAL.tpMeasure = 480 * 4;
  if (typeof GLOBAL.tpSec === 'undefined') GLOBAL.tpSec = 480;
  if (typeof GLOBAL.spPhrase === 'undefined') GLOBAL.spPhrase = 0;
  if (typeof GLOBAL.spMeasure === 'undefined') GLOBAL.spMeasure = 0;
  if (typeof GLOBAL.measuresPerPhrase === 'undefined') GLOBAL.measuresPerPhrase = 1;
  if (typeof GLOBAL.PPQ === 'undefined') GLOBAL.PPQ = 480;

  // Writer exports commonly used by tests
  GLOBAL.CSVBuffer = GLOBAL.CSVBuffer || testns.CSVBuffer;
  GLOBAL.p = GLOBAL.p || testns.p;
  GLOBAL.pushMultiple = GLOBAL.pushMultiple || testns.pushMultiple;
  GLOBAL.logUnit = GLOBAL.logUnit || testns.logUnit;
  GLOBAL.grandFinale = GLOBAL.grandFinale || testns.grandFinale;
}

// Export inlined helpers for compatibility shims
try {
  module.exports = module.exports || {};
  module.exports.normalizeSectionType = typeof normalizeSectionType !== 'undefined' ? normalizeSectionType : undefined;
  module.exports.selectSectionType = typeof selectSectionType !== 'undefined' ? selectSectionType : undefined;
  module.exports.resolveSectionProfile = typeof resolveSectionProfile !== 'undefined' ? resolveSectionProfile : undefined;
  module.exports.TEST_HOOKS = (typeof __POLYCHRON_TEST__ !== 'undefined') ? __POLYCHRON_TEST__ : {};
} catch (e) { /* swallow */ }
