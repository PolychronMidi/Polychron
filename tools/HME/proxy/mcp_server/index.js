'use strict';
/**
 * MCP server — proxy-native implementation of the Model Context Protocol.
 *
 * Serves two endpoints to Claude Code at /mcp/*:
 *   GET  /mcp/sse                       → open long-lived SSE stream. First
 *                                          event is `endpoint` pointing at the
 *                                          /messages URL + session_id.
 *   POST /mcp/messages?session_id=<id>  → JSON-RPC request. Response is
 *                                          delivered as an SSE event on the
 *                                          matching stream.
 *
 * JSON-RPC methods handled:
 *   initialize                  — capabilities handshake
 *   notifications/initialized   — ack (no response)
 *   tools/list                  — dispatcher.listTools()
 *   tools/call                  — dispatcher.callTool()
 *   resources/list, prompts/list— return empty arrays
 *   ping                        — pong
 *
 * Any other method returns a JSON-RPC MethodNotFound error.
 *
 * Tool dispatch is forwarded to the Python worker via HTTP.
 */

const { sseEvent, jsonrpcResult, jsonrpcError, initializeResult } = require('./protocol');
const session = require('./session');
const dispatcher = require('./dispatcher');

const logger = {
  info: (...a) => console.log('[mcp-server]', ...a),
  warn: (...a) => console.warn('[mcp-server]', ...a),
  error: (...a) => console.error('[mcp-server]', ...a),
};

function _parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(null);
      try { resolve(JSON.parse(text)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function _sseHeaders(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
}

function handleSseOpen(req, res) {
  _sseHeaders(res);
  const id = session.createSession(res);
  // Tell the client where to POST messages. Claude Code uses this URL.
  res.write(sseEvent('endpoint', `/mcp/messages?session_id=${id}`));
  // Keepalive: periodic ping comment every 20s.
  const keep = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_e) { clearInterval(keep); }
  }, 20_000);
  res.on('close', () => clearInterval(keep));
  logger.info(`SSE opened, session=${id}`);
}

async function _handleRpc(sessionId, msg) {
  const id = msg.id;
  const method = msg.method;
  try {
    if (method === 'initialize') {
      // Re-initialize on the same session is idempotent but worth flagging.
      const sess = session.get(sessionId);
      if (sess && sess.initialized) {
        logger.warn(`initialize called twice on session=${sessionId} — returning current capabilities`);
      } else {
        session.markInitialized(sessionId);
      }
      return jsonrpcResult(id, initializeResult());
    }
    if (method === 'notifications/initialized' || method && method.startsWith('notifications/')) {
      return null; // notifications carry no id and expect no response
    }
    if (method === 'ping') {
      return jsonrpcResult(id, {});
    }
    if (method === 'tools/list') {
      const tools = await dispatcher.listTools();
      return jsonrpcResult(id, { tools });
    }
    if (method === 'tools/call') {
      const { name, arguments: args } = msg.params || {};
      if (!name) return jsonrpcError(id, -32602, 'tools/call: missing params.name');
      const { CHILDREN } = require('../supervisor/children');
      const timeoutMs = (CHILDREN.find((c) => c.name === 'worker') || {}).callTimeoutMs || 90_000;
      const t0 = Date.now();
      let result;
      try {
        result = await dispatcher.callTool(name, args || {}, timeoutMs);
      } catch (err) {
        const elapsed = Date.now() - t0;
        if (/timeout/i.test(err.message) && elapsed >= timeoutMs - 500) {
          // Hang detected: worker didn't respond within the declared window.
          // Signal supervisor + emit activity so the incident is visible in the
          // activity bus and operator can see the correlation.
          try {
            const { killChild } = require('../supervisor/index');
            const { emit } = require('../shared');
            emit({ event: 'mcp_hang_kill', tool: name, elapsed_ms: elapsed });
            killChild('worker', 'SIGKILL');
            logger.error(`tools/call '${name}' hung > ${timeoutMs}ms — killed worker (supervisor will restart)`);
          } catch (kerr) {
            logger.error(`hang-kill failed: ${kerr.message}`);
          }
          return jsonrpcError(id, -32000, `Tool '${name}' timed out after ${timeoutMs}ms — worker restarting, retry shortly`);
        }
        throw err;
      }
      return jsonrpcResult(id, result);
    }
    if (method === 'resources/list') return jsonrpcResult(id, { resources: [] });
    if (method === 'prompts/list')   return jsonrpcResult(id, { prompts: [] });
    return jsonrpcError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    logger.error(`RPC ${method} failed: ${err.message}`);
    return jsonrpcError(id, -32603, `Internal error: ${err.message}`);
  }
}

async function handleMessagesPost(req, res, sessionId) {
  let msg;
  try {
    msg = await _parseBody(req);
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad JSON body' }));
    return;
  }
  if (!msg || (typeof msg !== 'object' && !Array.isArray(msg))) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'empty body' }));
    return;
  }
  const sess = session.get(sessionId);
  if (!sess) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown session' }));
    return;
  }
  // Claude Code expects 202 Accepted; the actual response goes over SSE.
  res.writeHead(202, { 'content-type': 'application/json' });
  res.end('{"accepted":true}');

  // JSON-RPC 2.0 supports batch requests: array of requests → array of
  // responses. Dispatch each in parallel, filter out notification nulls.
  if (Array.isArray(msg)) {
    if (msg.length === 0) {
      session.send(sessionId, jsonrpcError(null, -32600, 'empty batch'));
      return;
    }
    const responses = (await Promise.all(msg.map((m) => _handleRpc(sessionId, m)))).filter((r) => r !== null);
    if (responses.length > 0) session.send(sessionId, responses);
    return;
  }

  const response = await _handleRpc(sessionId, msg);
  if (response !== null) session.send(sessionId, response);
}

function handleMcpRequest(req, res) {
  // Normalize path: strip /mcp prefix, strip query string.
  const [rawPath, query = ''] = (req.url || '').split('?');
  const path = rawPath.replace(/^\/mcp/, '') || '/';

  if (req.method === 'GET' && (path === '/sse' || path === '/')) {
    handleSseOpen(req, res);
    return;
  }
  if (req.method === 'POST' && (path === '/messages' || path === '/messages/')) {
    const params = new URLSearchParams(query);
    const sid = params.get('session_id');
    if (!sid) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'session_id query param required' }));
      return;
    }
    handleMessagesPost(req, res, sid);
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sessions: session.stats(), mcp: 'proxy-native' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: `no MCP route: ${req.method} ${path}` }));
}

module.exports = { handleMcpRequest, session, dispatcher };
