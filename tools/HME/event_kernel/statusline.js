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

let _modelCtxCache = { mtimeMs: 0, map: null };
function modelInputBudget(root, modelId) {
  // Mirrors hme_proxy_context_budget.inputBudget; statusline must NOT trust
  // Claude Code's claimed context_window_size, which often reports legacy
  if (!modelId) return 0;
  try {
    const modelsPath = path.join(root, 'config', 'models.json');
    const stat = fs.statSync(modelsPath);
    if (!_modelCtxCache.map || stat.mtimeMs !== _modelCtxCache.mtimeMs) {
      const text = fs.readFileSync(modelsPath, 'utf8');
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      const cfg = JSON.parse(stripped);
      const map = new Map();
      for (const tier of Object.values(cfg.tiers || {})) {
        for (const m of tier.models || []) {
          const input = Number(m.max_input_tokens);
          const ctx = Number(m.context_length);
          const output = Number(m.max_output_tokens);
          let budget = 0;
          if (Number.isFinite(input) && input > 0) budget = input;
          else if (Number.isFinite(ctx) && ctx > 0) budget = (Number.isFinite(output) && output > 0 && ctx > output) ? ctx - output : ctx;
          if (budget > 0 && m.id) map.set(String(m.id), budget);
          if (budget > 0 && m.api_model) map.set(String(m.api_model), budget);
        }
      }
      _modelCtxCache = { mtimeMs: stat.mtimeMs, map };
    }
    const reg = _modelCtxCache.map;
    if (reg.has(modelId)) return reg.get(modelId);
    for (const [k, v] of reg) if (modelId.includes(k)) return v;
    return 0;
  } catch (_e) { return 0; }
}

function autocompactLifesaver(root, raw, trueSize) {
  // Fail-fast: Claude Code's "% until autocompact" widget is computed from
  // `anthropic-ratelimit-input-tokens-{limit,remaining}` headers. Truth size
  try {
    const ctx = (raw && raw.context_window) || {};
    const truthTotal = Number(ctx.total_input_tokens || 0);
    const truthSizeResolved = Number(trueSize || ctx.context_window_size || 0);
    if (!truthTotal || !truthSizeResolved) return '';
    const truthSize = truthSizeResolved;
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
    // Ratio drift: autocompact widget compares remaining/limit, so compare
    // the *percent remaining* the proxy injected vs the percent remaining the
    // statusline ground truth reports. Tolerate up to 5 percentage points to
    const truthRemPct = ((truthSize - truthTotal) / truthSize) * 100;
    const normRemPct = (norm.remaining / norm.size) * 100;
    const pctGap = Math.abs(truthRemPct - normRemPct);
    if (pctGap > 5) {
      _writeLifesaver(root, `proxy remaining=${normRemPct.toFixed(1)}% != truth remaining=${truthRemPct.toFixed(1)}% (gap ${pctGap.toFixed(1)}pp); autocompact widget LYING`);
      return ` | LIFESAVER!ctx-norm:gap ${pctGap.toFixed(1)}pp`;
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
    const claimedSize = Number(ctx.context_window_size || 0);
    const usedTokens = Number(ctx.total_input_tokens || 0);
    const modelId = String(model.id || model.api_model || '');
    const registrySize = modelInputBudget(root, modelId);
    // Trust registry over Claude Code's claim when registry has the model.
    const trueSize = registrySize > 0 ? registrySize : claimedSize;
    const usedPct = trueSize > 0 ? Math.round((usedTokens / trueSize) * 100) : Math.round(Number(ctx.used_percentage || 0));
    const remainingPct = trueSize > 0 ? Math.max(0, 100 - usedPct) : Math.round(Number(ctx.remaining_percentage || 0));
    let sizeAlert = '';
    if (registrySize > 0 && claimedSize > 0 && claimedSize !== registrySize) {
      _writeLifesaver(root, `Claude Code claims context_window_size=${claimedSize} for model=${modelId} but registry truth=${registrySize}; autocompact widget LYING (denominator wrong by ${(registrySize / claimedSize).toFixed(1)}x)`);
      sizeAlert = ` | LIFESAVER!ctx-window:claim ${claimedSize} truth ${registrySize}`;
    }
    const out = {
      used_pct: usedPct,
      remaining_pct: remainingPct,
      size: trueSize,
      claimed_size: claimedSize,
      registry_size: registrySize,
      used_tokens: usedTokens,
      model_id: model.id || '',
      model_name: model.display_name || '',
    };
    fs.writeFileSync(path.join(root, 'tools', 'HME', 'runtime', 'claude-context.json'), JSON.stringify(out));
    maybeSnapshot(root, usedPct);
    const label = model.display_name || model.id || '';
    const lifesaver = autocompactLifesaver(root, data, trueSize);
    process.stdout.write(`ctx:${remainingPct}%${label ? ` | ${label}` : ''}${latestClassifier(root)}${sizeAlert}${lifesaver}\n`);
    if (sizeAlert || lifesaver) {
      process.stderr.write(`LIFESAVER! autocompact widget is being fed wrong context% -- see log/hme-lifesaver.log${sizeAlert}${lifesaver}\n`);
    }
  } catch (_e) {
    // silent-ok: optional fallback path.
    process.stdout.write('ctx:?\n');
  }
}

main();
