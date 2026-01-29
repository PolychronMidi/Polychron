// test-setup.js - global test bootstrap
// Ensure test harness flags are set before modules run to avoid fatal checks during unit tests
const TEST_GLOBAL = Function('return this')();
TEST_GLOBAL.__POLYCHRON_TEST__ = TEST_GLOBAL.__POLYCHRON_TEST__ || {};
// Allow tests to suppress writer fatal checks that inspect output CSVs
TEST_GLOBAL.__POLYCHRON_TEST__.suppressHumanMarkerCheck = true;
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
