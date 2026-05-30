'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _stripSlop, slopStripRewrite, _stripCenterVowelsWord } = require('../../proxy/sse_slop_rewriter');

test('slop caveman compression deletes requested glue words case-insensitively', () => {
  const result = _stripSlop("I'm the one; I am now too ready; it has the fix; I will ship now.");
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, '1; rdy; fix; ship.');
});

test('slop abbreviations are case-insensitive and preserve punctuation', () => {
  const result = _stripSlop('Acknowledged. WITHOUT delay, move into tests and to prod.');
  assert.ok(result.hits.includes('caveman_abbreviations'));
  assert.equal(result.out, 'K. W/o delay, move 2 tests & - prod.');
});

test('slop abbreviations do not rewrite no to n', () => {
  const result = _stripSlop('No, no means no.');
  assert.equal(result.out, 'No, no means no.');
});

test('slop formatting stripper removes markdown emphasis outside code', () => {
  const result = _stripSlop('Use **bold** and *italic* and __strong__ and _emphasis_, not `*code*`.');
  assert.ok(result.hits.includes('markdown_formatting'));
  assert.equal(result.out, 'Use bold & italic & strong & emphsis, not `*code*`');
});

test('slop caveman contractions are ordered before bare pronouns', () => {
  const result = _stripSlop("You're ready and we’re done; you'll see we’ll pass.");
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'Rdy & done; see pass.');
  assert.doesNotMatch(result.out, /['’](re|ll|m)\b/);
});

test('slop caveman ing suffix shortens long gerunds outside code', () => {
  const result = _stripSlop('Running walking testing during thing string spring.');
  assert.ok(result.hits.includes('caveman_ing_suffix'));
  assert.equal(result.out, 'Runnn walkn testn dur thing string spring.');
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
  assert.equal(result.out, 'Decisn revisn expnsn vision fisson v.');
});

test('slop caveman ment suffix shortens long ment words outside code', () => {
  const result = _stripSlop('Agreement shipment fragment cement moment development environment.');
  assert.ok(result.hits.includes('caveman_ment_suffix'));
  assert.ok(result.hits.includes('caveman_abbreviations'), 'specific abbreviation map should still run first');
  assert.equal(result.out, 'Agremt shipmt fragmt cement moment dev env.');
});

test('slop caveman ly suffix shortens long ly words outside code', () => {
  const result = _stripSlop('Locally globally normally ally.');
  assert.ok(result.hits.includes('caveman_ly_suffix'));
  assert.equal(result.out, 'Localy globly normly ally.');
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

test('slop center-vowel stripping preserves first-letter vowels', () => {
  assert.equal(_stripSlop('Example operation umbrella academy.').out, 'Ex opertn umbrlla acadmy.');
  assert.equal(_stripSlop('Overview iteration.').out, 'Overvew itertn.');
});

test('slop compaction preserves newline entries', () => {
  const result = _stripSlop('First : one\nSecond : two\nThird : three');
  assert.ok(result.hits.includes('caveman_non_alnum_compaction'));
  assert.equal(result.out, '1st: 1\n2nd: 2\n3rd: 3');
});

test('slop cleanup collapses punctuation left by caveman deletions', () => {
  const result = _stripSlop('RIGHT. Okay? AGREED! A plan remains.');
  assert.ok(result.hits.includes('caveman_compression'));
  assert.equal(result.out, 'Plan remins.');
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
  assert.equal(out.events[1][1].delta.thinking, 'Checkn path.');
});

test('caveman patterns do not mutate content inside backtick spans', () => {
  const result = _stripSlop('Run `git config --get user.name and verify` to confirm.');
  assert.ok(result.hits.includes('caveman_abbreviations'), 'still fires on prose');
  assert.match(result.out, /`git config --get user\.name and verify`/, 'backtick span content preserved verbatim');
});

test('caveman cleanup preserves boundaries after highlighted code words', () => {
  const result = _stripSlop('Use `stripSlop` testing and `parseResult` relation.');
  assert.equal(result.out, 'Use `stripSlop` testn & `parseResult` relatn.');
  assert.doesNotMatch(result.out, /`stripSlop`testn|`parseResult`relatn/);
});

test('caveman cleanup preserves boundaries around protected file and flag tokens', () => {
  const result = _stripSlop('Check package.json testing and --dry-run relation.');
  assert.equal(result.out, 'Check package.json testn & --dry-run relatn.');
  assert.doesNotMatch(result.out, /package\.jsontestn|--dry-runrelatn/);
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

// Helper: drive the streaming rewriter and collect emitted events.
function _drive(events) {
  const ctx = new Map();
  const out = [];
  for (const [name, data] of events) {
    const r = slopStripRewrite(name, data, ctx);
    if (r === null) continue;
    if (r && Array.isArray(r.events)) out.push(...r.events);
    else out.push([name, r]);
  }
  return out;
}
function _textOf(events) {
  return events
    .filter((e) => e[1] && e[1].delta && typeof e[1].delta.text === 'string')
    .map((e) => e[1].delta.text).join('');
}

test('mid-block non-text delta does NOT split a word across strip passes (NSpectn regression)', () => {
  // "inspection" arrives as ["in","spection"] with an interleaved non-text
  // delta. Before the fix, the partial "in" was compressed to "N" on its own,
  const out = _drive([
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'in' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'x' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'spection done' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ]);
  assert.equal(_textOf(out), 'Inspctn done');
});

test('signature_delta on held thinking block is preserved (replayed after content at stop)', () => {
  const ctx = new Map();
  const startData = { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } };
  assert.equal(slopStripRewrite('content_block_start', startData, ctx), null);
  // text then signature mid-block -- both held, nothing flushed yet.
  assert.equal(slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plain reasoning' } }, ctx), null);
  const sigDelta = { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } };
  assert.equal(slopStripRewrite('content_block_delta', sigDelta, ctx), null);
  const stop = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 0 }, ctx);
  assert.ok(stop && Array.isArray(stop.events), 'stop must emit a flush array');
  // start first, signature preserved, single start, stop last.
  assert.equal(stop.events[0][0], 'content_block_start');
  assert.equal(stop.events.filter((e) => e[0] === 'content_block_start').length, 1, 'no duplicate start');
  assert.ok(JSON.stringify(stop.events).includes('abc'), 'signature preserved');
  assert.equal(stop.events[stop.events.length - 1][0], 'content_block_stop');
});

test('slop leaves a structured-JSON text block byte-identical (the /goal Stop-hook verdict 400 repro)', () => {
  // Root cause of "Stop hook error: JSON validation failed": Claude Code's /goal
  // Stop-hook asks the model for a JSON verdict; caveman compression abbreviated
  // its keys (continue -> "") and vowel-stripped the reason, so the host parsed
  // corrupted JSON. A full-block JSON response must pass through untouched.
  const ctx = (() => { const m = new Map(); return { get: (k) => m.get(k), set: (k, v) => m.set(k, v) }; })();
  const json = JSON.stringify({
    continue: false,
    rsn: 'goal-build out the new todo system in doc/templates/todo.md & use while surveying HME for design-pattern optimizations. Transcript shows completion.',
  });
  slopStripRewrite('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }, ctx);
  slopStripRewrite('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: json } }, ctx);
  const res = slopStripRewrite('content_block_stop', { type: 'content_block_stop', index: 0 }, ctx);
  let out = '';
  for (const [name, ev] of res.events) {
    if (name === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') out += ev.delta.text;
  }
  assert.equal(out, json, 'JSON verdict must be emitted byte-identical (never caveman-compressed)');
  assert.doesNotThrow(() => JSON.parse(out), 'emitted JSON must stay parseable');
});
