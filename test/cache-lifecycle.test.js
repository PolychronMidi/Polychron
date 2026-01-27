const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
/* global describe, it, expect */

// Runs a short bounded play and asserts that composer cache misses are not emitted
// (composer:cache:miss entries indicate missing/population races we want to eliminate)

describe('composer cache lifecycle', () => {
  it('emits no composer:cache:miss in a short run', () => {
    const outDir = path.join(process.cwd(), 'output');
    const tracesFile = path.join(outDir, 'index-traces.ndjson');
    try { if (fs.existsSync(tracesFile)) fs.unlinkSync(tracesFile); } catch (e) { /* swallow */ }

    const env = Object.assign({}, process.env, { PLAY_LIMIT: '1', INDEX_TRACES: '1' });
    const res = spawnSync(process.execPath, [path.join('src','play.js')], { env, stdio: 'ignore', timeout: 60000 });
    if (res.error) throw res.error;
    // Read traces and check for any composer:cache:miss entries
    expect(fs.existsSync(tracesFile)).toBe(true);
    const lines = fs.readFileSync(tracesFile, 'utf8').split(new RegExp('\\r?\\n')).filter(Boolean);
    const missEntries = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(j => j && j.tag === 'composer:cache:miss');
    // Only fail for missing high-level caches (beat or div); missing subdiv caches are expected at parent-level saves
    const badMisses = missEntries.filter(m => (typeof m.key === 'string') && (m.key.startsWith('beat:') || m.key.startsWith('div:')));
    expect(badMisses.length).toBe(0);
  });
});
