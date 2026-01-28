/*
 * Analyze duplicate-emission records in output/time-debug.ndjson and correlate with index-traces.ndjson
 * Prints the top duplicate start/end keys and a compact context dump (nearby time-debug and index-traces entries)
 */
const fs = require('fs');
const path = require('path');

const timeDebugPath = path.join(process.cwd(), 'output', 'time-debug.ndjson');
const indexTracesPath = path.join(process.cwd(), 'output', 'index-traces.ndjson');
if (!fs.existsSync(timeDebugPath)) {
  console.error('time-debug.ndjson not found'); process.exit(1);
}

const readline = require('readline');

const dupKeyCounts = Object.create(null);
const dupRecords = [];
let lineNum = 0;

const rl = readline.createInterface({ input: fs.createReadStream(timeDebugPath), crlfDelay: Infinity });
rl.on('line', (ln) => {
  lineNum++;
  if (!ln || ln.length < 10) return;
  try {
    const j = JSON.parse(ln);
    if (j && (j.tag === 'duplicate-emission' || j.tag === 'duplicate-emission-capture' || j.tag === 'strict-dup-capture')) {
      const key = `${j.unitType}|${j.start}|${j.end}|${(j.indices && (j.indices.sectionIndex !== undefined)) ? `${j.indices.sectionIndex}:${j.indices.phraseIndex}:${j.indices.measureIndex}` : 'none'}`;
      dupKeyCounts[key] = (dupKeyCounts[key] || 0) + 1;
      dupRecords.push({ idx: lineNum - 1, json: j, key });
    }
  } catch (e) { /* ignore parse errors */ }
});
rl.on('close', () => {
  const sortedKeys = Object.entries(dupKeyCounts).sort((a,b) => b[1]-a[1]);
  console.log('Found duplicate keys count:', sortedKeys.length);
  if (sortedKeys.length === 0) { console.log('No duplicate-emission records found in time-debug.ndjson'); process.exit(0); }
  const top = sortedKeys.slice(0,5);
  console.log('Top duplicate keys (count):');
  top.forEach(([k,c]) => console.log(`  ${c}  ${k}`));
  const topKey = top[0][0];
  const occurrences = dupRecords.filter(d => d.key === topKey);
  console.log('\nTop key occurrences:', occurrences.length);
  const first = occurrences[0];
  console.log(`\nFirst occurrence (line ${first.idx}):`, JSON.stringify(first.json));

  // Print a block around first occurrence by reading lines in a second pass
  const startLine = Math.max(0, first.idx - 20);
  const endLine = first.idx + 20;
  console.log('\nTime-debug context (approx lines):\n');
  let lnCtr = 0;
  const rl2 = require('readline').createInterface({ input: fs.createReadStream(timeDebugPath), crlfDelay: Infinity });
  rl2.on('line', (l) => {
    if (lnCtr >= startLine && lnCtr <= endLine) {
      const prefix = (lnCtr === first.idx) ? '>>' : '  ';
      console.log(`${String(lnCtr).padStart(6)} ${prefix} ${l}`);
    }
    lnCtr++;
    if (lnCtr > endLine) rl2.close();
  });
  rl2.on('close', () => {
    // try to correlate with index-traces via a small window
    if (!fs.existsSync(indexTracesPath)) { console.log('\nindex-traces.ndjson not found — skipping correlation'); process.exit(0); }
    console.log('\nIndex-traces nearby samples (first 40 lines):\n');
    const idxReader = require('readline').createInterface({ input: fs.createReadStream(indexTracesPath), crlfDelay: Infinity });
    let iCnt = 0;
    idxReader.on('line', (li) => {
      if (iCnt < 40) {
        console.log(`${String(iCnt).padStart(6)}   ${li}`);
      }
      iCnt++;
      if (iCnt === 40) idxReader.close();
    });
    idxReader.on('close', () => { console.log('\nDone.'); process.exit(0); });
  });
});
