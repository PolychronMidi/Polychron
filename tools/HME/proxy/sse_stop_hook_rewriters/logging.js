'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const STRATEGY_LOG_FILES = Object.freeze({
  'bare-ack-strip': 'hme-bare-ack-strips.jsonl',
  'turn-prefix-strip': 'hme-turn-prefix-strips.jsonl',
  'hallucinated-turn-prefix-strip': 'hme-turn-prefix-strips.jsonl',
  'stop-hook-ceremony-strip': 'hme-stop-hook-ceremony-strips.jsonl',
  'fp-gate-marker': 'hme-fp-gate-marker.jsonl',
  'solo-rationale-trim': 'hme-solo-rationale-trim.jsonl',
});

function ctxGet(ctx, key) {
  if (ctx && typeof ctx.get === 'function') return ctx.get(key);
  return ctx ? ctx[key] : undefined;
}

function ctxSet(ctx, key, value) {
  if (!ctx) return;
  if (typeof ctx.set === 'function') ctx.set(key, value);
  else ctx[key] = value;
}

function recordRewrite(name, next, ctx) {
  const records = ctxGet(ctx, 'stop_hook_text_rewrites') || [];
  records.push({ name, changed: true, final: Boolean(next && next.final) });
  ctxSet(ctx, 'stop_hook_text_rewrites', records);
}

function recordStrategyEvent(name, payload, ctx) {
  const file = STRATEGY_LOG_FILES[name];
  if (!file) return;
  try {
    const root = ctxGet(ctx, 'projectRoot') || PROJECT_ROOT;
    fs.mkdirSync(path.join(root, 'log'), { recursive: true });
    fs.appendFileSync(path.join(root, 'log', file), JSON.stringify({
      ts: new Date().toISOString(),
      strategy: name,
      ...payload,
    }) + '\n');
  } catch (_e) { /* best-effort */ }
}

module.exports = {
  STRATEGY_LOG_FILES,
  ctxGet,
  ctxSet,
  recordRewrite,
  recordStrategyEvent,
};
