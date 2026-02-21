const fs = require('fs');
const path = require('path');

const globalsPath = path.join(__dirname, '../src/types/globals.d.ts');
const content = fs.readFileSync(globalsPath, 'utf8');

const lines = content.split('\n');
const declarations = [];

for (const line of lines) {
  const match = line.match(/^declare var (\w+):\s*(.+);/);
  if (match) {
    declarations.push({ name: match[1], type: match[2], original: line });
  }
}

const toRemove = new Set([
  'rd', 'rlc', 'clampSoft', 'clampStep', 'clampLog', 'clampExp', 'cCH4', 'cCH5', 'cCH6',
  'console', 'process', 'require', 'module', 'exports', '__dirname', '__filename'
]);

const uniqueDecls = new Map();
for (const decl of declarations) {
  if (toRemove.has(decl.name)) continue;
  if (decl.name === 'subsubdivStart' || decl.name === 'subsubdivStartTime') {
    decl.type = 'number';
  }

  // Type utility functions
  if (['clamp', 'modClamp', 'lowModClamp', 'highModClamp', 'scaleClamp', 'scaleBoundClamp', 'softClamp', 'stepClamp', 'logClamp', 'expClamp'].includes(decl.name)) {
    decl.type = 'Function';
  }
  if (['randomFloat', 'randomInt', 'randomWeightedInRange', 'randomWeightedInArray', 'randomWeightedSelection', 'randomInRangeOrArray', 'randomLimitedChange', 'randomVariation', 'normalizeWeights'].includes(decl.name)) {
    decl.type = 'Function';
  }
  if (decl.name === 'Validator') decl.type = 'any'; // Or maybe an object with methods? Let's just use 'any' for now or 'Object'

  // Type registries
  if (['CrossLayerRegistry', 'ConductorIntelligence', 'RhythmRegistry', 'ChordRegistry', 'MotifRegistry'].includes(decl.name)) {
    decl.type = 'any';
  }

  // Type managers
  if (['LM', 'layerManager', 'Stutter', 'noiseGenerators', 'RhythmManager', 'ChordManager', 'MotifManager', 'VoiceManager', 'FactoryManager', 'PhraseArcManager'].includes(decl.name)) {
    decl.type = 'any';
  }

  uniqueDecls.set(decl.name, decl);
}

if (!uniqueDecls.has('GlobalConductorUpdate')) {
  uniqueDecls.set('GlobalConductorUpdate', { name: 'GlobalConductorUpdate', type: 'any' });
}

// Now we need to group them by subsystem.
// Let's define the groups based on the load order:
// utils → conductor → rhythm → time → composers → fx → crossLayer → writer → play

const groups = {
  utils: [],
  conductor: [],
  rhythm: [],
  time: [],
  composers: [],
  fx: [],
  crossLayer: [],
  writer: [],
  play: [],
  other: []
};

// We need a heuristic to assign each global to a group.
// Let's read the index.js files of each subsystem to see what they export/require, or just use a simple regex on the codebase.
// Actually, we can just use `grep` or `find` to see where each global is defined.
// For now, I'll just write a script that searches the codebase for `NAME = ` to find where it's defined.

const { execSync } = require('child_process');

function findDefinition(name) {
  try {
    // Search for `NAME = ` or `NAME=` or `function NAME` or `class NAME`
    const res = execSync(`git grep -l -E "^(var|let|const)?\\s*${name}\\s*=|function ${name}\\b|class ${name}\\b" src/`, { encoding: 'utf8' });
    const files = res.trim().split('\n');
    if (files.length > 0) {
      const file = files[0];
      if (file.includes('src/utils/')) return 'utils';
      if (file.includes('src/conductor/')) return 'conductor';
      if (file.includes('src/rhythm/')) return 'rhythm';
      if (file.includes('src/time/')) return 'time';
      if (file.includes('src/composers/')) return 'composers';
      if (file.includes('src/fx/')) return 'fx';
      if (file.includes('src/crossLayer/')) return 'crossLayer';
      if (file.includes('src/writer/')) return 'writer';
      if (file.includes('src/play/')) return 'play';
    }
  } catch (e) {
    // Ignore
  }
  return 'other';
}

for (const [name, decl] of uniqueDecls.entries()) {
  const group = findDefinition(name);
  groups[group].push(decl);
}

let newContent = `// Managed globals single source of truth for both:
// 1) TypeScript ambient declarations (\`src/types/**/*.d.ts\` include)
// 2) ESLint global map (parsed directly by \`eslint.config.mjs\`)
//
// Keep one declaration per line in the form:
//   declare var NAME: any;
//
// This file is intentionally hand-edited and now contains the full set of
// runtime globals required by both ESLint and TypeScript checkJs.

`;

const order = ['utils', 'conductor', 'rhythm', 'time', 'composers', 'fx', 'crossLayer', 'writer', 'play', 'other'];

for (const groupName of order) {
  if (groups[groupName].length > 0) {
    newContent += `// ── ${groupName} ──\n`;
    for (const decl of groups[groupName]) {
      newContent += `declare var ${decl.name}: ${decl.type};\n`;
    }
    newContent += '\n';
  }
}

fs.writeFileSync(globalsPath, newContent);
console.log('Done');
