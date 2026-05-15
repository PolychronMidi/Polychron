#!/usr/bin/env node
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
  return process.env.PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..', '..');
}

function latestClassifier(root) {
  const file = path.join(root, 'output', 'metrics', 'mode-classifier.jsonl');
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
  const sentinel = '/tmp/hme-chain-snapshot-fired';
  const script = path.join(root, 'tools', 'HME', 'scripts', 'chain-snapshot.py');
  if (fs.existsSync(sentinel) || !fs.existsSync(script)) return;
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
  try { fs.writeFileSync('/tmp/claude-statusline-raw.json', input); } catch (_e) { /* best effort */ }
  if (!input) {
    process.stdout.write('ctx:?\n');
    return;
  }
  try {
    const root = projectRoot();
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
    fs.writeFileSync(process.env.HME_CTX_FILE || '/tmp/claude-context.json', JSON.stringify(out));
    maybeSnapshot(root, usedPct);
    const label = model.display_name || model.id || '';
    process.stdout.write(`ctx:${remainingPct}%${label ? ` | ${label}` : ''}${latestClassifier(root)}\n`);
  } catch (_e) {
    // silent-ok: optional fallback path.
    process.stdout.write('ctx:?\n');
  }
}

main();
