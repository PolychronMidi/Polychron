'use strict';

// Migration script: replace bare L0 channel string literals with L0_CHANNELS.xxx constants.
// Run: node scripts/migrations/migrate-l0-channels.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SRC  = path.join(ROOT, 'src');

// Reverse mapping: channel-name-string -> L0_CHANNELS key
// Built from src/time/l0Channels.js
const CHANNEL_MAP = {
  'articulation':         'L0_CHANNELS.articulation',
  'binaural':             'L0_CHANNELS.binaural',
  'cadenceAlignment':     'L0_CHANNELS.cadenceAlignment',
  'channel-coherence':    'L0_CHANNELS.channelCoherence',
  'chord':                'L0_CHANNELS.chord',
  'climax-pressure':      'L0_CHANNELS.climaxPressure',
  'coherence':            'L0_CHANNELS.coherence',
  'convergence-density':  'L0_CHANNELS.convergenceDensity',
  'density':              'L0_CHANNELS.density',
  'density-rhythm':       'L0_CHANNELS.densityRhythm',
  'emergentDownbeat':     'L0_CHANNELS.emergentDownbeat',
  'emergentMelody':       'L0_CHANNELS.emergentMelody',
  'emergentRhythm':       'L0_CHANNELS.emergentRhythm',
  'emissionDelta':        'L0_CHANNELS.emissionDelta',
  'entropy':              'L0_CHANNELS.entropy',
  'feedbackLoop':         'L0_CHANNELS.feedbackLoop',
  'feedbackPitch':        'L0_CHANNELS.feedbackPitch',
  'grooveTransfer':       'L0_CHANNELS.grooveTransfer',
  'harmonic':             'L0_CHANNELS.harmonic',
  'harmonicFunction':     'L0_CHANNELS.harmonicFunction',
  'harmonic-journey-eval':'L0_CHANNELS.harmonicJourneyEval',
  'instrument':           'L0_CHANNELS.instrument',
  'motifEcho':            'L0_CHANNELS.motifEcho',
  'motifIdentity':        'L0_CHANNELS.motifIdentity',
  'note':                 'L0_CHANNELS.note',
  'onset':                'L0_CHANNELS.onset',
  'perceptual-crowding':  'L0_CHANNELS.perceptualCrowding',
  'phaseConvergence':     'L0_CHANNELS.phaseConvergence',
  'registerCollision':    'L0_CHANNELS.registerCollision',
  'regimeTransition':     'L0_CHANNELS.regimeTransition',
  'rest-sync':            'L0_CHANNELS.restSync',
  'rhythm':               'L0_CHANNELS.rhythm',
  'section-quality':      'L0_CHANNELS.sectionQuality',
  'self-narration':       'L0_CHANNELS.selfNarration',
  'spectral':             'L0_CHANNELS.spectral',
  'stutterContagion':     'L0_CHANNELS.stutterContagion',
  'tension':              'L0_CHANNELS.tension',
  'tickDuration':         'L0_CHANNELS.tickDuration',
  'underusedPitchClasses':'L0_CHANNELS.underusedPitchClasses',
  'velocity':             'L0_CHANNELS.velocity',
  'verticalCollision':    'L0_CHANNELS.verticalCollision',
};

const L0_METHODS = ['post', 'getLast', 'query', 'count', 'getBounds', 'findClosest', 'reset'];

function findJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findJsFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

// Replace bare string literals in L0 method calls.
// Handles: L0.method('channel', ...  -> L0.method(L0_CHANNELS.key, ...
// Also handles double-quoted strings.
function migrateFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  const original = src;

  for (const method of L0_METHODS) {
    for (const [channelStr, constant] of Object.entries(CHANNEL_MAP)) {
      // Single-quoted
      const patSingle = new RegExp(
        `(L0\\.${method}\\()\\s*'${channelStr.replace(/-/g, '\\-')}'`,
        'g'
      );
      src = src.replace(patSingle, `$1${constant}`);

      // Double-quoted
      const patDouble = new RegExp(
        `(L0\\.${method}\\()\\s*"${channelStr.replace(/-/g, '\\-')}"`,
        'g'
      );
      src = src.replace(patDouble, `$1${constant}`);
    }
  }

  if (src !== original) {
    fs.writeFileSync(filePath, src, 'utf8');
    return true;
  }
  return false;
}

const files = findJsFiles(SRC);
let changed = 0;
const changedFiles = [];

for (const f of files) {
  if (f.includes('l0Channels.js')) continue; // skip the constants file itself
  if (migrateFile(f)) {
    changed++;
    changedFiles.push(path.relative(ROOT, f));
  }
}

console.log(`migrate-l0-channels: ${changed} files updated`);
for (const f of changedFiles) {
  console.log('  ' + f);
}

// Verify no bare strings remain
let remaining = 0;
const methodPattern = L0_METHODS.join('|');
const checkPattern = new RegExp(`L0\\.(?:${methodPattern})\\(\\s*['"]`, 'g');

for (const f of files) {
  if (f.includes('l0Channels.js')) continue;
  const src = fs.readFileSync(f, 'utf8');
  const matches = [...src.matchAll(checkPattern)];
  if (matches.length > 0) {
    remaining += matches.length;
    console.warn(`  REMAINING in ${path.relative(ROOT, f)}: ${matches.length} bare literal(s)`);
  }
}

if (remaining > 0) {
  console.error(`\nmigrate-l0-channels: ${remaining} bare literals remain -- add missing channels to CHANNEL_MAP`);
  process.exit(1);
} else {
  console.log('migrate-l0-channels: CLEAN -- no bare string literals remain');
}
