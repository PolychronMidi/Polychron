const fs = require('fs');
const readline = require('readline');

async function scan(filePath, drumCh = 9, out) {
  return new Promise((resolve, reject) => {
    const counts = new Map();
    let total = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    rl.on('line', (line) => {
      const cols = line.split(',').map(c => c.trim());
      if (cols[2] === 'note_on_c') {
        const ch = Number(cols[3]);
        const note = Number(cols[4]);
        const vel = Number(cols[5]);
        if (ch === drumCh) {
          total++;
          counts.set(note, (counts.get(note) || 0) + 1);
        }
      }
    });
    rl.on('close', () => resolve({ filePath, total, counts: Object.fromEntries(counts) }));
    rl.on('error', reject);
  });
}

(async () => {
  try {
    const out = 'output';
    const files = fs.readdirSync(out).filter(f => f.endsWith('.csv'));
    for (const f of files) {
      const res = await scan(`${out}/${f}`);
      console.log(`File: ${f} — drum hits: ${res.total}, unique notes: ${Object.keys(res.counts).length}`);
      const sorted = Object.entries(res.counts).sort((a,b)=>b[1]-a[1]).slice(0,20);
      console.log('Top notes:', sorted);
    }
  } catch (e) {
    console.error('Scan failed:', e && e.stack || e);
    process.exit(1);
  }
})();
