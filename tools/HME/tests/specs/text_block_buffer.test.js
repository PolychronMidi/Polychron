const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { SseTransform } = require('../../proxy/sse_transform');
const { makeTextBlockBufferedRewriter } = require('../../proxy/sse_stop_hook_rewriters/text_block_buffer');

function textStart(index) {
  return { type: 'content_block_start', index, content_block: { type: 'text', text: '' } };
}

function toolStart(index) {
  return { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `t${index}`, name: 'Read', input: {} } };
}

function textDelta(index, text) {
  return { type: 'content_block_delta', index, delta: { type: 'text_delta', text } };
}

function weirdDelta(index) {
  return { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: 'hmm' } };
}

function blockStop(index) {
  return { type: 'content_block_stop', index };
}

function event(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function runSse(raw, rewriters) {
  const xform = new SseTransform({ rewriters });
  const chunks = [];
  xform.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  xform.end(Buffer.from(raw, 'utf8'));
  await once(xform, 'end');
  return Buffer.concat(chunks).toString('utf8');
}

test('text block buffer passes through non-text blocks and unheld stops', () => {
  const ctx = new Map();
  const rw = makeTextBlockBufferedRewriter({ key: 'pass' });
  const start = toolStart(0);
  const stop = blockStop(0);
  assert.equal(rw('content_block_start', start, ctx), start);
  assert.equal(rw('content_block_stop', stop, ctx), stop);
});

test('text block buffer replays kept text block exactly at stop', () => {
  const ctx = new Map();
  const rw = makeTextBlockBufferedRewriter({ key: 'replay' });
  const start = textStart(0);
  const d1 = textDelta(0, 'A');
  const d2 = textDelta(0, 'B');
  const stop = blockStop(0);
  assert.equal(rw('content_block_start', start, ctx), null);
  assert.equal(rw('content_block_delta', d1, ctx), null);
  assert.equal(rw('content_block_delta', d2, ctx), null);
  assert.deepEqual(rw('content_block_stop', stop, ctx), {
    events: [
      ['content_block_start', start],
      ['content_block_delta', d1],
      ['content_block_delta', d2],
      ['content_block_stop', stop],
    ],
  });
});

test('text block buffer drops a block when the strategy says drop', () => {
  const ctx = new Map();
  const rw = makeTextBlockBufferedRewriter({ key: 'drop', onStop() { return { action: 'drop' }; } });
  assert.equal(rw('content_block_start', textStart(0), ctx), null);
  assert.equal(rw('content_block_delta', textDelta(0, 'OK.'), ctx), null);
  assert.equal(rw('content_block_stop', blockStop(0), ctx), null);
});

test('text block buffer bypasses structured JSON before strategy mutation', () => {
  const ctx = new Map();
  const json = '{"continue":false,"rsn":"OK."}';
  let called = false;
  const rw = makeTextBlockBufferedRewriter({
    key: 'json-guard',
    onStop() { called = true; return { action: 'drop' }; },
  });
  const start = textStart(0);
  const delta = textDelta(0, json);
  const stop = blockStop(0);
  assert.equal(rw('content_block_start', start, ctx), null);
  assert.equal(rw('content_block_delta', delta, ctx), null);
  assert.deepEqual(rw('content_block_stop', stop, ctx), {
    events: [
      ['content_block_start', start],
      ['content_block_delta', delta],
      ['content_block_stop', stop],
    ],
  });
  assert.equal(called, false, 'strategy must not run on structured JSON');
});

test('text block buffer flushes held text before unexpected delta types', () => {
  const ctx = new Map();
  const rw = makeTextBlockBufferedRewriter({ key: 'unexpected' });
  const start = textStart(0);
  const delta = textDelta(0, 'A');
  const weird = weirdDelta(0);
  const stop = blockStop(0);
  assert.equal(rw('content_block_start', start, ctx), null);
  assert.equal(rw('content_block_delta', delta, ctx), null);
  assert.deepEqual(rw('content_block_delta', weird, ctx), {
    events: [
      ['content_block_start', start],
      ['content_block_delta', delta],
      ['content_block_delta', weird],
    ],
  });
  assert.equal(rw('content_block_stop', stop, ctx), stop);
});

test('text block buffer keeps concurrent indexes isolated', () => {
  const ctx = new Map();
  const rw = makeTextBlockBufferedRewriter({ key: 'indexes' });
  const start0 = textStart(0);
  const start1 = textStart(1);
  const delta0 = textDelta(0, 'zero');
  const delta1 = textDelta(1, 'one');
  const stop0 = blockStop(0);
  const stop1 = blockStop(1);
  assert.equal(rw('content_block_start', start0, ctx), null);
  assert.equal(rw('content_block_start', start1, ctx), null);
  assert.equal(rw('content_block_delta', delta1, ctx), null);
  assert.deepEqual(rw('content_block_stop', stop1, ctx), {
    events: [
      ['content_block_start', start1],
      ['content_block_delta', delta1],
      ['content_block_stop', stop1],
    ],
  });
  assert.equal(rw('content_block_delta', delta0, ctx), null);
  assert.deepEqual(rw('content_block_stop', stop0, ctx), {
    events: [
      ['content_block_start', start0],
      ['content_block_delta', delta0],
      ['content_block_stop', stop0],
    ],
  });
});

test('text block buffer flushes held text before message_stop', () => {
  const ctx = new Map();
  const rw = makeTextBlockBufferedRewriter({ key: 'message-stop' });
  const start = textStart(0);
  const delta = textDelta(0, 'still here');
  const messageStop = { type: 'message_stop' };
  assert.equal(rw('content_block_start', start, ctx), null);
  assert.equal(rw('content_block_delta', delta, ctx), null);
  assert.deepEqual(rw('message_stop', messageStop, ctx), {
    events: [
      ['content_block_start', start],
      ['content_block_delta', delta],
      ['message_stop', messageStop],
    ],
  });
});

test('SseTransform forwards malformed JSON without crashing buffered rewriters', async () => {
  const rw = makeTextBlockBufferedRewriter({ key: 'malformed' });
  const raw = 'event: content_block_start\ndata: {not json}\n\n';
  assert.equal(await runSse(raw, [rw]), raw);
});

test('SseTransform flushes buffered text before message_stop', async () => {
  const rw = makeTextBlockBufferedRewriter({ key: 'stream-message-stop' });
  const start = textStart(0);
  const delta = textDelta(0, 'visible');
  const messageStop = { type: 'message_stop' };
  const out = await runSse([
    event('content_block_start', start),
    event('content_block_delta', delta),
    event('message_stop', messageStop),
  ].join(''), [rw]);
  assert.equal(out, [
    event('content_block_start', start),
    event('content_block_delta', delta),
    event('message_stop', messageStop),
  ].join(''));
});
