// Simple script to compare summed phrase durations (endTick - startTick) per section
// across two output CSVs: output1.csv (L1) and output2.csv (L2).

const fs = require('fs');
const path = require('path');

function parseFile(filePath, layerName) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const sections = []; // { index: n, startTick, phrases: [ { startTick, endTick } ] }
  let currentSection = { index: 1, startTick: null, phrases: [] };
  for (const line of lines) {
    if (!line) continue;
    // CSV: track,tick,type,...
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const type = (parts[2] || '').trim();
    if (type !== 'marker_t') continue;
    const tick = Number(parts[1]);
    const text = parts.slice(3).join(',');

    const sectionMatch = text.match(/Section\s+(\d+)\/\d+/i);
    if (sectionMatch) {
      // start a new section bucket (close previous)
      if (currentSection.phrases.length || currentSection.startTick !== null) sections.push(currentSection);
      currentSection = { index: Number(sectionMatch[1]), startTick: tick, phrases: [] };
      continue;
    }

    const phraseMatch = text.match(/Phrase\s+(\d+)\/(\d+)/i);
    if (phraseMatch) {
      // extract endTick
      const endTickMatch = text.match(/endTick:\s*(\d+|null)/i);
      const endTick = endTickMatch && endTickMatch[1] && endTickMatch[1] !== 'null' ? Number(endTickMatch[1]) : null;
      currentSection.phrases.push({ startTick: Number.isFinite(tick) ? tick : null, endTick });
    }
  }
  if (currentSection.phrases.length || currentSection.startTick !== null) sections.push(currentSection);
  return sections;
}

function sumSection(section) {
  // Sum phrase durations using endTick - startTick where both are numeric.
  let total = 0;
  let count = 0;
  for (const p of section.phrases) {
    if (Number.isFinite(p.startTick) && Number.isFinite(p.endTick)) {
      total += (p.endTick - p.startTick);
      count++;
    }
  }
  return { totalTicks: total, phraseCount: section.phrases.length, pairsCount: count };
}

function compareUsingPolyBounds(primaryPath, polyPath) {
  const L1 = parseFile(primaryPath, 'L1');
  const L2 = parseFile(polyPath, 'L2');

  // Build L2 section boundaries (startTick inclusive, endTick exclusive)
  const bounds = L2.map((s, i) => {
    const start = s.startTick === null ? (s.phrases[0] && s.phrases[0].startTick || 0) : s.startTick;
    const end = (i < L2.length - 1) ? (L2[i+1].startTick === null ? Infinity : L2[i+1].startTick) : Infinity;
    return { index: i+1, start, end, section: s };
  });

  const rows = bounds.map(b => {
    function sumInBound(sectionsArray) {
      // sectionsArray is an array of {phrases: [{startTick,endTick}]}
      let total = 0; let count = 0; let phrases = 0;
      for (const sec of sectionsArray) {
        for (const p of sec.phrases) {
          phrases++;
          if (!Number.isFinite(p.startTick) || !Number.isFinite(p.endTick)) continue;
          if (p.startTick >= b.start && p.startTick < b.end) {
            total += (p.endTick - p.startTick);
            count++;
          }
        }
      }
      return { total, count, phrases };
    }

    const pSum = sumInBound(L1);
    const qSum = sumInBound([b.section]);
    const diff = pSum.total - qSum.total;
    const pct = qSum.total === 0 ? null : (diff / qSum.total) * 100;
    return { section: b.index, L1: pSum, L2: qSum, diff, pct };
  });

  return rows;
}

// Backwards compatible export
const compare = compareUsingPolyBounds;

function human(ms) {
  // ticks -> approximate seconds if PPQ/BPM unknown; we'll just present ticks
  return `${ms} ticks`;
}

const out = compare(path.join(__dirname,'..','output','output1.csv'), path.join(__dirname,'..','output','output2.csv'));
console.log('Section | primaryTicks | polyTicks | diffTicks | %diff | primaryPhrases | polyPhrases');
out.forEach(r => {
  const pTicks = r.L1.total || 0;
  const qTicks = r.L2.total || 0;
  const pPhrases = r.L1.phrases || 0;
  const qPhrases = r.L2.phrases || 0;
  console.log(`${r.section.toString().padStart(7)} | ${pTicks.toString().padStart(12)} | ${qTicks.toString().padStart(9)} | ${r.diff.toString().padStart(9)} | ${r.pct === null ? '   N/A' : r.pct.toFixed(2).padStart(6) + '%'} | ${pPhrases.toString().padStart(14)} | ${qPhrases.toString().padStart(11)}`);
});

// Also print sections with mismatches
console.log('\nSections with non-zero differences:');
out.filter(r => r.diff !== 0).forEach(r => {
  const pTicks = r.L1.total || 0;
  const qTicks = r.L2.total || 0;
  console.log(`Section ${r.section}: L1=${pTicks} ticks, L2=${qTicks} ticks, diff=${r.diff} ticks`);
});
