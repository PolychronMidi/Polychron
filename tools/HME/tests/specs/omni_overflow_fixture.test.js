'use strict';
// Deterministic regression for the OmniRoute over-window compaction-depth class,
// reconstituted from a SANITIZED structural skeleton of a real

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createContextBudget } = require('../../proxy/hme_proxy_context_budget');
const { semanticTokenEstimate, serializedBytes } = require('../../proxy/context_token_estimate');

const SKELETON = path.join(__dirname, '..', 'fixtures', 'omni_overflow_skeleton.json');

// Rebuild a faithful payload from the skeleton: each recorded block becomes a
// real block of the same type with placeholder content of the recorded length.
function reconstitute(skel) {
  const payload = { model: skel.model, system: 'x'.repeat(skel.system_bytes || 0), tools: [], messages: [] };
  for (let i = 0; i < (skel.tools_count || 0); i += 1) {
    payload.tools.push({ name: (skel.tool_names || [])[i] || `Tool${i}`, description: 'x'.repeat(200), input_schema: { type: 'object' } });
  }
  let useId = 0;
  for (const m of skel.messages) {
    const content = [];
    for (const b of m.blocks) {
      if (b.t === 'tool_use') { content.push({ type: 'tool_use', id: `tu_${useId++}`, name: b.name || 'Tool', input: { q: 'x'.repeat(Math.max(0, (b.in || 2) - 8)) } }); }
      else if (b.t === 'tool_result') { content.push({ type: 'tool_result', tool_use_id: `tr_${useId}`, content: 'x'.repeat(b.n || 0) }); }
      else if (b.t === 'text') { content.push({ type: 'text', text: 'x'.repeat(b.n || 0) }); }
      else if (b.t === 'thinking') { content.push({ type: 'thinking', thinking: 'x'.repeat(b.n || 0), signature: 's'.repeat(b.sig || 64) }); }
      else if (b.t === 'str') { content.push({ type: 'text', text: 'x'.repeat(b.n || 0) }); }
      else { content.push({ type: 'text', text: 'x'.repeat(b.n || 0) }); }
    }
    payload.messages.push({ role: m.role || 'user', content: m.blocks.length === 1 && m.blocks[0].t === 'str' ? 'x'.repeat(m.blocks[0].n || 0) : content });
  }
  // Close the residual key-overhead gap so the reconstituted payload matches the
  // real serialized footprint (real ids/keys are longer than placeholders). Extend
  const target = Number(skel.real_serialized_bytes || 0);
  if (target > 0) {
    const deficit = target - serializedBytes(payload);
    if (deficit > 0) {
      const oldest = payload.messages.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'text'))
        || payload.messages.find((m) => typeof m.content === 'string');
      if (oldest && Array.isArray(oldest.content)) {
        const tb = oldest.content.find((b) => b.type === 'text');
        tb.text += 'x'.repeat(deficit);
      } else if (oldest) {
        oldest.content += 'x'.repeat(deficit);
      }
    }
  }
  return payload;
}

test('real-shape OmniRoute overflow snapshot compacts via stale tool_result elision', () => {
  const skel = JSON.parse(fs.readFileSync(SKELETON, 'utf8'));
  assert.equal(skel.messages.length, 470, 'skeleton must preserve real message count');
  const oldEnv = { ...process.env };
  const runtimeDir = path.join(require('../../proxy/shared').PROJECT_ROOT, 'tools/HME/runtime');
  const statusline = path.join(runtimeDir, 'claude-statusline-raw.json');
  const prev = fs.existsSync(statusline) ? fs.readFileSync(statusline, 'utf8') : null;
  try {
    try { fs.unlinkSync(statusline); } catch (_e) { /* fixture absent */ }
    process.env.HME_PROXY_CONTEXT_BYTES_PER_TOKEN_EST = '2.6';
    process.env.HME_PROXY_CONTEXT_PREFLIGHT_FRACTION = '0.85';
    process.env.HME_PROXY_COMPACT_KEEP_MIN = '20';
    process.env.HME_PROXY_STALE_TOOL_KEEP_TURNS = '15';
    process.env.HME_PROXY_COMPACT_TOOL_RESULT_BYTE_FLOOR = '15000';
    process.env.HME_PROXY_COMPACT_BYTES = '4000000';
    process.env.HME_PROXY_COMPACT_START_FRACTION = '0.85';
    process.env.HME_PROXY_COMPACT_GEAR1_END = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR2_END = '0.95';
    process.env.HME_PROXY_COMPACT_GEAR1_TARGET = '0.85';
    process.env.HME_PROXY_COMPACT_GEAR2_TARGET = '0.90';
    process.env.HME_PROXY_COMPACT_GEAR3_TARGET = '0.95';
    process.env.HME_PROXY_OMNI_LOCAL_SUMMARY = '0';
    process.env.HME_OMO_PRUNING_BRIDGE = '0';
    const payload = reconstitute(skel);
    const beforeBytes = serializedBytes(payload);
    const beforeTokens = semanticTokenEstimate(payload, process.env);
    assert.ok(beforeBytes > 1_000_000, `reconstituted payload should match real ~1.2MB scale, got ${beforeBytes}`);
    const budget = createContextBudget();
    const changed = budget.shrinkForContext(payload, 'gpt-5.5-xhigh');
    const afterTokens = semanticTokenEstimate(payload, process.env);
    assert.ok(changed > 0, 'compaction must elide stale tool_result blocks');
    assert.ok(afterTokens < beforeTokens, `compaction must reduce estimate (${beforeTokens} -> ${afterTokens})`);
    assert.ok(afterTokens < 480000, `post-compaction estimate ${afterTokens} must fit gpt-5.5-xhigh budget`);
    assert.equal(payload.messages.length, 470, 'tier-1 microcompaction must not drop messages');
  } finally {
    process.env = oldEnv;
    if (prev != null) fs.writeFileSync(statusline, prev);
  }
});
