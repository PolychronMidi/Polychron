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
      if (responseHasContextLoss(finalParsed || full)) {
        record({ kind: 'codex-context-loss-blocked', route: target.kind, depth: target.tool_loop_depth || 0, reason: 'empty command tool result treated as task context' });
        const repairedBody = appendContextLossRepair(target.body);
        const repairText = repairedBody.input?.at?.(-1)?.content?.[0]?.text || 'HME context-loss repair: continue from the latest user request/session objective.';
        const repairResult = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: repairText }] }];
        if (continueAfterTools(target.index, { ...target, body: repairedBody }, { id: (parsed && parsed.id) || '' }, [], repairResult)) return;
        const fallback = contextLossFallbackResponse(finalParsed);
        res.writeHead(status, { ...headers, 'content-type': 'application/json' });
        res.end(JSON.stringify(fallback));
        finishResponse(target, status, 'context loss blocked', fallback);
        return;
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
