'use strict';

const http = require('http');
const https = require('https');
const { collectToolCalls, collectSseToolCalls, parseSseEvents, executeToolCall, followupBody, toolOutputIsError } = require('./codex_tool_loop');

function safeJson(value) { try { return JSON.parse(value || '{}'); } catch (_e) { return {}; } }

function upstreamHeaders(req, bodyBytes, target) {
  const headers = { ...req.headers };
  for (const key of ['host', 'content-length', 'connection', 'transfer-encoding', 'trailer', 'upgrade']) delete headers[key];
  if (target.kind === 'omniroute') {
    delete headers.authorization;
    delete headers['x-api-key'];
    headers['x-hme-codex-proxy'] = '1';
    if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;
  }
  headers['content-length'] = String(bodyBytes.length);
  return headers;
}

function responseUsage(parsed) {
  const usage = parsed && typeof parsed === 'object' ? parsed.usage : null;
  if (!usage || typeof usage !== 'object') return {};
  return {
    tokens_in: Number(usage.input_tokens || usage.prompt_tokens || 0),
    tokens_out: Number(usage.output_tokens || usage.completion_tokens || 0),
  };
}

function contentText(value) {
  const chunks = [];
  function visit(v) {
    if (v == null) return;
    if (typeof v === 'string') { chunks.push(v); return; }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const item of v) visit(item); return; }
    const type = String(v.type || '');
    if (type === 'function_call' || type === 'function_call_output') return;
    if (typeof v.text === 'string') chunks.push(v.text);
    if (typeof v.output_text === 'string') chunks.push(v.output_text);
    if (typeof v.content === 'string') chunks.push(v.content);
    else if (Array.isArray(v.content)) visit(v.content);
    if (/reasoning_summary|summary_text/.test(type)) {
      if (typeof v.summary === 'string') chunks.push(v.summary);
      else if (Array.isArray(v.summary)) visit(v.summary);
    }
  }
  visit(value);
  return chunks.join('');
}

function outputItemText(item) {
  if (!item || typeof item !== 'object') return '';
  const type = String(item.type || '');
  if (type === 'function_call' || type === 'function_call_output') return '';
  if (type === 'message') {
    if (item.role && item.role !== 'assistant') return '';
    return contentText(item.content || item.text || '');
  }
  if (type === 'output_text' || type === 'text' || /reasoning_summary|summary_text/.test(type)) return contentText(item);
  if (item.role === 'assistant') return contentText(item.content || item.text || '');
  if (item.content || item.text || item.output_text) return contentText(item);
  return '';
}

function choiceText(choice) {
  if (!choice || typeof choice !== 'object') return '';
  const chunks = [];
  const push = (text) => { if (typeof text === 'string' && text.length) chunks.push(text); };
  if (choice.message) push(outputItemText({ type: 'message', role: choice.message.role || 'assistant', content: choice.message.content || choice.message.text || '' }));
  if (choice.delta) push(contentText(choice.delta.content || choice.delta.text || ''));
  if (typeof choice.text === 'string') push(choice.text);
  return chunks.join('');
}

function finalOutputText(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  const chunks = [];
  const push = (text) => { if (typeof text === 'string' && text.trim()) chunks.push(text); };
  const roots = [parsed];
  if (parsed.response && typeof parsed.response === 'object') roots.push(parsed.response);
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    if (Array.isArray(root.output)) for (const item of root.output) push(outputItemText(item));
    if (Array.isArray(root.choices)) for (const choice of root.choices) push(choiceText(choice));
    if (root.message) push(outputItemText({ type: 'message', role: root.message.role || 'assistant', content: root.message.content || root.message.text || '' }));
    if (root.role === 'assistant') push(contentText(root.content || root.text || ''));
    if (typeof root.output_text === 'string') push(root.output_text);
    if (root.error && typeof root.error.message === 'string') push(`Upstream error: ${root.error.message}`);
  }
  return chunks.join('\n');
}

function sseResponseId(events) {
  for (const event of [...events].reverse()) {
    if (event && event.response && event.response.id) return event.response.id;
    if (event && event.item && event.item.response_id) return event.item.response_id;
    if (event && event.id && String(event.type || '').startsWith('response.')) return event.id;
  }
  return '';
}

function sseFinalResponse(events) {
  const completed = [...events].reverse().find((event) => event && event.response && Array.isArray(event.response.output) && event.response.output.length);
  if (completed) return { ...completed.response, _sse_events: events };
  const output = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const type = String(event.type || '');
    if (type === 'response.output_item.done' && event.item) output.push(event.item);
  }
  return { id: sseResponseId(events), output, _sse_events: events };
}

function createCodexResponseForwarder(deps) {
  const { record, projectRoot, upstreamUrl } = deps;

  return function forwardResponses(req, res, targets, source, visibility) {
    const started = Date.now();
    let finished = false;
    const correlationId = [source && source.session_id, source && source.turn_id, started.toString(36), Math.random().toString(36).slice(2, 8)].filter(Boolean).join(':');

    function attachTrace(target) {
      return {
        ...(target || {}),
        hme_correlation_id: correlationId,
        hme_session_id: source && source.session_id || '',
        hme_thread_id: source && source.thread_id || '',
        hme_turn_id: source && source.turn_id || '',
      };
    }

    function traceFields(target, extra = {}) {
      return {
        correlation_id: correlationId,
        session_id: source && source.session_id || '',
        thread_id: source && source.thread_id || '',
        turn_id: source && source.turn_id || '',
        tool_loop_depth: target && target.tool_loop_depth || 0,
        ...extra,
      };
    }

    function finishResponse(target, status, errorSummary = '', parsed = null) {
      if (finished) return;
      finished = true;
      record({
        kind: 'response', route: target.kind, upstream: target.url, status,
        ...traceFields(target, { upstream_response_id: parsed && (parsed.id || parsed.response_id || parsed.response?.id) || '' }),
        duration_ms: Date.now() - started, error_summary: errorSummary,
        ...responseUsage(parsed),
        model: target.body && target.body.model ? target.body.model : visibility.model,
      });
    }

    function continueAfterTools(index, target, parsed, calls) {
      if (!calls.length) return false;
      const depth = target.tool_loop_depth || 0;
      const results = [];
      for (const call of calls) {
        const result = executeToolCall(call, { projectRoot, sessionId: source.session_id || '' });
        results.push(result);
      }
      record({ kind: 'codex-proxy-tool-loop', route: target.kind, depth: depth + 1, calls: results.map((r) => ({ call_id: r.call_id, is_error: toolOutputIsError(r) })), ...traceFields(target, { call_ids: results.map((r) => r.call_id).filter(Boolean) }) });
      const nextBody = followupBody(target.body, parsed, results, parsed && parsed._sse_events || []);
      attemptTarget(index, { ...target, body: nextBody, tool_loop_depth: depth + 1 });
      return true;
    }

    function sendJsonFinal(target, status, headers, full) {
      const parsed = safeJson(full);
      const calls = collectToolCalls(parsed);
      if (calls.length && continueAfterTools(target.index, target, parsed, calls)) return;
      res.writeHead(status, headers);
      res.end(full);
      finishResponse(target, status, '', parsed);
    }

    function sendSseFinal(target, status, headers, full) {
      const events = parseSseEvents(full);
      const calls = collectSseToolCalls(full);
      const parsed = sseFinalResponse(events);
      if (calls.length && continueAfterTools(target.index, target, parsed, calls)) return;
      res.writeHead(status, headers);
      res.end(full);
      finishResponse(target, status, '', parsed);
    }

    function attemptTarget(index, overrideTarget = null) {
      const target = attachTrace({ ...(overrideTarget || targets[index]), index });
      const bodyBytes = Buffer.from(JSON.stringify(target.body));
      const upstream = new URL(target.url);
      const client = upstream.protocol === 'http:' ? http : https;
      const options = {
        method: 'POST', hostname: upstream.hostname,
        port: upstream.port || (upstream.protocol === 'http:' ? 80 : 443),
        path: `${upstream.pathname}${upstream.search}`,
        headers: upstreamHeaders(req, bodyBytes, target),
      };
      const upstreamReq = client.request(options, (upstreamRes) => {
        const status = upstreamRes.statusCode || 502;
        if (target.fallbackDirect && target.fallbackHttpStatuses && target.fallbackHttpStatuses.has(status) && targets[index + 1]) {
          const chunks = [];
          upstreamRes.on('data', (chunk) => chunks.push(chunk));
          upstreamRes.on('end', () => { record({ kind: 'upstream-http-fallback', route: target.kind, upstream: target.url, status, body_preview: Buffer.concat(chunks).toString('utf8').slice(0, 500), ...traceFields(target) }); attemptTarget(index + 1); });
          return;
        }
        const headers = { ...upstreamRes.headers };
        delete headers['content-length'];
        const chunks = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          const full = Buffer.concat(chunks).toString('utf8');
          if (String(upstreamRes.headers['content-type'] || '').includes('text/event-stream')) sendSseFinal(target, status, headers, full);
          else sendJsonFinal(target, status, headers, full);
        });
      });
      upstreamReq.on('error', (err) => {
        record({ kind: 'upstream-error', route: target.kind, upstream: target.url, message: err.message, ...traceFields(target) });
        if (target.fallbackDirect && targets[index + 1] && !res.headersSent) return attemptTarget(index + 1);
        finishResponse(target, 502, err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'codex_proxy_upstream_error', message: err.message, upstream: upstreamUrl }));
        } else res.end();
      });
      upstreamReq.write(bodyBytes);
      upstreamReq.end();
    }

    attemptTarget(0);
  };
}

module.exports = { createCodexResponseForwarder, finalOutputText, contentText };
