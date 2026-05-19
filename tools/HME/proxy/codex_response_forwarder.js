'use strict';

const http = require('http');
const https = require('https');
const { rewriteCodexResponseObject, createNativeToolSseRewriter } = require('./codex_native_tools');
const { responseHasContextLoss, appendContextLossRepair, appendToolSchemaRepair, appendToolUseEnforcement, contextLossFallbackResponse } = require('./codex_context_loss_guard');
const { collectToolCalls, collectSseToolCalls, parseSseEvents, executeToolCall, toolResultInput, followupBody, isIncompleteToolCall, missingRequiredToolFields } = require('./codex_tool_loop');

const MAX_TOOL_LOOP_DEPTH = 8;
const FINALIZE_TOOL_LOOP_DEPTH = MAX_TOOL_LOOP_DEPTH - 1;

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
  const setTrace = (name, value) => {
    if (value == null || value === '') return;
    headers[name] = String(value).slice(0, 240);
  };
  setTrace('x-hme-codex-correlation-id', target.hme_correlation_id);
  setTrace('x-hme-codex-session-id', target.hme_session_id);
  setTrace('x-hme-codex-thread-id', target.hme_thread_id);
  setTrace('x-hme-codex-turn-id', target.hme_turn_id);
  setTrace('x-hme-codex-tool-loop-depth', target.tool_loop_depth || 0);
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
  return /\b(?:(?:please\s+)?send\s+(?:the\s+)?(?:next\s+)?(?:objective|task)|specific task you want me to continue|avoid (?:calling|repeating) .*?(?:tool|read|discovery\/listing|context check|calls)|reuse the recovered repository context|if there(?:'s| is) no specific task)\b/i.test(text);
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
    const correlationId = [source && source.session_id, source && source.turn_id, started.toString(36), Math.random().toString(36).slice(2, 8)].filter(Boolean).join(':');
    const clientSse = { started: false, responseId: '', itemId: '', text: '', progressEvents: 0, toolLoops: 0, callIds: [] };

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
        response_id: clientSse.responseId || '',
        ...extra,
      };
    }

    function sseId(prefix) {
      return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function sseEvent(data, eventName = '') {
      if (!clientSse.started || res.writableEnded) return;
      if (eventName) res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    function ensureClientSse(target, status = 200, headers = {}) {
      if (!clientSse.started && !(target && target.body && target.body.stream)) return false;
      if (res.writableEnded) return false;
      if (clientSse.started) return true;
      if (res.headersSent) return false;
      clientSse.started = true;
      clientSse.responseId = sseId('hme_visible_response');
      clientSse.itemId = sseId('hme_visible_message');
      record({ kind: 'codex-client-sse-started', route: target.kind, ...traceFields(target) });
      const outHeaders = { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' };
      delete outHeaders['content-length'];
      res.writeHead(status, outHeaders);
      sseEvent({ type: 'response.created', response: { id: clientSse.responseId, object: 'response', status: 'in_progress', output: [] } }, 'response.created');
      sseEvent({ type: 'response.output_item.added', output_index: 0, item: { id: clientSse.itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] } }, 'response.output_item.added');
      sseEvent({ type: 'response.content_part.added', item_id: clientSse.itemId, output_index: 0, content_index: 0, part: { type: 'output_text', text: '' } }, 'response.content_part.added');
      return true;
    }

    function writeClientText(target, text, status = 200, headers = {}) {
      const delta = String(text || '');
      if (!delta) return false;
      if (!ensureClientSse(target, status, headers)) return false;
      clientSse.text += delta;
      clientSse.progressEvents += 1;
      sseEvent({ type: 'response.output_text.delta', item_id: clientSse.itemId, output_index: 0, content_index: 0, delta }, 'response.output_text.delta');
      return true;
    }

    function completeClientSse(target, status, errorSummary = '', parsed = null) {
      if (!clientSse.started || res.writableEnded) return false;
      const message = { id: clientSse.itemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: clientSse.text }] };
      sseEvent({ type: 'response.output_text.done', item_id: clientSse.itemId, output_index: 0, content_index: 0, text: clientSse.text }, 'response.output_text.done');
      sseEvent({ type: 'response.content_part.done', item_id: clientSse.itemId, output_index: 0, content_index: 0, part: { type: 'output_text', text: clientSse.text } }, 'response.content_part.done');
      sseEvent({ type: 'response.output_item.done', output_index: 0, item: message }, 'response.output_item.done');
      sseEvent({ type: 'response.completed', response: { id: clientSse.responseId, object: 'response', status: 'completed', output: [message] } }, 'response.completed');
      res.write('data: [DONE]\n\n');
      res.end();
      finishResponse(target, status, errorSummary, parsed);
      return true;
    }

    function redactVisible(text) {
      return String(text || '')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
        .replace(/\b(?:sk|rk|pk|ghp|github_pat)_[A-Za-z0-9_:-]{12,}\b/g, '[REDACTED_KEY]')
        .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]');
    }

    function trunc(text, max = 160) {
      const s = redactVisible(text);
      return s.length > max ? `${s.slice(0, max - 1)}…` : s;
    }

    function displayToolCall(call) {
      const args = call && call.args && typeof call.args === 'object' ? call.args : {};
      const file = args.file_path || args.file || '';
      if (call.name === 'Read') return `Read ${trunc(file || '<missing file>')}`;
      if (call.name === 'Edit') return `Edit ${trunc(file || '<missing file>')}`;
      if (call.name === 'Write') return `Write ${trunc(file || '<missing file>')}`;
      if (call.name === 'WebFetch') return `WebFetch ${trunc(args.url || '<missing url>')}`;
      if (call.name === 'WebSearch') return `WebSearch ${trunc(args.query || '<missing query>')}`;
      if (call.name === 'Agent') return `Agent level=${args.level || 3}`;
      if (call.name === 'Bash') return `Bash ${JSON.stringify(trunc(args.description || args.command || args.cmd || '<missing command>'))}`;
      return trunc(call.name || 'tool');
    }

    function sendParsedOverClientSse(target, status, headers, parsed, errorSummary = '') {
      if (!clientSse.started) return false;
      const text = finalOutputText(parsed);
      if (text.trim()) {
        if (clientSse.text && !clientSse.text.endsWith('\n')) writeClientText(target, '\n', status, headers);
        writeClientText(target, text, status, headers);
      }
      return completeClientSse(target, status, errorSummary, parsed);
    }

    function finishResponse(target, status, errorSummary = '', parsed = null) {
      if (finished) return;
      finished = true;
      record({
        kind: 'response', route: target.kind, upstream: target.url, status,
        ...traceFields(target, { upstream_response_id: parsed && (parsed.id || parsed.response_id || parsed.response?.id) || '' }),
        client_sse_started: clientSse.started,
        client_visible_progress_events: clientSse.progressEvents,
        tool_loop_count: clientSse.toolLoops,
        call_ids: clientSse.callIds.slice(-32),
        duration_ms: Date.now() - started, error_summary: errorSummary,
        ...responseUsage(parsed),
        model: target.body && target.body.model ? target.body.model : visibility.model,
      });
    }

    function droppedIncompleteCalls(calls, target) {
      const depth = target.tool_loop_depth || 0;
      const dropped = calls.map((call) => ({ call_id: call.id, name: call.name, missing: missingRequiredToolFields(call) }));
      record({ kind: 'codex-incomplete-tool-call-dropped', route: target.kind, depth, calls: dropped, ...traceFields(target, { call_ids: dropped.map((call) => call.call_id).filter(Boolean) }) });
      return dropped;
    }

    function finalizePrompt(target, results) {
      const visible = results.map((result) => [
        `tool ${result.call_id}:`,
        String(result.output || '').slice(0, 8000),
      ].join('\n')).join('\n\n');
      return [
        'HME tool-loop finalization: the repository tools have already run and returned results below.',
        'Do not call another tool. Produce the final concise assistant answer now from these results and the latest user objective.',
        'If the results are partial, summarize what is known instead of continuing tool discovery.',
        '',
        visible,
      ].join('\n');
    }

    function appendFinalizationToolBlockPrompt(body, calls) {
      const names = [...new Set(calls.map((call) => call.name).filter(Boolean))].join(', ') || 'tool calls';
      const prompt = [
        'HME tool-loop finalization repair: the previous upstream response emitted tool calls after repository tools were already executed and tools were disabled.',
        `Blocked finalization-stage tool calls: ${names}.`,
        'Do not emit function_call, tool_call, or tool_use items. Produce only the final assistant message now.',
        'Use the tool results already present in this request and the latest user objective. Do not ask the user to resend context and do not perform more discovery.',
      ].join('\n');
      const next = { ...(body || {}), tools: [], tool_choice: 'none' };
      const repairInput = { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] };
      if (Array.isArray(next.input)) next.input = [...next.input, repairInput];
      else if (typeof next.input === 'string') next.input = `${next.input}\n\n${prompt}`;
      else next.input = [repairInput];
      return next;
    }

    function finalizationToolResultText(body) {
      const parts = [];
      function visit(value) {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { for (const item of value) visit(item); return; }
        if (value.type === 'function_call_output' && typeof value.output === 'string' && value.output.trim()) parts.push(value.output.trim());
        for (const child of Object.values(value)) visit(child);
      }
      visit(body && body.input);
      const text = parts.slice(-3).join('\n\n');
      return text.length > 4000 ? text.slice(-4000) : text;
    }

    function finalizationFallbackResponse(target, parsed, calls) {
      const context = finalizationToolResultText(target.body);
      const text = [
        'HME stopped a non-terminating Codex tool loop after repository tools had already run.',
        'The upstream model kept emitting tool calls after tools were disabled, so HME returned this bounded final response instead of forwarding raw tool calls or a 508 loop error.',
        context ? `\nLast tool result excerpt:\n${context}` : '',
      ].filter(Boolean).join('\n');
      return {
        id: parsed && parsed.id ? parsed.id : `hme_tool_loop_finalized_${Date.now()}`,
        object: 'response',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
        hme_tool_loop_finalized: true,
        hme_blocked_finalization_tool_call_count: calls.length,
      };
    }

    function continueAfterTools(index, target, parsed, calls, forcedResults = null) {
      const depth = target.tool_loop_depth || 0;
      if (!calls.length && !forcedResults) return false;
      if (depth >= MAX_TOOL_LOOP_DEPTH) return false;
      const actionableCalls = forcedResults ? calls : calls.filter((call) => !isIncompleteToolCall(call));
      const skipped = forcedResults ? [] : calls.filter((call) => isIncompleteToolCall(call));
      if (!forcedResults && skipped.length) droppedIncompleteCalls(skipped, target);
      if (!forcedResults && !actionableCalls.length) return false;
      let results;
      if (forcedResults) results = forcedResults;
      else {
        results = [];
        for (const call of actionableCalls) {
          writeClientText(target, `\n• ${displayToolCall(call)}\n`);
          const result = executeToolCall(call, { projectRoot, sessionId: source.session_id || '' });
          results.push(result);
          const bytes = Buffer.byteLength(String(result.output || ''), 'utf8');
          writeClientText(target, `  ↳ completed; result forwarded upstream (${bytes} bytes).\n`);
        }
        clientSse.callIds.push(...actionableCalls.map((call) => call.id).filter(Boolean));
        if (clientSse.started) record({ kind: 'codex-proxy-tool-loop-visible', route: target.kind, depth: depth + 1, calls: actionableCalls.map((call) => ({ call_id: call.id, name: call.name })), ...traceFields(target, { call_ids: actionableCalls.map((call) => call.id).filter(Boolean) }) });
      }
      const finalizing = !forcedResults && depth >= FINALIZE_TOOL_LOOP_DEPTH;
      clientSse.toolLoops += forcedResults ? 0 : 1;
      const hiddenStreamLoop = Boolean(target.body && target.body.stream && !forcedResults && !clientSse.started);
      if (hiddenStreamLoop) record({ kind: 'codex-hidden-tool-loop-violation', route: target.kind, depth: depth + 1, reason: 'streamed tool loop executed without client-visible progress', ...traceFields(target, { call_ids: actionableCalls.map((call) => call.id).filter(Boolean) }) });
      record({ kind: finalizing ? 'codex-proxy-tool-loop-finalize' : 'codex-proxy-tool-loop', route: target.kind, depth: depth + 1, calls: results.map((r) => ({ call_id: r.call_id, is_error: r.is_error })), client_visible: clientSse.started, ...traceFields(target, { call_ids: results.map((r) => r.call_id).filter(Boolean) }) });
      let nextBody = followupBody(target.body, parsed, results, parsed && parsed._sse_events || []);
      if (finalizing) {
        const finalizeInput = { type: 'message', role: 'user', content: [{ type: 'input_text', text: finalizePrompt(target, results) }] };
        nextBody = { ...nextBody, input: [...results, finalizeInput], tools: [], tool_choice: 'none' };
      }
      attemptTarget(index, { ...target, body: nextBody, tool_loop_depth: depth + 1, finalizing_tool_loop: finalizing || target.finalizing_tool_loop, finalization_repairs: target.finalization_repairs || 0 });
      return true;
    }

    function retryAfterFinalizationToolCalls(target, parsed, calls) {
      if (!target.finalizing_tool_loop || !calls.length) return false;
      const depth = target.tool_loop_depth || 0;
      const repairs = target.finalization_repairs || 0;
      record({ kind: 'codex-finalization-tool-call-blocked', route: target.kind, depth, repairs, calls: calls.map((call) => ({ call_id: call.id, name: call.name, missing: missingRequiredToolFields(call) })), ...traceFields(target, { call_ids: calls.map((call) => call.id).filter(Boolean) }) });
      if (repairs >= 1) return false;
      const nextBody = appendFinalizationToolBlockPrompt(target.body, calls);
      attemptTarget(target.index, { ...target, body: nextBody, tool_loop_depth: depth + 1, finalizing_tool_loop: true, finalization_repairs: repairs + 1 });
      return true;
    }

    function sendFinalizationFallback(target, status, headers, parsed, calls) {
      const fallback = finalizationFallbackResponse(target, parsed, calls);
      const body = JSON.stringify(fallback);
      if (sendParsedOverClientSse(target, status, headers, fallback, 'finalization tool calls blocked')) return;
      res.writeHead(status, { ...headers, 'content-type': 'application/json' });
      res.end(body);
      finishResponse(target, status, 'finalization tool calls blocked', fallback);
    }

    function retryAfterIncompleteOnly(index, target, parsed, calls) {
      const depth = target.tool_loop_depth || 0;
      if (!calls.length || calls.some((call) => !isIncompleteToolCall(call))) return false;
      if (depth >= MAX_TOOL_LOOP_DEPTH) return false;
      const dropped = droppedIncompleteCalls(calls, target);
      record({ kind: 'codex-incomplete-tool-call-repair', route: target.kind, depth, calls: dropped, ...traceFields(target, { call_ids: dropped.map((call) => call.call_id).filter(Boolean) }) });
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
      record({ kind: 'codex-context-loss-blocked', route: target.kind, depth: target.tool_loop_depth || 0, reason, ...traceFields(target) });
      const repairedBody = avoidedToolUse ? appendToolUseEnforcement(target.body, reason) : appendContextLossRepair(target.body);
      const repairText = repairedBody.input?.at?.(-1)?.content?.[0]?.text || 'HME context-loss repair: continue from the latest user request/session objective.';
      const repairResult = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: repairText }] }];
      if (continueAfterTools(target.index, { ...target, body: repairedBody }, parsed || {}, [], repairResult)) return true;
      const fallback = contextLossFallbackResponse(parsed);
      if (sendParsedOverClientSse(target, status, headers, fallback, 'context loss blocked')) return true;
      res.writeHead(status, { ...headers, 'content-type': 'application/json' });
      res.end(JSON.stringify(fallback));
      finishResponse(target, status, 'context loss blocked', fallback);
      return true;
    }

    function sendJsonFinal(target, status, headers, full) {
      const parsed = safeJson(full);
      const calls = collectToolCalls(parsed);
      if (calls.length) {
        if (retryAfterFinalizationToolCalls(target, parsed, calls)) return;
        if (target.finalizing_tool_loop) return sendFinalizationFallback(target, status, headers, parsed, calls);
        if (retryAfterIncompleteOnly(target.index, target, parsed, calls)) return;
        if (continueAfterTools(target.index, target, parsed, calls)) return;
        if (calls.some((call) => !isIncompleteToolCall(call))) return toolLoopLimit(target, parsed);
      }
      const rewritten = parsed && typeof parsed === 'object' ? rewriteCodexResponseObject(parsed) : null;
      if (rewritten && rewritten.stats.unknown_calls) record({ kind: 'codex-unknown-tool-call', route: target.kind, count: rewritten.stats.unknown_calls, names: rewritten.stats.unknown_names || [], ...traceFields(target) });
      const finalParsed = rewritten ? rewritten.body : parsed;
      const forcedToolChoice = isForcedToolChoice(responseToolChoice(target.body));
      const avoidedToolUse = bodyHasTools(target.body) && !forcedToolChoice && responseAvoidedToolUse(finalParsed || parsed);
      if (responseHasContextLoss(finalParsed || full) || avoidedToolUse) {
        if (retryAfterContextLoss(target, status, headers, finalParsed || parsed, avoidedToolUse)) return;
      }
      const finalBody = rewritten && rewritten.stats.calls ? JSON.stringify(rewritten.body) : full;
      if (finalParsed && typeof finalParsed === 'object') planScanner.scanObjectForPlan(finalParsed, source);
      if (sendParsedOverClientSse(target, status, headers, finalParsed, '')) return;
      res.writeHead(status, headers);
      res.end(finalBody);
      finishResponse(target, status, '', finalParsed);
    }

    function sendSseFinal(target, status, headers, full) {
      const events = parseSseEvents(full);
      const calls = collectSseToolCalls(full);
      const parsed = sseFinalResponse(events);
      if (calls.length) {
        if (retryAfterFinalizationToolCalls(target, parsed, calls)) return;
        if (target.finalizing_tool_loop) return sendFinalizationFallback(target, status, headers, parsed, calls);
        if (retryAfterIncompleteOnly(target.index, target, parsed, calls)) return;
        if (continueAfterTools(target.index, target, parsed, calls)) return;
        if (calls.some((call) => !isIncompleteToolCall(call))) return toolLoopLimit(target, parsed);
      }
      const forcedToolChoice = isForcedToolChoice(responseToolChoice(target.body));
      const avoidedToolUse = bodyHasTools(target.body) && !forcedToolChoice && responseAvoidedToolUse(parsed);
      if (responseHasContextLoss(parsed || full) || avoidedToolUse) {
        if (retryAfterContextLoss(target, status, headers, parsed, avoidedToolUse)) return;
      }
      const rewriter = createNativeToolSseRewriter();
      const finalFull = rewriter.feed(Buffer.from(full)) + rewriter.finish();
      if (rewriter.stats.calls) record({ kind: 'codex-sse-native-tool-rewrite', route: target.kind, count: rewriter.stats.calls, ...traceFields(target) });
      if (rewriter.stats.unknown_calls) record({ kind: 'codex-unknown-tool-call', route: target.kind, count: rewriter.stats.unknown_calls, names: rewriter.stats.unknown_names || [], ...traceFields(target) });
      const scanner = planScanner.createSseScanner(source);
      scanner.feed(Buffer.from(finalFull));
      scanner.finish();
      if (clientSse.started) return sendParsedOverClientSse(target, status, headers, parsed, '');
      res.writeHead(status, headers);
      res.end(finalFull);
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

module.exports = { createCodexResponseForwarder };
