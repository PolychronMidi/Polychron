'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _stripSlop, slopStripRewrite } = require('../../proxy/sse_slop_rewriter');

test('slop caveman compression deletes requested glue words case-insensitively', () => {
  const result = _stripSlop("I'm the one; I am now too ready; it has the fix; I will ship now.");
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'One; ready; it fix; ship.');
});

test('slop abbreviations are case-insensitive and preserve punctuation', () => {
  const result = _stripSlop('Acknowledged. WITHOUT delay, move into tests and to prod.');
  assert.ok(result.hits.includes('caveman_abbreviations'));
  assert.equal(result.out, 'K. W/o delay, move 2 tests & - prod.');
});

test('slop caveman contractions are ordered before bare pronouns', () => {
  const result = _stripSlop("You're ready and we’re done; you'll see we’ll pass.");
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'Ready & done; see pass.');
  assert.doesNotMatch(result.out, /['’](re|ll|m)\b/);
});

test('slop caveman ing suffix shortens long gerunds outside code', () => {
  const result = _stripSlop('Running walking testing during thing string spring.');
  assert.ok(result.hits.includes('caveman_ing_suffix'));
  assert.equal(result.out, 'Runn walkn testn durn thing string spring.');
});

test('slop caveman ed suffix shortens long past-tense words outside code', () => {
  const result = _stripSlop('Tested walked checked fixed red bed.');
  assert.ok(result.hits.includes('caveman_ed_suffix'));
  assert.equal(result.out, 'Testd walkd checkd fixed red bed.');
});

test('slop caveman tion suffix shortens long tion words outside code', () => {
  const result = _stripSlop('Station caution relation action option configuration application.');
  assert.ok(result.hits.includes('caveman_tion_suffix'));
  assert.ok(result.hits.includes('caveman_abbreviations'), 'specific abbreviation map should still run first');
  assert.equal(result.out, 'Statn cautn relatn action option config app.');
});

test('slop caveman sion suffix shortens long sion words outside code', () => {
  const result = _stripSlop('Decision revision expansion vision fission version.');
  assert.ok(result.hits.includes('caveman_sion_suffix'));
  assert.ok(result.hits.includes('caveman_abbreviations'), 'specific abbreviation map should still run first');
  assert.equal(result.out, 'Decisn revisn expansn vision fission v.');
});

test('slop caveman ment suffix shortens long ment words outside code', () => {
  const result = _stripSlop('Agreement shipment fragment cement moment development environment.');
  assert.ok(result.hits.includes('caveman_ment_suffix'));
  assert.ok(result.hits.includes('caveman_abbreviations'), 'specific abbreviation map should still run first');
  assert.equal(result.out, 'Agreemt shipmt fragmt cement moment dev env.');
});

test('slop caveman ly suffix shortens long ly words outside code', () => {
  const result = _stripSlop('Locally globally normally ally.');
  assert.ok(result.hits.includes('caveman_ly_suffix'));
  assert.equal(result.out, 'Localy globaly normaly ally.');
});

test('slop caveman ior suffix shortens long ior words outside code', () => {
  const result = _stripSlop('Behavior superior interior prior.');
  assert.ok(result.hits.includes('caveman_ior_suffix'));
  assert.equal(result.out, 'Behavr superr interr prior.');
});

test('slop caveman suffixes let specific abbreviations and deletes win first', () => {
  const result = _stripSlop('Configuration application development environment agreed.');
  assert.ok(result.hits.includes('caveman_abbreviations'));
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'Config app dev env.');
  assert.doesNotMatch(result.out, /configuratn|applicatn|developmt|environmt|agre/);
});

test('slop caveman suffixes avoid code-ish URL path flag and dotted tokens', () => {
  const input = 'Open https://x.test/configuration and /project/application --configuration package.json before testing relation.';
  const result = _stripSlop(input);
  assert.match(result.out, /https:\/\/x\.test\/configuration/);
  assert.match(result.out, /\/project\/application/);
  assert.match(result.out, /--configuration/);
  assert.match(result.out, /package\.json/);
  assert.match(result.out, /testn relatn/);
});

test('slop cleanup collapses punctuation left by caveman deletions', () => {
  const result = _stripSlop('RIGHT. Okay? AGREED! A plan remains.');
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'Plan remains.');
});

test('slop rewriter applies full slop stripping to text blocks without deny gate', () => {
  const ctx = new Map();
  assert.equal(slopStripRewrite('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, ctx), null);
  assert.equal(slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Acknowledged. I will now fix the thing and test.' } }, ctx), null);
  const out = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 0 }, ctx);
  assert.equal(out.events[1][1].delta.type, 'text_delta');
  assert.equal(out.events[1][1].delta.text, 'K. Fix thing & test.');
});

test('stop-hook bare ack treats slop-compressed K as strip-worthy after deny', () => {
  const { _isBareAck } = require('../../proxy/sse_stop_hook_rewriters');
  assert.equal(_isBareAck('K.'), true);
});

test('slop rewriter applies caveman compression to thinking blocks without deny gate', () => {
  const ctx = new Map();
  assert.equal(slopStripRewrite('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } }, ctx), null);
  assert.equal(slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'I am now checking the path.' } }, ctx), null);
  const out = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 1 }, ctx);
  assert.equal(out.events[1][1].delta.type, 'thinking_delta');
  assert.equal(out.events[1][1].delta.thinking, 'Checkin path.');
});

test('caveman patterns do not mutate content inside backtick spans', () => {
  const result = _stripSlop('Run `git config --get user.name and verify` to confirm.');
  assert.ok(result.hits.includes('caveman_abbreviations'), 'still fires on prose');
  assert.match(result.out, /`git config --get user\.name and verify`/, 'backtick span content preserved verbatim');
});

test('caveman cleanup preserves boundaries after highlighted code words', () => {
  const result = _stripSlop('Use `stripSlop` testing and `parseResult` relation.');
  assert.equal(result.out, 'Use `stripSlop` testin & `parseResult` relatn.');
  assert.doesNotMatch(result.out, /`stripSlop`testin|`parseResult`relatn/);
});

test('caveman cleanup preserves boundaries around protected file and flag tokens', () => {
  const result = _stripSlop('Check package.json testing and --dry-run relation.');
  assert.equal(result.out, 'Check package.json testin & --dry-run relatn.');
  assert.doesNotMatch(result.out, /package\.jsontestin|--dry-runrelatn/);
});

test('caveman patterns do not mutate content inside triple-backtick fences', () => {
  const input = 'Then we run:\n```\ncurl -X POST http://api/v1 and check the response\n```\nand then move on.';
  const result = _stripSlop(input);
  assert.match(result.out, /curl -X POST http:\/\/api\/v1 and check the response/, 'fenced code untouched');
});

test('caveman patterns continue to fire on prose between code spans', () => {
  const result = _stripSlop('I will now run `npm test` and we will see the result.');
  assert.ok(result.hits.includes('caveman_compression'), 'prose still compressed');
  assert.match(result.out, /`npm test`/, 'code span survives');
  assert.doesNotMatch(result.out, /\bI will\b/, 'I-will outside code is stripped');
});

test('text without backticks takes the fast path unchanged in behavior', () => {
  const result = _stripSlop('I will now run the test and we will see.');
  assert.ok(result.hits.includes('caveman_compression'));
});

test('signature_delta on held thinking block flushes the start before the delta', () => {
  const ctx = new Map();
  const startData = { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } };
  assert.equal(slopStripRewrite('content_block_start', startData, ctx), null);
  const sigDelta = { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } };
  const flushed = slopStripRewrite('content_block_delta', sigDelta, ctx);
  assert.ok(flushed && Array.isArray(flushed.events), 'signature_delta must trigger flush events');
  assert.equal(flushed.events[0][0], 'content_block_start', 'start emitted before signature_delta');
  assert.deepEqual(flushed.events[0][1], startData);
  assert.equal(flushed.events[1][0], 'content_block_delta');
  assert.deepEqual(flushed.events[1][1], sigDelta);
  const stop = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 0 }, ctx);
  assert.ok(stop && Array.isArray(stop.events), 'stop must emit a flush array');
  const startEventsAfterStop = stop.events.filter((e) => e[0] === 'content_block_start');
  assert.equal(startEventsAfterStop.length, 0, 'no duplicate content_block_start after stop');
  assert.equal(stop.events[stop.events.length - 1][0], 'content_block_stop');
});
