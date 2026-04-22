// R32: correlation math extracted from compute-musical-correlation.js.
//
// Pure computation — no I/O. Pearson correlation with degenerate-case
// detection, plus the perceptual-signal extraction from perceptual-report.
// Keeping these here means compute-musical-correlation.js stays an
// orchestrator (load JSON → compute snapshot → emit), not a math library.

'use strict';

function extractPerceptualSignals(p) {
  // Returns { complexity_avg, clap_tension, encodec_entropy_avg } -- all 0..1ish
  if (!p || typeof p !== 'object') return null;
  const out = { complexity_avg: null, clap_tension: null, encodec_entropy_avg: null };

  const sections = p.encodec && p.encodec.sections;
  if (sections && typeof sections === 'object') {
    const tensions = [];
    const entropies = [];
    for (const secKey of Object.keys(sections)) {
      const sec = sections[secKey];
      if (sec && typeof sec.tension === 'number') tensions.push(sec.tension);
      if (sec && sec.entropies && typeof sec.entropies === 'object') {
        for (const v of Object.values(sec.entropies)) {
          if (typeof v === 'number') entropies.push(v);
        }
      }
    }
    if (tensions.length > 0) {
      out.complexity_avg = tensions.reduce((a, b) => a + b, 0) / tensions.length;
    }
    if (entropies.length > 0) {
      out.encodec_entropy_avg = entropies.reduce((a, b) => a + b, 0) / entropies.length;
    }
  }

  const clap = p.clap && p.clap.queries;
  if (clap && typeof clap === 'object') {
    const preferredKey = Object.keys(clap).find((k) => /tension/i.test(k));
    if (preferredKey && typeof clap[preferredKey].peak === 'number') {
      out.clap_tension = clap[preferredKey].peak;
    } else {
      const peaks = Object.values(clap)
        .map((q) => (q && typeof q.peak === 'number' ? q.peak : null))
        .filter((x) => x !== null);
      if (peaks.length > 0) {
        out.clap_tension = peaks.reduce((a, b) => a + b, 0) / peaks.length;
      }
    }
  }
  return out;
}

function pearson(xs, ys) {
  // Returns { r, degenerate } or { r: null } when undefined.
  //
  // Degenerate cases (r clamps to +/-1 as artifact, not signal):
  //   - fewer than 3 points
  //   - zero variance in either axis
  //   - fewer than 3 distinct values in either axis (k-1 points coincide,
  //     the k-th is an outlier -> any line fits perfectly, r=+/-1)
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return { r: null, degenerate: true, reason: 'n<3' };
  const distinctX = new Set(xs).size;
  const distinctY = new Set(ys).size;
  if (distinctX < 3 || distinctY < 3) {
    return { r: null, degenerate: true, reason: `distinct_x=${distinctX} distinct_y=${distinctY}` };
  }
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return { r: null, degenerate: true, reason: 'zero_variance' };
  return { r: num / Math.sqrt(dx2 * dy2), degenerate: false };
}

module.exports = { extractPerceptualSignals, pearson };
