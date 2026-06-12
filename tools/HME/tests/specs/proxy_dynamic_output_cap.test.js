'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const OLD_ENV_CAP = process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
delete process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
const { applyExplicitOtpmCap } = require('../../proxy/hme_proxy_request_mutation');
// hme_proxy_request_mutation imports shared.js, which loads .env. Remove the
// live deployment guardrail again so these tests exercise dynamic policy tiers.
delete process.env.HME_PROXY_MAX_OUTPUT_TOKENS;

function payloadOf({ model = 'cx/gpt-5.5-xhigh', maxTokens = 128000, approxTokens = 1000 }) {
  // The estimator uses JSON byte size / HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST.
  // Force 1 byte/token in these tests so policy tiers are deterministic.
  const filler = 'x'.repeat(Math.max(0, approxTokens - 200));
  return {
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: [{ role: 'user', content: filler }],
  };
}

function cappedMax(payload) {
  const before = payload.max_tokens;
  const changed = applyExplicitOtpmCap(payload);
  assert.equal(changed, payload.max_tokens !== before);
  return payload.max_tokens;
}

test('output cap honors the requested budget for small-context prompts', () => {
  const old = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
  try {
    const p = payloadOf({ approxTokens: 1000, maxTokens: 64000 });
    assert.equal(cappedMax(p), 64000);
  } finally {
    if (old === undefined) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
    else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = old;
  }
});

test('growing input does NOT throttle output -- only physical headroom + model cap bind', () => {
  const old = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
  try {
    // gpt-5.5-xhigh modelCap is 128000; large-but-not-overflowing inputs keep full outpu
    assert.equal(cappedMax(payloadOf({ approxTokens: 70_000 })), 128000);
    assert.equal(cappedMax(payloadOf({ approxTokens: 130_000 })), 128000);
    assert.equal(cappedMax(payloadOf({ approxTokens: 190_000 })), 128000);
    assert.equal(cappedMax(payloadOf({ approxTokens: 250_000 })), 128000);
  } finally {
    if (old === undefined) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
    else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = old;
  }
});

test('dynamic output cap respects lower model max output', () => {
  const old = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
  try {
    const p = payloadOf({ model: 'mistral-large-latest', approxTokens: 1000, maxTokens: 64000 });
    assert.equal(cappedMax(p), 8192);
  } finally {
    if (old === undefined) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
    else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = old;
  }
});

test('dynamic output cap respects explicit environment ceiling as guardrail', () => {
  const oldBytes = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  const oldCap = process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
  process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
  process.env.HME_PROXY_MAX_OUTPUT_TOKENS = '8192';
  try {
    const p = payloadOf({ approxTokens: 1000, maxTokens: 64000 });
    assert.equal(cappedMax(p), 10240);
  } finally {
    if (oldBytes === undefined) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
    else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = oldBytes;
    if (oldCap === undefined) delete process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
    else process.env.HME_PROXY_MAX_OUTPUT_TOKENS = oldCap;
  }
});

test('dynamic output cap also caps thinking budget below output budget', () => {
  const old = process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
  process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '1';
  try {
    const p = payloadOf({ approxTokens: 130_000, maxTokens: 128000 });
    p.thinking = { type: 'enabled', budget_tokens: 128000 };
    assert.equal(applyExplicitOtpmCap(p), true);
    assert.equal(p.max_tokens, 128000);
    assert.equal(p.thinking.budget_tokens, 102400);
  } finally {
    if (old === undefined) delete process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST;
    else process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = old;
  }
});
