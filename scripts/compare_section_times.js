// Compare summed phrase durations in seconds per section between output1.csv and output2.csv
// Uses L2's Section markers as canonical boundaries and sums phrase Length (seconds) where present.
const fs = require('fs');
const path = require('path');

function parseTimeStr(t) {
  // Expect formats like "0:01.4286" or "1:35.0556" => mm:ss.fraction
  if (typeof t !== 'string') { console.warn('parseTimeStr: expected string, got', typeof t); return null; }
  const m = t.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) { console.warn('parseTimeStr: time string did not match expected format:', t); return null; }
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) { console.warn('parseTimeStr: parsed time parts are not finite:', t); return null; }
  return minutes * 60 + seconds;
}

function parseFileTimes(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const sections = []; // { index, startTick, phrases: [{ startTick, endTick, lengthSec }] }
  let currentSection = { index: 1, startTick: null, phrases: [] };
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const type = parts[2].trim();
    if (type !== 'marker_t') continue;
    const tick = Number(parts[1]);
    const text = parts.slice(3).join(',');

    const sectionMatch = text.match(/Section\s+(\d+)\/\d+/i);
    if (sectionMatch) {
      if (currentSection.phrases.length || currentSection.startTick !== null) sections.push(currentSection);
      currentSection = { index: Number(sectionMatch[1]), startTick: tick, phrases: [] };
      continue;
    }

    const phraseMatch = text.match(/Phrase\s+(\d+)\/(\d+)/i);
    if (phraseMatch) {
      // Try to extract 'Length: <time>' first
      let lengthSec = null;
      const lengthMatch = text.match(/Length:\s*([0-9]+:[0-9]+(?:\.[0-9]+)?)/i);
      if (lengthMatch) {
        lengthSec = parseTimeStr(lengthMatch[1]);
      } else {
        // Try to extract start/end and compute
        const parenMatch = text.match(/\(([^)]+)\)/);
        if (parenMatch) {
          const seg = parenMatch[1].split('-').map(s => s.trim());
          if (seg.length === 2) {
            const st = parseTimeStr(seg[0]);
            const en = parseTimeStr(seg[1]);
            if (st !== null && en !== null) lengthSec = en - st;
          }
        }
      }

      const endTickMatch = text.match(/endTick:\s*(\d+|null)/i);
      const endTick = endTickMatch && endTickMatch[1] && endTickMatch[1] !== 'null' ? Number(endTickMatch[1]) : null;
      currentSection.phrases.push({ startTick: Number.isFinite(tick) ? tick : null, endTick, lengthSec });
    }
  }
  if (currentSection.phrases.length || currentSection.startTick !== null) sections.push(currentSection);
  return sections;
}

function compareTimes(primaryPath, polyPath) {
  const L1 = parseFileTimes(primaryPath);
  const L2 = parseFileTimes(polyPath);
  // DEBUG: inspect L2 sections (hidden by default)
  // console.error('L2 sections:', L2.map((s, i) => ({ ordinal: i+1, index: s.index, startTick: s.startTick, phrases: s.phrases.length })));


  // Use the explicit section label found in markers (e.g., 'Section 2/7') as the canonical section index.
  const bounds = L2.map((s, i) => {
    const labelIndex = (s && typeof s.index === 'number') ? s.index : (i + 1);
    const start = s.startTick === null ? (s.phrases[0] && s.phrases[0].startTick || 0) : s.startTick;
    const end = (i < L2.length - 1) ? (L2[i+1].startTick === null ? Infinity : L2[i+1].startTick) : Infinity;
    return { index: labelIndex, start, end, section: s, ordinal: i+1 };
  });

  // Exclude degenerate zero-length sections (start === end) which are placeholders
  const filteredBounds = bounds.filter(b => b.start !== b.end);

  const rows = filteredBounds.map(b => {
    function sumLength(sectionsArray) {
      let totalSec = 0; let countWith = 0; let totalPhrases = 0;
      for (const sec of sectionsArray) {
        for (const p of sec.phrases) {
          totalPhrases++;
          // include only phrase entries that have lengthSec
          if (p.lengthSec !== null && Number.isFinite(p.lengthSec)) {
            // ensure phrase is within bounds by startTick if available
            if (p.startTick === null || (p.startTick >= b.start && p.startTick < b.end)) {
              totalSec += p.lengthSec;
              countWith++;
            }
          }
        }
      }
      return { totalSec, countWith, totalPhrases };
    }

    const pSum = sumLength(L1);
    const qSum = sumLength([b.section]);
    const diffSec = pSum.totalSec - qSum.totalSec;
    const pct = qSum.totalSec === 0 ? null : (diffSec / qSum.totalSec) * 100;
    return { section: b.index, L1: pSum, L2: qSum, diffSec, pct };
  });

  return rows;
}

const out = compareTimes(path.join(__dirname,'..','output','output1.csv'), path.join(__dirname,'..','output','output2.csv'));

// Diagnostics: count phrases with lengths overall
const totalPrimaryWith = out.reduce((acc, r) => acc + (r.L1.countWith || 0), 0);
const totalPolyWith = out.reduce((acc, r) => acc + (r.L2.countWith || 0), 0);
console.log(`Found ${totalPrimaryWith} L1 phrase lengths and ${totalPolyWith} L2 phrase lengths across ${out.length} sections`);

console.log('Section | primarySec | polySec | diffSec | %diff | primaryPhrases | polyPhrases | primCountWith | polyCountWith');
out.forEach(r => {
  console.log(`${r.section.toString().padStart(7)} | ${r.L1.totalSec.toFixed(4).toString().padStart(10)} | ${r.L2.totalSec.toFixed(4).toString().padStart(8)} | ${r.diffSec.toFixed(4).toString().padStart(8)} | ${r.pct === null ? '   N/A' : r.pct.toFixed(2).padStart(6) + '%'} | ${r.L1.totalPhrases.toString().padStart(14)} | ${r.L2.totalPhrases.toString().padStart(11)} | ${r.L1.countWith.toString().padStart(13)} | ${r.L2.countWith.toString().padStart(12)}`);
});

console.log('\nSections with non-zero diffs:');
out.filter(r => Math.abs(r.diffSec) > 1e-6).forEach(r => {
  console.log(`Section ${r.section}: L1=${r.L1.totalSec.toFixed(4)}s, L2=${r.L2.totalSec.toFixed(4)}s, diff=${r.diffSec.toFixed(4)}s (%=${r.pct === null ? 'N/A' : r.pct.toFixed(2) + '%'})`);
});
