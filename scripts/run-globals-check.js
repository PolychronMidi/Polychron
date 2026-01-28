const fs = require('fs'); const path = require('path'); const traces = path.join(process.cwd(), 'output', 'globals-check.ndjson'); try { if (fs.existsSync(traces)) fs.unlinkSync(traces); } catch (e) { /* swallow */ }
const { spawnSync } = require('child_process');
const playPath = path.join(process.cwd(), 'src', 'play.js');
const env = Object.assign({}, process.env, { CHECK_GLOBALS: '1', ENABLE_LOGS: '1', DEBUG_TRACES: '1', INDEX_TRACES: '1', PLAY_LIMIT: process.env.PLAY_LIMIT || '1' });
const res = spawnSync(process.execPath, [playPath], { env, stdio: 'inherit' });
if (res.error) { console.error('play process execution failed', res.error); process.exit(1); }
if (res.status !== 0) process.exit(res.status);
const lines = fs.existsSync(traces) ? fs.readFileSync(traces, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
console.log('globals-check-lines', lines.length);
process.exit(0);
