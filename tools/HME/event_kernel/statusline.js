#!/usr/bin/env node
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.on('data', (c) => { s += c.toString('utf8'); });
    process.stdin.on('end', () => resolve(s));
  });
}

function projectRoot() {
  return _hmeRequireEnv('PROJECT_ROOT');
}

function autocompactLifesaver(root, raw) {
  // Fail-fast: Claude Code's "% until autocompact" widget is computed from
  // `anthropic-ratelimit-input-tokens-{limit,remaining}` headers. Upstream
  try {
    const ctx = (raw && raw.context_window) || {};
    const truthTotal = Number(ctx.total_input_tokens || 0);
    const truthSize = Number(ctx.context_window_size || 0);
    if (!truthTotal || !truthSize) return '';
    const sink = path.join(root, 'tools', 'HME', 'runtime', 'proxy-context-norm.json');
    let normStat;
    try { normStat = fs.statSync(sink); } catch (_e) { /* missing */ }
    if (!normStat) {
      _writeLifesaver(root, 'proxy-context-norm.json missing -- proxy not injecting normalized rate-limit headers; autocompact widget LYING');
      return ' | LIFESAVER!ctx-norm:missing';
    }
    const ageMs = Date.now() - normStat.mtimeMs;
    if (ageMs > 10 * 60 * 1000) {
      _writeLifesaver(root, `proxy-context-norm.json stale ${Math.round(ageMs / 1000)}s -- proxy may be down or pre-fix; autocompact widget LYING`);
      return ` | LIFESAVER!ctx-norm:stale ${Math.round(ageMs / 60000)}m`;
    }
    let norm;
    try { norm = JSON.parse(fs.readFileSync(sink, 'utf8')); } catch (_e) { /* bad JSON */ }
    if (!norm || !Number.isFinite(norm.used) || !Number.isFinite(norm.size)) {
      _writeLifesaver(root, 'proxy-context-norm.json unreadable -- cannot verify autocompact widget; assume LYING');
      return ' | LIFESAVER!ctx-norm:bad-json';
    }
    if (norm.size !== truthSize) {
      _writeLifesaver(root, `proxy normalized size=${norm.size} != truth size=${truthSize}; autocompact widget LYING`);
      return ` | LIFESAVER!ctx-norm:size ${norm.size}/${truthSize}`;
    }
    // Used drift tolerated up to 2k tokens or 2% (whichever larger) since
    // statusline raw and proxy capture happen at different request boundaries.
    const tol = Math.max(2000, Math.floor(truthSize * 0.02));
    const drift = Math.abs(norm.used - truthTotal);
    if (drift > tol) {
      _writeLifesaver(root, `proxy normalized used=${norm.used} != truth used=${truthTotal} (drift ${drift}>tol ${tol}); autocompact widget LYING`);
      return ` | LIFESAVER!ctx-norm:drift ${drift}`;
    }
    return '';
  } catch (_e) {
    return '';
  }
}

function _writeLifesaver(root, msg) {
  try {
    const logDir = path.join(root, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString();
    fs.appendFileSync(path.join(logDir, 'hme-lifesaver.log'), `[${ts}] [statusline-autocompact] ${msg}\n`);
  } catch (_e) { /* best effort */ }
}

function latestClassifier(root) {
  const file = path.join(root, 'src', 'output', 'metrics', 'mode-classifier.jsonl');
  try {
    const text = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
    if (!text) return '';
    const rec = JSON.parse(text);
    return ` | ${rec.mode || '?'}` + (rec.tier ? ` ${rec.tier}` : '');
  } catch (_e) {
    // silent-ok: optional fallback path.
    return '';
  }
}

function maybeSnapshot(root, usedPct) {
  if (usedPct < 70) return;
  const runtimeDir = path.join(root, 'tools', 'HME', 'runtime');
  const sentinel = path.join(runtimeDir, 'hme-chain-snapshot-fired');
  const script = path.join(root, 'tools', 'HME', 'scripts', 'chain-snapshot.py');
  if (fs.existsSync(sentinel) || !fs.existsSync(script)) return;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(sentinel, String(Math.floor(Date.now() / 1000)));
  const child = spawn('python3', [script, '--imminent'], {
    cwd: root,
    env: { ...process.env, PROJECT_ROOT: root },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main() {
  const input = await readStdin();
  let root = '';
  try { root = projectRoot(); } catch (_e) { /* best effort */ }
  if (root) {
    try { fs.writeFileSync(path.join(root, 'tools', 'HME', 'runtime', 'claude-statusline-raw.json'), input); } catch (_e) { /* best effort */ }
  }
  if (!input) {
    process.stdout.write('ctx:?\n');
    return;
  }
  try {
    if (!root) root = projectRoot();
    const data = JSON.parse(input);
    const ctx = data.context_window || {};
    const model = data.model || {};
    const usedPct = Math.round(Number(ctx.used_percentage || 0));
    const remainingPct = Math.round(Number(ctx.remaining_percentage || 0));
    const out = {
      used_pct: usedPct,
      remaining_pct: remainingPct,
      size: Number(ctx.context_window_size || 0),
      model_id: model.id || '',
      model_name: model.display_name || '',
    };
    fs.writeFileSync(path.join(root, 'tools', 'HME', 'runtime', 'claude-context.json'), JSON.stringify(out));
    maybeSnapshot(root, usedPct);
    const label = model.display_name || model.id || '';
    const lifesaver = autocompactLifesaver(root, data);
    process.stdout.write(`ctx:${remainingPct}%${label ? ` | ${label}` : ''}${latestClassifier(root)}${lifesaver}\n`);
    if (lifesaver) {
      process.stderr.write(`LIFESAVER! autocompact widget is being fed wrong context% -- see log/hme-lifesaver.log${lifesaver}\n`);
    }
  } catch (_e) {
    // silent-ok: optional fallback path.
    process.stdout.write('ctx:?\n');
  }
}

main();
