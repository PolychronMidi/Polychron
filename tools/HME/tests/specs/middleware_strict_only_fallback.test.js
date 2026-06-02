'use strict';
/**
 * Middleware strict-only tool-result-mutator fallback contract.
 *
 * index.js previously hand-maintained NON_STRICT_TOOL_RESULT_TEXT_MUTATORS as
 * a second source of truth for "which tool-result mutators are suppressed in
 * non-strict mode". It had already drifted from manifest.json (it was missing
 * background_dominance, which the manifest declares strict-only +
 * mutatesToolResult). The fallback is now DERIVED from the manifest. This
 * contract pins that derivation so the two can never diverge again.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const mw = require('../../proxy/middleware');

test('_strictOnlyToolResultMutators equals the manifest strict-only + mutatesToolResult set', () => {
  const manifest = mw._loadManifest();
  const expected = new Set(
    manifest.modules
      .filter((m) => m.strictMode === 'strict-only' && m.mutatesToolResult === true)
      .map((m) => m.name),
  );
  const actual = mw._strictOnlyToolResultMutators();
  assert.deepEqual([...actual].sort(), [...expected].sort());
});

test('derived fallback includes background_dominance (the previously-drifted entry)', () => {
  const actual = mw._strictOnlyToolResultMutators();
  assert.ok(actual.has('background_dominance'), 'background_dominance must be in the manifest-derived strict-only mutator set');
});

test('every derived fallback name is a real manifest module that mutates tool results', () => {
  const byName = mw._loadManifest().byName;
  for (const name of mw._strictOnlyToolResultMutators()) {
    const entry = byName.get(name);
    assert.ok(entry, `${name} must be a real manifest module`);
    assert.equal(entry.mutatesToolResult, true, `${name} must declare mutatesToolResult`);
    assert.equal(entry.strictMode, 'strict-only', `${name} must declare strict-only`);
  }
});
