// Diagnostic script to trace voice selection behavior
// Run: node scripts/diagnose-voice-selection.js

require('../src/main.js');

// Monkey-patch VoiceCoordinator to log selection behavior
const originalPickNotes = VoiceCoordinator.prototype.pickNotesForBeat;
let callCount = 0;
const stats = {
  totalCalls: 0,
  candidatePoolSizes: [],
  selectedVoiceCounts: [],
  registerBiasApplied: 0,
  densityMultipliers: []
};

VoiceCoordinator.prototype.pickNotesForBeat = function(layer, candidateNotes, voiceCount, scorer, opts = {}) {
  callCount++;
  const normalized = this._normalizeCandidates(candidateNotes);

  if (callCount <= 50) { // Log first 50 calls
    const phraseContext = opts.phraseContext || {};
    console.log(`\n[Call ${callCount}] VoiceCoordinator.pickNotesForBeat:`);
    console.log(`  Input: ${candidateNotes.length} candidates, voiceCount=${voiceCount}`);
    console.log(`  Normalized pool: ${normalized.notes.length} notes`);
    console.log(`  Phrase context:`, {
      densityMult: phraseContext.densityMultiplier?.toFixed(2),
      registerBias: phraseContext.registerBias,
      voiceIndep: phraseContext.voiceIndependence?.toFixed(2)
    });
    console.log(`  voiceCountMultiplier: ${opts.voiceCountMultiplier?.toFixed(2) || 1.0}`);
  }

  stats.totalCalls++;
  stats.candidatePoolSizes.push(normalized.notes.length);
  stats.densityMultipliers.push((opts.phraseContext?.densityMultiplier || 1.0));

  const result = originalPickNotes.call(this, layer, candidateNotes, voiceCount, scorer, opts);

  stats.selectedVoiceCounts.push(result.length);
  if (opts.registerBias || opts.phraseContext?.registerBias) {
    stats.registerBiasApplied++;
  }

  if (callCount <= 50) {
    console.log(`  Selected: ${result.length} voices`);
  }

  return result;
};

// Run for a short time
setTimeout(() => {
  const avg = (arr) => arr.length ? (arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(2) : 0;
  console.log('\n\n=== VOICE SELECTION STATISTICS ===');
  console.log(`Total calls: ${stats.totalCalls}`);
  console.log(`Avg candidate pool size: ${avg(stats.candidatePoolSizes)}`);
  console.log(`Avg selected voices: ${avg(stats.selectedVoiceCounts)}`);
  console.log(`Avg density multiplier: ${avg(stats.densityMultipliers)}`);
  console.log(`Register bias applied: ${stats.registerBiasApplied} times (${(stats.registerBiasApplied/stats.totalCalls*100).toFixed(1)}%)`);
  process.exit(0);
}, 5000);
