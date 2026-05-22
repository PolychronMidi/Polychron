'use strict';

// Repository for OmniRoute fallback chain state. Schema, 5-min success window,
// and read/write path live here; callers stay free of schema drift.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const SUCCESS_WINDOW_MS = 300_000;
const EMPTY = { idx: 0, ts: 0, fail: 0, chain: '' };

function _filePath(projectRoot) {
  return path.join(projectRoot || PROJECT_ROOT, 'tmp', 'hme-omni-swap-state.json');
}

function chainSignature(chain) {
  return (chain || []).map((m) => `${m.provider || ''}:${m.api_model || m.id || ''}`).join('|');
}

function _read(projectRoot) {
  try { return JSON.parse(fs.readFileSync(_filePath(projectRoot), 'utf8')); }
  catch (_e) { return { ...EMPTY }; }
}

function _write(projectRoot, st) {
  const file = _filePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(st));
}

function _matchesChain(st, sig) { return st && st.chain === sig; }
function _inWindow(st, now) { return st && st.ts > 0 && (now - st.ts) < SUCCESS_WINDOW_MS; }

// manually_toprank only fronts the chain; failover still progresses.
function currentIndex(chain, projectRoot = PROJECT_ROOT) {
  if (!chain || !chain.length) return 0;
  const st = _read(projectRoot);
  const sig = chainSignature(chain);
  if (!_matchesChain(st, sig)) return 0;
  if (st.fail <= 0) return 0;
  if (st.ts && Date.now() - st.ts > SUCCESS_WINDOW_MS) return 0;
  return Math.min(st.idx || 0, chain.length - 1);
}

// record failure, advance idx; returns new state for logging.
// recordFailure() is called AFTER an upstream request failed, so the index
// the caller used must move forward. currentIndex() mirrors the resolution
function recordFailure(chain, projectRoot = PROJECT_ROOT) {
  const sig = chainSignature(chain);
  let st = _read(projectRoot);
  if (!_matchesChain(st, sig)) st = { ...EMPTY, chain: sig };
  const now = Date.now();
  const currentIdx = (st.fail > 0 && _inWindow(st, now)) ? (st.idx || 0) : 0;
  st.idx = (currentIdx + 1) % chain.length;
  st.ts = now;
  st.fail = (st.fail || 0) + 1;
  st.chain = sig;
  _write(projectRoot, st);
  return st;
}

// success at idx clears fail and pins that target for next request.
function recordSuccess(chain, idx, projectRoot = PROJECT_ROOT) {
  const sig = chainSignature(chain);
  const st = { idx: Math.min(idx || 0, Math.max(0, chain.length - 1)), ts: Date.now(), fail: 0, chain: sig };
  _write(projectRoot, st);
  return st;
}

function reset(projectRoot = PROJECT_ROOT) { _write(projectRoot, { ...EMPTY }); }
function peek(projectRoot = PROJECT_ROOT) { return _read(projectRoot); }

module.exports = {
  SUCCESS_WINDOW_MS,
  chainSignature,
  currentIndex,
  recordFailure,
  recordSuccess,
  reset,
  peek,
  filePath: _filePath,
};
