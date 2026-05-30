'use strict';
// config/shortcuts.json is the single source of truth for input shortcuts.
// These tests lock the lane separation that keeps /compact off the wire:

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const cfg = require('../../proxy/shortcuts_config');
const rewriter = require('../../proxy/middleware/00a_shortcuts_rewriter');
const adapter = require('../../event_kernel/claude_adapter');

test('raw config has cc under the top-level "multi-step" key', () => {
  const raw = JSON.parse(fs.readFileSync(cfg.CONFIG_PATH, 'utf8'));
  assert.ok(raw['multi-step'] && raw['multi-step'].cc, 'cc must live under "multi-step"');
  assert.deepEqual(raw['multi-step'].cc.steps, ['/compact', 'continue']);
  assert.ok(raw.simple && raw['two-step'], 'wire lanes present');
});

test('loader exposes the three lanes with the expected keys', () => {
  assert.deepEqual(Object.keys(cfg.SHORTCUTS).sort(), ['c', 'd', 'e', 'm', 'n', 'r']);
  assert.deepEqual(Object.keys(cfg.TWO_STEP_SHORTCUTS), ['1']);
  assert.deepEqual(Object.keys(cfg.MULTI_STEP_SHORTCUTS), ['cc']);
  assert.deepEqual(cfg.multiStepSteps('cc'), ['/compact', 'continue']);
});

test('LANE SEPARATION: cc is local-session only -- never in a wire lane', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.SHORTCUTS, 'cc'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.TWO_STEP_SHORTCUTS, 'cc'), false);
  // cc has no wire display because it is never a wire substitution.
  assert.equal(cfg.shortcutDisplay('cc'), null);
  // wire shortcuts still resolve a display.
  assert.equal(cfg.shortcutDisplay('n'), 'next suggestions?');
  assert.equal(cfg.shortcutDisplay('1'), "reply only with 'hi'");
});

test('multiStepKey matches multi-step keys case/space-insensitively, nothing else', () => {
  assert.equal(cfg.multiStepKey('cc'), 'cc');
  assert.equal(cfg.multiStepKey('  CC '), 'cc');
  assert.equal(cfg.multiStepKey('ccc'), null);
  assert.equal(cfg.multiStepKey('n'), null);
  assert.equal(cfg.multiStepKey('1'), null);
});

test('SINGLE SOURCE: the proxy middleware re-exports the loader maps (no drift)', () => {
  assert.equal(rewriter.SHORTCUTS, cfg.SHORTCUTS);
  assert.equal(rewriter.TWO_STEP_SHORTCUTS, cfg.TWO_STEP_SHORTCUTS);
});

test('SINGLE SOURCE: the adapter detects exactly the config multi-step keys', () => {
  // _isCcShortcut now resolves ANY multi-step key from the shared config.
  assert.ok(adapter._isCcShortcut(JSON.stringify({ prompt: 'cc' })));
  assert.ok(adapter._isCcShortcut(JSON.stringify({ prompt: '  CC ' })));
  assert.equal(adapter._isCcShortcut(JSON.stringify({ prompt: 'ccc' })), null);
  // wire-lane keys are NOT intercepted at the hook -- they belong to the proxy.
  assert.equal(adapter._isCcShortcut(JSON.stringify({ prompt: 'n' })), null);
  assert.equal(adapter._isCcShortcut(JSON.stringify({ prompt: '1' })), null);
});

test('adapter block reason matches the bridge success-banner template (suppression stays in sync)', () => {
  const out = adapter._handleCcShortcut({ stdout: '', stderr: ' ', exit_code: 0 }, JSON.stringify({ prompt: 'cc' }));
  const reason = JSON.parse(out.stdout).reason;
  // Bridge (hme-claude.py success_banner_text) builds: "<key> shortcut: dispatched
  // <steps join ' -> '> to the live session via the PTY bridge." -- must match so
  assert.equal(reason, 'cc shortcut: dispatched /compact -> continue to the live session via the PTY bridge.');
});
