// test-setup.js - global test bootstrap
// Load `stage.js` to initialize the usual naked globals (backstage, writer, etc.).
// Tests rely on these globals being present without importing `play.js`.
require('./stage');
// Ensure venue/writer/motifs modules are loaded so they populate __POLYCHRON_TEST__ before we promote values
require('./venue');
require('./writer');
require('./structure');
const _motifs = require('./motifs');

// Minimal test bootstrap: ensure frequently-used naked globals exist so tests can safely assign to them
csvRows = csvRows || [];
c = c || [];
fs = fs || require('fs');
performance = performance || (require('perf_hooks').performance);
// Ensure classes exposed into __POLYCHRON_TEST__ by modules are also available as naked globals for legacy tests
require('./composers');
require('./voiceLeading');
MeasureComposer = MeasureComposer || (typeof __POLYCHRON_TEST__ !== 'undefined' && __POLYCHRON_TEST__.MeasureComposer);
VoiceLeadingScore = VoiceLeadingScore || (typeof __POLYCHRON_TEST__ !== 'undefined' && __POLYCHRON_TEST__.VoiceLeadingScore);
// Promote venue and other helpers into naked globals when available
if (typeof __POLYCHRON_TEST__ !== 'undefined') {
  midiData = midiData || __POLYCHRON_TEST__.midiData;
  getMidiValue = getMidiValue || __POLYCHRON_TEST__.getMidiValue;
  allNotes = allNotes || __POLYCHRON_TEST__.allNotes;
  allScales = allScales || __POLYCHRON_TEST__.allScales;
  allChords = allChords || __POLYCHRON_TEST__.allChords;
  allModes = allModes || __POLYCHRON_TEST__.allModes;
  // Promote composer classes for legacy tests
  MeasureComposer = MeasureComposer || __POLYCHRON_TEST__.MeasureComposer;
  ScaleComposer = ScaleComposer || __POLYCHRON_TEST__.ScaleComposer;
  ChordComposer = ChordComposer || __POLYCHRON_TEST__.ChordComposer;
  RandomChordComposer = RandomChordComposer || __POLYCHRON_TEST__.RandomChordComposer;
  PentatonicComposer = PentatonicComposer || __POLYCHRON_TEST__.PentatonicComposer;
  RandomPentatonicComposer = RandomPentatonicComposer || __POLYCHRON_TEST__.RandomPentatonicComposer;
  ProgressionGenerator = ProgressionGenerator || __POLYCHRON_TEST__.ProgressionGenerator;
  // voice leading
  VoiceLeadingScore = VoiceLeadingScore || __POLYCHRON_TEST__.VoiceLeadingScore;
  stage = stage || __POLYCHRON_TEST__.stage;

  // Promote motif helpers and other small helpers used directly by tests
  const _motifExport = _motifs || __POLYCHRON_TEST__;
  Motif = Motif || ((_motifExport && _motifExport.Motif) || (_motifs && _motifs.Motif));
  clampMotifNote = clampMotifNote || ((_motifExport && _motifExport.clampMotifNote) || _motifs.clampMotifNote);
  applyMotifToNotes = applyMotifToNotes || ((_motifExport && _motifExport.applyMotifToNotes) || _motifs.applyMotifToNotes);
  resolveSectionProfile = resolveSectionProfile || (typeof __POLYCHRON_TEST__ !== 'undefined' && __POLYCHRON_TEST__.resolveSectionProfile);
  selectSectionType = selectSectionType || (typeof __POLYCHRON_TEST__ !== 'undefined' && __POLYCHRON_TEST__.selectSectionType);
  normalizeSectionType = normalizeSectionType || (typeof __POLYCHRON_TEST__ !== 'undefined' && __POLYCHRON_TEST__.normalizeSectionType);

  // Ensure common timing primitives exist so tests assigning to them don't get ReferenceError (modules use these as naked globals)
  tpPhrase = tpPhrase ?? 1920;
  tpMeasure = tpMeasure ?? 480 * 4;
  tpSec = tpSec ?? 480;
  spPhrase = spPhrase ?? 0;
  spMeasure = spMeasure ?? 0;
  measuresPerPhrase = measuresPerPhrase ?? 1;
  PPQ = PPQ ?? 480;
}
