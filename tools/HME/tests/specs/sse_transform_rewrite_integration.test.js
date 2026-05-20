'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

function purgeProxyModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/tools/HME/proxy/session_read_cache')
      || key.includes('/tools/HME/proxy/sse_rewriters')
      || key.includes('/tools/HME/proxy/sse_slop_rewriter')
      || key.includes('/tools/HME/proxy/sse_edit_read_rewriter')
      || key.includes('/tools/HME/proxy/sse_stop_hook_rewriters')
      || key.includes('/tools/HME/proxy/sse_transform')
      || key.includes('/tools/HME/proxy/hme_proxy_response_send')) delete require.cache[key];
  }
}

async function runSse(raw, rewriters, sessionId = '') {
  const { SseTransform } = require('../../proxy/sse_transform');
  const xform = new SseTransform({ rewriters });
  if (sessionId) xform._ctx.set('session_id', sessionId);
  const chunks = [];
  xform.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  xform.end(Buffer.from(raw, 'utf8'));
  await once(xform, 'end');
  return Buffer.concat(chunks).toString('utf8');
}

function event(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseSse(text) {
  return text.trim().split(/\n\n+/).filter(Boolean).map((raw) => {
    const lines = raw.split('\n');
    const name = lines.find((line) => line.startsWith('event:')).slice(6).trim();
    const body = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    return [name, JSON.parse(body)];
  });
}

test('SseTransform rewrites unread Update tool_use to Read before Claude CLI sees it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-sse-rewrite-'));
  try {
    process.env.HME_SESSION_READ_CACHE_DIR = dir;
    purgeProxyModules();
    const { editFallbackToReadRewrite, readInputNormalizeRewrite } = require('../../proxy/sse_rewriters');
    const input = { file_path: '/abs/unread.js', old_string: 'a', new_string: 'b' };
    const raw = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_update', name: 'Update', input: {} } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }),
      event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    ].join('');
    const out = parseSse(await runSse(raw, [editFallbackToReadRewrite, readInputNormalizeRewrite], 'sse-unread'));
    assert.equal(out[0][1].content_block.name, 'Read');
    assert.deepEqual(JSON.parse(out[1][1].delta.partial_json), { file_path: '/abs/unread.js', limit: 50 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SseTransform applies caveman compression to provider reasoning converted to thinking', async () => {
  purgeProxyModules();
  const { providerReasoningToThinkingRewrite } = require('../../proxy/reasoning_to_thinking');
  const { slopStripRewrite } = require('../../proxy/sse_rewriters');
  const raw = [
    event('response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', delta: { text: 'I am now checking the path.' } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
  ].join('');
  const out = parseSse(await runSse(raw, [providerReasoningToThinkingRewrite, slopStripRewrite]));
  assert.equal(out[0][1].content_block.type, 'thinking');
  assert.equal(out[1][1].delta.type, 'thinking_delta');
  assert.equal(out[1][1].delta.thinking, 'Checking path.');
});

test('SseTransform applies full slop stripping to normal assistant text without deny context', async () => {
  purgeProxyModules();
  const { slopStripRewrite } = require('../../proxy/sse_rewriters');
  const raw = [
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Acknowledged. I will fix and test.' } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
  ].join('');
  const out = parseSse(await runSse(raw, [slopStripRewrite]));
  assert.equal(out[1][1].delta.text, 'K. Fix & test.');
});

test('sendFinalResponse rewrites non-SSE unread Update to Read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-nonsse-rewrite-'));
  try {
    process.env.HME_SESSION_READ_CACHE_DIR = dir;
    purgeProxyModules();
    const { sendFinalResponse } = require('../../proxy/hme_proxy_response_send');
    const payload = { messages: [{ role: 'user', content: 'edit file' }] };
    const body = {
      type: 'message',
      content: [{ type: 'tool_use', id: 'toolu_update', name: 'Update', input: { file_path: '/abs/non-sse.js', old_string: 'a', new_string: 'b' } }],
    };
    let ended = null;
    const clientRes = {
      writeHead() {},
      end(buf) { ended = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf); },
    };
    sendFinalResponse({ clientRes, payload, final: true, outStatus: 200, outHeaders: { 'content-type': 'application/json' }, outBuf: Buffer.from(JSON.stringify(body), 'utf8') });
    const parsed = JSON.parse(ended);
    assert.equal(parsed.content[0].name, 'Read');
    assert.deepEqual(parsed.content[0].input, { file_path: '/abs/non-sse.js', limit: 50 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
