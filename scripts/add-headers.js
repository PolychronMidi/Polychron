const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

const conductorDir = path.join(__dirname, '../src/conductor');

walkDir(conductorDir, (filePath) => {
  if (!filePath.endsWith('.js')) return;
  if (filePath.includes('index.js') || filePath.includes('config.js') || filePath.includes('Helpers.js')) return;

  let content = fs.readFileSync(filePath, 'utf8');

  // Extract what it reads
  const reads = new Set();
  const readRegexes = [
    /AbsoluteTimeWindow\.getNotes/g,
    /ConductorState\.getField\('([^']+)'\)/g,
    /HarmonicContext\.getField\('([^']+)'\)/g,
    /HarmonicRhythmTracker\.getHarmonicRhythm/g,
    /beatGridHelpers\.getBeatDuration/g,
    /LayerManager\.get/g,
    /LM\.get/g,
    /ComposerFactory\.getActiveFamily/g,
    /HarmonicJourney\.get/g
  ];

  for (const regex of readRegexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) {
        reads.add(match[0].split('(')[0] + `('${match[1]}')`);
      } else {
        reads.add(match[0]);
      }
    }
  }

  // Extract what it registers
  const registers = new Set();
  const registerRegexes = [
    /ConductorIntelligence\.register[A-Za-z]+\('([^']+)'/g,
    /CrossLayerRegistry\.register\('([^']+)'/g
  ];

  for (const regex of registerRegexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      registers.add(match[0].split('(')[0] + `('${match[1]}')`);
    }
  }

  // Extract the first line comment as "What it is"
  const lines = content.split('\n');
  let whatItIs = '';
  let headerEndIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('//')) {
      if (i === 0) {
        whatItIs = lines[i].replace('// ', '').split(' - ')[1] || lines[i].replace('// ', '');
      } else {
        whatItIs += ' ' + lines[i].replace('// ', '');
      }
      headerEndIdx = i;
    } else if (lines[i].trim() === '') {
      headerEndIdx = i;
    } else {
      break;
    }
  }

  if (!whatItIs) return; // Skip if no header found

  // Clean up whatItIs
  whatItIs = whatItIs.replace(/\s+/g, ' ').trim();
  if (whatItIs.length > 150) {
    whatItIs = whatItIs.substring(0, 147) + '...';
  }

  const readsStr = reads.size > 0 ? Array.from(reads).join(', ') : 'Nothing external';
  const registersStr = registers.size > 0 ? Array.from(registers).join(', ') : 'Pure query API (no registration)';

  const newHeader = `// What it is: ${whatItIs}
// What it reads: ${readsStr}
// What it registers: ${registersStr}
`;

  // Replace the old header with the new one
  const newContent = newHeader + '\n' + lines.slice(headerEndIdx + 1).join('\n');
  fs.writeFileSync(filePath, newContent);
});

console.log('Headers added to conductor modules.');
