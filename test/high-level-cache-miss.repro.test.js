const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
/* global describe, it, expect */

// Gated reproducer test: run only when RUN_REPRO_TEST=1 to avoid failing CI
// This test asserts that there are NO beat/div composer:cache:miss entries.
// It is intentionally a failing test right now (repro present). Set RUN_REPRO_TEST=1 to run.

describe('reproducer: high-level composer cache misses', () => {
  it('should have zero beat/div composer:cache:miss entries (gated by RUN_REPRO_TEST)', () => {
    if (!process.env.RUN_REPRO_TEST) {
      console.log('Skipping high-level cache miss repro test; set RUN_REPRO_TEST=1 to run this gated test');
      return;
    }

    const outDir = path.join(process.cwd(), 'output');
    const tracesFile = path.join(outDir, 'index-traces.ndjson');
    const compactFile = path.join(outDir, 'cache-miss-compact.ndjson');

    // Remove old traces for deterministic run
    try { if (fs.existsSync(tracesFile)) fs.unlinkSync(tracesFile); } catch (e) { /* swallow */ }
    try { if (fs.existsSync(compactFile)) fs.unlinkSync(compactFile); } catch (e) { /* swallow */ }

    // Run a short bounded play to produce traces
    const env = Object.assign({}, process.env, { PLAY_LIMIT: '1', INDEX_TRACES: '1' });
    const res = spawnSync('node', ['src/play.js'], { env, stdio: 'inherit', shell: true, timeout: 20000 });
    if (res.error) throw res.error;

    // Run extractor to produce compact miss file
    const r2 = spawnSync('node', ['scripts/extract-cache-miss.js'], { env: process.env, stdio: 'pipe', shell: true, timeout: 10000 });
    if (r2.error) throw r2.error;

    expect(fs.existsSync(compactFile)).toBe(true);
    const lines = fs.readFileSync(compactFile, 'utf8').split(new RegExp('\\r?\\n')).filter(Boolean);

    // Expectation: zero high-level misses (this will fail until root cause fixed)
    expect(lines.length).toBe(0);
  });
});
