'use strict';
/**
 * HME tool dispatcher — full-bypass of Claude Code's MCP path for HME tools.
 *
 * Architecture:
 *  - Proxy fetches tool schemas from the Python worker (/tools/list) and
 *    caches them. On every outgoing Anthropic request, the schemas are
 *    injected into payload.tools with an `HME_` prefix — Claude Code has
 *    no MCP connection to us; these tools exist only in the outgoing wire.
 *  - On the return path, if the Anthropic response contains any `HME_*`
 *    tool_use blocks, the proxy enters a continuation loop: it executes
 *    each HME tool via POST /tool/<name> on the worker, builds a new
 *    payload with [assistant_response, user(tool_results)] appended, and
 *    sends it back to Anthropic. This repeats until a response contains
 *    no more `HME_*` tool_uses. Only that final, HME-free response is
 *    forwarded to Claude Code.
 *
 * Claude Code therefore never sees HME tool_use blocks — dispatch is fully
 * internal to the proxy+worker. Native tool_use (Edit, Read, Bash) passes
 * through in the normal response flow.
 *
 * Cost: streaming is lost for any turn that uses an HME tool — the proxy
 * must buffer the response to detect HME_*. Native-only turns stream
 * unchanged (this module isn't invoked for them).
 */

const http = require('http');
const https = require('https');
const { MCP_PORT } = require('./supervisor/children');
const { emit } = require('./shared');

// ── Tool schema cache ────────────────────────────────────────────────────────
const _SCHEMA_TTL_MS = 60_000;
let _schemaCache = null;
let _schemaCachedAt = 0;

function _request(opts, body) {
  return new Promise((resolve, reject) => {
    const mod = opts.port === 443 ? https : http;
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchToolSchemas() {
  const { status, body } = await _request({
    hostname: '127.0.0.1', port: MCP_PORT, path: '/tools/list', method: 'GET',
    timeout: 3000,
  });
  if (status !== 200) throw new Error(`worker /tools/list returned ${status}`);
  const json = JSON.parse(body.toString('utf8'));
  const tools = json.tools || [];
  return tools.map((t) => ({
    name: `HME_${t.name}`,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

async function getSchemasCached() {
  const now = Date.now();
  if (_schemaCache && now - _schemaCachedAt < _SCHEMA_TTL_MS) return _schemaCache;
  try {
    _schemaCache = await fetchToolSchemas();
    _schemaCachedAt = now;
    return _schemaCache;
  } catch (err) {
    console.error(`[hme-dispatcher] schema fetch failed: ${err.message}`);
    return _schemaCache || []; // stale-while-erroring
  }
}

// ── Tool invocation ──────────────────────────────────────────────────────────
async function executeHmeTool(name, input, timeoutMs = 120_000) {
  const toolName = name.replace(/^HME_/, '');
  const body = Buffer.from(JSON.stringify(input || {}), 'utf8');
  const startedAt = Date.now();
  try {
    const { status, body: resBody } = await _request({
      hostname: '127.0.0.1', port: MCP_PORT, path: `/tool/${encodeURIComponent(toolName)}`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length },
      timeout: timeoutMs,
    }, body);
    const json = JSON.parse(resBody.toString('utf8'));
    if (json && json.ok === true) {
      const result = String(json.result ?? '');
      // Record output size for context-efficiency audits. Mode is the most
      // useful dimension for aggregation when present (status/review/trace).
      const mode = (input && typeof input.mode === 'string') ? input.mode : '';
      emit({
        event: 'hme_tool_result',
        tool: toolName,
        mode,
        bytes: result.length,
        elapsed_ms: Date.now() - startedAt,
      });
      return result;
    }
    const err = (json && json.error) || `worker returned status ${status}`;
    return `[HME tool error: ${err}]`;
  } catch (err) {
    return `[HME transport error: ${err.message}]`;
  }
}

// ── SSE parsing ──────────────────────────────────────────────────────────────
// Reconstructs a fully-assembled assistant message from a buffered SSE stream.
// Returns { contentBlocks, usage, stopReason, raw }.
function parseSseResponse(bufferStr) {
  const events = [];
  for (const raw of bufferStr.split(/\r?\n\r?\n/)) {
    if (!raw.trim()) continue;
    let eventName = '';
    const dataLines = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    try {
      const data = JSON.parse(dataLines.join('\n'));
      events.push({ eventName, data });
    } catch (_e) { /* skip malformed */ }
  }

  const blocksByIndex = new Map();
  let usage = null;
  let stopReason = null;
  for (const { eventName, data } of events) {
    if (eventName === 'content_block_start') {
      const cb = data.content_block || {};
      blocksByIndex.set(data.index, {
        type: cb.type,
        id: cb.id,
        name: cb.name,
        text: '',
        inputPartial: '',
      });
    } else if (eventName === 'content_block_delta') {
      const b = blocksByIndex.get(data.index);
      if (!b || !data.delta) continue;
      if (data.delta.type === 'text_delta' && typeof data.delta.text === 'string') {
        b.text += data.delta.text;
      } else if (data.delta.type === 'input_json_delta' && typeof data.delta.partial_json === 'string') {
        b.inputPartial += data.delta.partial_json;
      }
    } else if (eventName === 'message_delta' && data.delta) {
      if (data.delta.stop_reason) stopReason = data.delta.stop_reason;
      if (data.usage) usage = data.usage;
    }
  }

  // Normalize into Anthropic content blocks
  const contentBlocks = [];
  const sortedIndexes = [...blocksByIndex.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndexes) {
    const b = blocksByIndex.get(idx);
    if (b.type === 'text') {
      contentBlocks.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use') {
      let input = {};
      if (b.inputPartial) {
        try { input = JSON.parse(b.inputPartial); } catch (_e) { /* leave empty */ }
      }
      contentBlocks.push({ type: 'tool_use', id: b.id, name: b.name, input });
    }
  }
  return { contentBlocks, usage, stopReason };
}

// ── Continuation loop ────────────────────────────────────────────────────────
function _collectHmeToolUses(contentBlocks) {
  return contentBlocks.filter((b) => b.type === 'tool_use' && typeof b.name === 'string' && b.name.startsWith('HME_'));
}

async function _callAnthropic(payload, upstreamOpts) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers = { ...upstreamOpts.headers };
  headers['content-length'] = String(body.length);
  // Force non-streaming since we're going to buffer anyway during continuation.
  // Anthropic's /v1/messages supports stream:false.
  return new Promise((resolve, reject) => {
    const mod = upstreamOpts.tls ? https : http;
    const req = mod.request({
      hostname: upstreamOpts.host,
      port: upstreamOpts.port,
      path: upstreamOpts.path,
      method: upstreamOpts.method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(600_000, () => req.destroy(new Error('anthropic continuation timeout')));
    req.write(body);
    req.end();
  });
}

/**
 * If the initial Anthropic response contains HME_* tool_uses, dispatch them,
 * continue the conversation until no HME_* remain, and return the final
 * (buffered) response bytes for forwarding to Claude Code.
 *
 * Returns:
 *   { finalBody, finalHeaders, finalStatus, loops }
 *   or null if no HME_* tool_uses were present (caller should forward the
 *   original response unchanged).
 *
 * Params:
 *   initialResponseBuf — Buffer of the first response body (SSE or JSON)
 *   initialHeaders, initialStatus — from the first response
 *   originalPayload — the request payload we just sent (messages so far)
 *   upstreamOpts — {host, port, tls, path, method, headers} for continuation
 *   isStreaming — whether the original request had stream:true (affects parsing)
 */
async function maybeHandleHme(initialResponseBuf, initialHeaders, initialStatus,
                               originalPayload, upstreamOpts, isStreaming) {
  const parseFn = isStreaming ? parseSseResponse : parseJsonResponse;
  let parsed = parseFn(initialResponseBuf.toString('utf8'));
  let hmeUses = _collectHmeToolUses(parsed.contentBlocks);
  if (hmeUses.length === 0) return null;

  let currentPayload = JSON.parse(JSON.stringify(originalPayload));
  let loops = 0;
  let lastResponse = null;

  while (hmeUses.length > 0 && loops < 8) {
    loops++;
    // Dispatch all HME tools in parallel
    const results = await Promise.all(hmeUses.map(async (tu) => {
      const result = await executeHmeTool(tu.name, tu.input);
      return { id: tu.id, result };
    }));
    emit({ event: 'hme_continuation', loop: loops, tools: hmeUses.map((t) => t.name).join('|') });

    // Append the assistant message (from parsed) + a user message with tool_results
    const assistantMsg = { role: 'assistant', content: parsed.contentBlocks };
    const userMsg = {
      role: 'user',
      content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.result })),
    };
    currentPayload.messages = [...currentPayload.messages, assistantMsg, userMsg];

    // Ensure stream:false for continuation; we buffer and re-parse.
    currentPayload.stream = false;

    lastResponse = await _callAnthropic(currentPayload, upstreamOpts);
    if (lastResponse.status < 200 || lastResponse.status >= 300) {
      // Propagate the error upstream — return what we got.
      return {
        finalBody: lastResponse.body,
        finalHeaders: lastResponse.headers,
        finalStatus: lastResponse.status,
        loops,
      };
    }

    parsed = parseJsonResponse(lastResponse.body.toString('utf8'));
    hmeUses = _collectHmeToolUses(parsed.contentBlocks);
  }

  if (!lastResponse) {
    // Shouldn't happen, but guard
    return null;
  }
  return {
    finalBody: lastResponse.body,
    finalHeaders: lastResponse.headers,
    finalStatus: lastResponse.status,
    loops,
  };
}

function parseJsonResponse(text) {
  try {
    const d = JSON.parse(text);
    const contentBlocks = Array.isArray(d.content) ? d.content : [];
    return { contentBlocks, usage: d.usage, stopReason: d.stop_reason };
  } catch (_e) {
    return { contentBlocks: [], usage: null, stopReason: null };
  }
}

module.exports = {
  getSchemasCached,
  executeHmeTool,
  parseSseResponse,
  parseJsonResponse,
  maybeHandleHme,
};
