'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../../proxy/swap_state_store');

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-state-store-'));
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  return dir;
}

const CHAIN = [
  { provider: 'anthropic', api_model: 'claude-opus-4-7' },
  { provider: 'codex', api_model: 'gpt-5.5-xhigh' },
  { provider: 'codex', api_model: 'gpt-5.5-high' },
];

test('chainSignature joins provider:model pairs', () => {
  assert.equal(store.chainSignature(CHAIN), 'anthropic:claude-opus-4-7|codex:gpt-5.5-xhigh|codex:gpt-5.5-high');
});

test('currentIndex returns 0 with no state file', () => {
  const root = tmpRoot();
  try { assert.equal(store.currentIndex(CHAIN, root), 0); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('currentIndex returns 0 when fail counter is zero', () => {
  const root = tmpRoot();
  try {
    fs.writeFileSync(store.filePath(root), JSON.stringify({ idx: 2, ts: Date.now(), fail: 0, chain: store.chainSignature(CHAIN) }));
    assert.equal(store.currentIndex(CHAIN, root), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('currentIndex honors idx when fail>0 within window', () => {
  const root = tmpRoot();
  try {
    fs.writeFileSync(store.filePath(root), JSON.stringify({ idx: 1, ts: Date.now(), fail: 2, chain: store.chainSignature(CHAIN) }));
    assert.equal(store.currentIndex(CHAIN, root), 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('currentIndex resets to 0 after success window expires', () => {
  const root = tmpRoot();
  try {
    const staleTs = Date.now() - store.SUCCESS_WINDOW_MS - 1000;
    fs.writeFileSync(store.filePath(root), JSON.stringify({ idx: 1, ts: staleTs, fail: 2, chain: store.chainSignature(CHAIN) }));
    assert.equal(store.currentIndex(CHAIN, root), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('currentIndex resets to 0 on chain-signature mismatch', () => {
  const root = tmpRoot();
  try {
    fs.writeFileSync(store.filePath(root), JSON.stringify({ idx: 1, ts: Date.now(), fail: 2, chain: 'old-chain' }));
    assert.equal(store.currentIndex(CHAIN, root), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recordFailure on empty state advances to idx=0 with fail=1', () => {
  const root = tmpRoot();
  try {
    const st = store.recordFailure(CHAIN, root);
    assert.equal(st.idx, 0);
    assert.equal(st.fail, 1);
    assert.equal(st.chain, store.chainSignature(CHAIN));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recordFailure twice in window advances idx', () => {
  const root = tmpRoot();
  try {
    store.recordFailure(CHAIN, root);
    const st = store.recordFailure(CHAIN, root);
    assert.equal(st.idx, 1);
    assert.equal(st.fail, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recordFailure wraps around chain', () => {
  const root = tmpRoot();
  try {
    for (let i = 0; i < CHAIN.length + 1; i++) store.recordFailure(CHAIN, root);
    const st = store.peek(root);
    assert.equal(st.idx, 1, 'wrapped past chain.length');
    assert.equal(st.fail, CHAIN.length + 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recordSuccess pins idx and clears fail counter', () => {
  const root = tmpRoot();
  try {
    store.recordFailure(CHAIN, root);
    store.recordFailure(CHAIN, root);
    const st = store.recordSuccess(CHAIN, 2, root);
    assert.equal(st.idx, 2);
    assert.equal(st.fail, 0);
    assert.equal(store.currentIndex(CHAIN, root), 0, 'fail=0 forces idx=0 on next lookup');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reset clears state', () => {
  const root = tmpRoot();
  try {
    store.recordFailure(CHAIN, root);
    store.reset(root);
    const st = store.peek(root);
    assert.equal(st.idx, 0);
    assert.equal(st.fail, 0);
    assert.equal(st.ts, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
