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
      const result = await dispatcher.callTool(name, args || {});
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
  if (!msg || typeof msg !== 'object') {
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
