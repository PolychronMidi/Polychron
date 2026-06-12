'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { formatMiddlewareThrowLine, _MIDDLEWARE_THROW_RE } = require('../../proxy/middleware/_middleware_throw_lifesaver');

// The UserPromptSubmit scanner (tools/HME/hooks/lifecycle/userpromptsubmit.sh)
// banners a line iff, after stripping the leading [timestamp]:
const LIFESAVER_TEXT_RE = /\[ALERT\]\s+LIFESAVER|\bLIFESAVER\s+--/;
const EXCLUDED_TAGS = /^\[(?:_safe_curl|_safe_jq|_safe_py3|universal_pulse|supervisor|hme-proxy|proxy-bridge|proxy-watchdog|hook-watchdog|proxy-supervisor|llamacpp_supervisor|meta_observer|model_init|startup_chain|worker_client)\]/;
const INFO_WORDS = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;

test('the line trips LIFESAVER_TEXT_RE so the scanner banners it', () => {
  const line = formatMiddlewareThrowLine('00a_shortcuts_rewriter', new Error('boom'));
  assert.match(line, LIFESAVER_TEXT_RE);
});

test('the source tag is not in the routine-ops exclude list', () => {
  const line = formatMiddlewareThrowLine('00a_shortcuts_rewriter', new Error('boom'));
  // The scanner strips a leading [timestamp] before tag-matching.
  const afterTs = line.replace(/^\[[^\]]*\]\s*/, '');
  assert.doesNotMatch(afterTs, EXCLUDED_TAGS);
});

test('the line carries no INFO/WARN words that would filter it out', () => {
  const line = formatMiddlewareThrowLine('00a_shortcuts_rewriter', new Error('kaboom'));
  assert.doesNotMatch(line, INFO_WORDS);
});

test('the line names the middleware and the error message', () => {
  const line = formatMiddlewareThrowLine('00a_shortcuts_rewriter', new Error('null deref'));
  assert.match(line, /00a_shortcuts_rewriter/);
  assert.match(line, /null deref/);
});

test('the detection regex matches our own emitted line (round-trip)', () => {
  const line = formatMiddlewareThrowLine('07_edit_context', new Error('x'));
  assert.match(line, _MIDDLEWARE_THROW_RE);
});

test('non-Error throws are stringified safely', () => {
  const line = formatMiddlewareThrowLine('09_read_context', 'plain string throw');
  assert.match(line, /plain string throw/);
  assert.match(line, LIFESAVER_TEXT_RE);
});

test('recordMiddlewareThrow appends a newline-terminated line to hme-errors.log', () => {
  const { recordMiddlewareThrow } = require('../../proxy/middleware/_middleware_throw_lifesaver');
  const tmpRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mwthrow-'));
  recordMiddlewareThrow(tmpRoot, '00a_shortcuts_rewriter', new Error('disk test'));
  const logged = fs.readFileSync(path.join(tmpRoot, 'log', 'hme-errors.log'), 'utf8');
  assert.match(logged, LIFESAVER_TEXT_RE);
  assert.match(logged, /00a_shortcuts_rewriter/);
  assert.ok(logged.endsWith('\n'));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
