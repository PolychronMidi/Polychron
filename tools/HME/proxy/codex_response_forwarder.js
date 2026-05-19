'use strict';

const http = require('http');
const https = require('https');
const { rewriteCodexResponseObject } = require('./codex_native_tools');
const { responseHasContextLoss, appendContextLossRepair, appendToolSchemaRepair, appendToolUseEnforcement, contextLossFallbackResponse } = require('./codex_context_loss_guard');
const { collectToolCalls, collectSseToolCalls, parseSseEvents, toolResultInput, followupBody, isIncompleteToolCall, missingRequiredToolFields } = require('./codex_tool_loop');

const MAX_TOOL_LOOP_DEPTH = 8;

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

function responseToolChoice(body) {
  if (!body || typeof body !== 'object') return undefined;
  return body.tool_choice ?? body.toolChoice;
}

function isForcedToolChoice(choice) {
  if (!choice) return false;
  if (typeof choice === 'string') return !['none', 'auto'].includes(choice);
  if (typeof choice !== 'object') return false;
  const type = String(choice.type || choice.name || choice.mode || '');
  return type && !['none', 'auto'].includes(type);
}

function bodyHasTools(body) {
  return Boolean(body && Array.isArray(body.tools) && body.tools.length);
}

function finalOutputText(parsed) {
  const chunks = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (typeof value.text === 'string') chunks.push(value.text);
    if (typeof value.content === 'string') chunks.push(value.content);
    for (const child of Object.values(value)) visit(child);
  }
  visit(parsed && parsed.output);
  return chunks.join('\n');
}

function responseAvoidedToolUse(parsed) {
  const text = finalOutputText(parsed);
  if (!text.trim()) return false;
  return /\b(?:please\s+send\s+(?:the\s+)?(?:next\s+)?(?:objective|task)|specific task you want me to continue|avoid repeating the same discovery\/listing calls|avoid repeating .* calls|reuse the recovered repository context|if there(?:'s| is) no specific task)\b/i.test(text);
}

function sseResponseId(events) {
  for (const event of [...events].reverse()) {
    if (event && event.response && event.response.id) return event.response.id;
    if (event && event.item && event.item.response_id) return event.item.response_id;
    if (event && event.id && String(event.type || '').startsWith('response.')) return event.id;
  }
  return '';
}

function sseTextKey(event) {
  const item = event && (event.item_id || event.id || event.call_id || '');
  const output = event && event.output_index != null ? `output:${event.output_index}` : '';
  const content = event && event.content_index != null ? `content:${event.content_index}` : '';
  return [item, output, content].filter(Boolean).join(':') || 'output:0:content:0';
}

function sseFinalResponse(events) {
  const completed = [...events].reverse().find((event) => event && event.response && Array.isArray(event.response.output) && event.response.output.length);
  if (completed) return { ...completed.response, _sse_events: events };

  const outputByKey = new Map();
  const outputOrder = [];
  const textByKey = new Map();
  const textOrder = [];

  function rememberOutput(item, fallbackKey = '') {
    if (!item || typeof item !== 'object') return;
    const key = String(item.id || item.call_id || item.item_id || fallbackKey || `output:${outputOrder.length}`);
    if (!outputByKey.has(key)) outputOrder.push(key);
    outputByKey.set(key, item);
  }

  function rememberText(event, text, append = false) {
    if (typeof text !== 'string' || text.length === 0) return;
    const key = sseTextKey(event);
    if (!textByKey.has(key)) textOrder.push(key);
    textByKey.set(key, append ? `${textByKey.get(key) || ''}${text}` : text);
  }

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const type = String(event.type || '');
    if (event.item && event.item.type === 'message') rememberOutput(event.item, event.item_id || event.output_index);
    if (type === 'response.output_item.done' && event.item) rememberOutput(event.item, event.item_id || event.output_index);
    if (/output_text\.delta$/.test(type)) rememberText(event, String(event.delta || ''), true);
    else if (/output_text\.done$/.test(type)) rememberText(event, String(event.text || event.delta || ''), false);
    else if (type === 'response.content_part.done' && event.part && typeof event.part.text === 'string') rememberText(event, event.part.text, false);
  }

  const output = outputOrder.map((key) => outputByKey.get(key)).filter(Boolean);
  const streamedText = textOrder.map((key) => textByKey.get(key)).filter(Boolean).join('\n');
  if (streamedText && !finalOutputText({ output }).trim()) {
    output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: streamedText }] });
  }

  return { id: sseResponseId(events), output, _sse_events: events };
}

function createCodexResponseForwarder(deps) {
  const { record, planScanner, projectRoot, upstreamUrl } = deps;

  return function forwardResponses(req, res, targets, source, visibility) {
    const started = Date.now();
    let finished = false;

    function finishResponse(target, status, errorSummary = '', parsed = null) {
      if (finished) return;
      finished = true;
      record({
        kind: 'response', route: target.kind, upstream: target.url, status,
        duration_ms: Date.now() - started, error_summary: errorSummary,
        ...responseUsage(parsed),
        model: target.body && target.body.model ? target.body.model : visibility.model,
      });
    }

    function droppedIncompleteCalls(calls, target) {
      const depth = target.tool_loop_depth || 0;
      const dropped = calls.map((call) => ({ call_id: call.id, name: call.name, missing: missingRequiredToolFields(call) }));
      record({ kind: 'codex-incomplete-tool-call-dropped', route: target.kind, depth, calls: dropped });
      return dropped;
    }

    function continueAfterTools(index, target, parsed, calls, forcedResults = null) {
      const depth = target.tool_loop_depth || 0;
      if (!calls.length && !forcedResults) return false;
      if (depth >= MAX_TOOL_LOOP_DEPTH) return false;
      const actionableCalls = forcedResults ? calls : calls.filter((call) => !isIncompleteToolCall(call));
      const skipped = forcedResults ? [] : calls.filter((call) => isIncompleteToolCall(call));
      if (!forcedResults && skipped.length) droppedIncompleteCalls(skipped, target);
      if (!forcedResults && !actionableCalls.length) return false;
      const results = forcedResults || toolResultInput(actionableCalls, { projectRoot, sessionId: source.session_id || '' });
      record({ kind: 'codex-proxy-tool-loop', route: target.kind, depth: depth + 1, calls: results.map((r) => ({ call_id: r.call_id, is_error: r.is_error })) });
      const nextBody = followupBody(target.body, parsed, results, parsed && parsed._sse_events || []);
      attemptTarget(index, { ...target, body: nextBody, tool_loop_depth: depth + 1 });
      return true;
    }

    function retryAfterIncompleteOnly(index, target, parsed, calls) {
      const depth = target.tool_loop_depth || 0;
      if (!calls.length || calls.some((call) => !isIncompleteToolCall(call))) return false;
      if (depth >= MAX_TOOL_LOOP_DEPTH) return false;
      const dropped = droppedIncompleteCalls(calls, target);
      record({ kind: 'codex-incomplete-tool-call-repair', route: target.kind, depth, calls: dropped });
      const repairedBody = appendToolSchemaRepair(target.body, dropped);
      attemptTarget(index, { ...target, body: repairedBody, tool_loop_depth: depth + 1 });
      return true;
    }

    function toolLoopLimit(target, parsed = null) {
      res.writeHead(508, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'codex_proxy_tool_loop_limit', message: 'Tool loop limit reached before a final assistant response.' }));
      finishResponse(target, 508, 'tool loop limit', parsed);
    }

    function retryAfterContextLoss(target, status, headers, parsed, avoidedToolUse) {
      const reason = avoidedToolUse ? 'assistant avoided available tools despite existing objective' : 'empty command tool result treated as task context';
      record({ kind: 'codex-context-loss-blocked', route: target.kind, depth: target.tool_loop_depth || 0, reason });
      const repairedBody = avoidedToolUse ? appendToolUseEnforcement(target.body, reason) : appendContextLossRepair(target.body);
      const repairText = repairedBody.input?.at?.(-1)?.content?.[0]?.text || 'HME context-loss repair: continue from the latest user request/session objective.';
      const repairResult = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: repairText }] }];
      if (continueAfterTools(target.index, { ...target, body: repairedBody }, parsed || {}, [], repairResult)) return true;
      const fallback = contextLossFallbackResponse(parsed);
      res.writeHead(status, { ...headers, 'content-type': 'application/json' });
      res.end(JSON.stringify(fallback));
      finishResponse(target, status, 'context loss blocked', fallback);
      return true;
    }

    function sendJsonFinal(target, status, headers, full) {
      const parsed = safeJson(full);
      const calls = collectToolCalls(parsed);
      if (calls.length) {
        if (retryAfterIncompleteOnly(target.index, target, parsed, calls)) return;
        if (continueAfterTools(target.index, target, parsed, calls)) return;
        if (calls.some((call) => !isIncompleteToolCall(call))) return toolLoopLimit(target, parsed);
      }
      const rewritten = parsed && typeof parsed === 'object' ? rewriteCodexResponseObject(parsed) : null;
      if (rewritten && rewritten.stats.unknown_calls) record({ kind: 'codex-unknown-tool-call', route: target.kind, count: rewritten.stats.unknown_calls, names: rewritten.stats.unknown_names || [] });
      const finalParsed = rewritten ? rewritten.body : parsed;
      const forcedToolChoice = isForcedToolChoice(responseToolChoice(target.body));
      const avoidedToolUse = bodyHasTools(target.body) && !forcedToolChoice && responseAvoidedToolUse(finalParsed || parsed);
      if (responseHasContextLoss(finalParsed || full) || avoidedToolUse) {
        if (retryAfterContextLoss(target, status, headers, finalParsed || parsed, avoidedToolUse)) return;
      }
      const finalBody = rewritten && rewritten.stats.calls ? JSON.stringify(rewritten.body) : full;
      if (finalParsed && typeof finalParsed === 'object') planScanner.scanObjectForPlan(finalParsed, source);
      res.writeHead(status, headers);
      res.end(finalBody);
      finishResponse(target, status, '', finalParsed);
    }

    function sendSseFinal(target, status, headers, full) {
      const events = parseSseEvents(full);
      const calls = collectSseToolCalls(full);
      const parsed = { _sse_events: events };
      if (calls.length) {
        if (retryAfterIncompleteOnly(target.index, target, parsed, calls)) return;
        if (continueAfterTools(target.index, target, parsed, calls)) return;
        if (calls.some((call) => !isIncompleteToolCall(call))) return toolLoopLimit(target);
      }
      const scanner = planScanner.createSseScanner(source);
      scanner.feed(Buffer.from(full));
      scanner.finish();
      res.writeHead(status, headers);
      res.end(full);
      finishResponse(target, status);
    }

    function attemptTarget(index, overrideTarget = null) {
      const target = { ...(overrideTarget || targets[index]), index };
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
          upstreamRes.on('end', () => { record({ kind: 'upstream-http-fallback', route: target.kind, upstream: target.url, status, body_preview: Buffer.concat(chunks).toString('utf8').slice(0, 500) }); attemptTarget(index + 1); });
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
        record({ kind: 'upstream-error', route: target.kind, upstream: target.url, message: err.message });
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

module.exports = { createCodexResponseForwarder };
