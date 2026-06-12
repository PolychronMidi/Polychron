'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const fb = require('../../proxy/agent_feedback');
const stripMod = require('../../proxy/middleware/00_strip_skill_reminder');

test('buildFeedback rejects unknown kind', () => {
  assert.throws(() => fb.buildFeedback({ kind: 'bogus', text: 'x' }), /invalid kind/);
});

test('buildFeedback rejects empty text', () => {
  assert.throws(() => fb.buildFeedback({ kind: 'stop_hook', text: '' }), /non-empty string/);
});

test('renderEnvelope produces the canonical shape with kind+source attrs', () => {
  const out = fb.renderEnvelope({ kind: 'stop_hook', text: 'try harder', source: 'hme-proxy' });
  assert.ok(out.startsWith('<system-reminder kind="stop_hook" source="hme-proxy">'));
  assert.ok(out.endsWith('</system-reminder>'));
  assert.ok(fb.isCanonicalEnvelope(out));
});

test('canonical envelopes are stripped by middleware behavior', () => {
  const text = fb.renderEnvelope({ kind: 'proxy_status', text: 'route advanced to gpt-5.5-xhigh' });
  const payload = { messages: [{ content: [{ type: 'text', text }] }] };
  let dirty = false;
  stripMod.onRequest({ payload, ctx: { markDirty: () => { dirty = true; }, emit: () => {} } });
  assert.deepStrictEqual(payload.messages[0].content, []);
  assert.equal(dirty, true);
});

test('canonical envelopes are stripped without matching legacy skill reminders', () => {
  const canonical = fb.renderEnvelope({ kind: 'context_inject', text: 'recent edits: file.js' });
  const stop = '<system-reminder>\nThe following skills are available for use with the Skill tool:\nfoo\n</system-reminder>';
  const payload = { messages: [{ content: [
    { type: 'text', text: canonical },
    { type: 'text', text: stop },
  ] }] };
  stripMod.onRequest({ payload, ctx: { markDirty: () => {}, emit: () => {} } });
  assert.deepStrictEqual(payload.messages[0].content, []);
});
