'use strict';

function createOpusGate({ env = process.env, log = console.error } = {}) {
  let opusInflight = Promise.resolve();
  let lastOpusFinishedAt = 0;
  const minGapMs = parseInt(env.HME_PROXY_OPUS_MIN_GAP_MS || '6000', 10);
  const disabled = env.HME_PROXY_OPUS_GATE_OFF === '1';

  async function acquireOpusSlot() {
    if (disabled) return () => {};
    const prev = opusInflight;
    let release;
    opusInflight = new Promise((resolve) => { release = resolve; });
    try { await prev; } catch (_) { /* prior failure should not block successor */ }
    const sinceLast = Date.now() - lastOpusFinishedAt;
    if (lastOpusFinishedAt > 0 && sinceLast < minGapMs) {
      const delay = minGapMs - sinceLast;
      log(`Opus-gate: queuing ${delay}ms (rolling-window protection)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      lastOpusFinishedAt = Date.now();
      release();
    };
  }

  return { acquireOpusSlot };
}

// Acquire an Opus concurrency slot ONLY for interactive Anthropic Opus requests.
// Always returns a release fn (a no-op for non-Opus paths) so callers invoke the
async function acquireOpusSlotIfNeeded({ isAnthropic, isInteractivePath, payload, acquireOpusSlot }) {
  const isOpusReq = isAnthropic && isInteractivePath
    && payload && typeof payload.model === 'string'
    && /opus/i.test(payload.model);
  if (!isOpusReq || typeof acquireOpusSlot !== 'function') return () => {};
  return acquireOpusSlot();
}

module.exports = { createOpusGate, acquireOpusSlotIfNeeded };
