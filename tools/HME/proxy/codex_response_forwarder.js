'use strict';

const http = require('http');
const https = require('https');
const { rewriteCodexResponseObject, createNativeToolSseRewriter } = require('./codex_native_tools');
const { collectToolCalls, collectSseToolCalls, parseSseEvents, executeToolCall, followupBody, missingRequiredToolFields, toolOutputIsError } = require('./codex_tool_loop');
const { runCodexToolLoopGraph } = require('./codex_tool_loop_graph');


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
    if (Array.isArray(root.output)) {
      for (const item of root.output) push(outputItemText(item));
    }
    if (Array.isArray(root.choices)) {
      for (const choice of root.choices) push(choiceText(choice));
    }
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
    if (Array.isArray(event.choices)) {
      const text = event.choices.map(choiceText).filter(Boolean).join('');
      if (text) rememberText(event, text, true);
    }
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
  const { record, planScanner, projectRoot, onResponseComplete } = deps;

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
      clientSse.responseId = clientSse.responseId || sseId('hme_visible_response');
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
      // CRITICAL: surface the REAL upstream response id (parsed.id) to Codex CLI
      // so that next turn's previous_response_id chain hits a real stored response
      const upstreamId = (parsed && (parsed.id || parsed.response_id || (parsed.response && parsed.response.id))) || '';
      const finalResponseId = upstreamId || clientSse.responseId;
      const message = { id: clientSse.itemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: clientSse.text }] };
      sseEvent({ type: 'response.output_text.done', item_id: clientSse.itemId, output_index: 0, content_index: 0, text: clientSse.text }, 'response.output_text.done');
      sseEvent({ type: 'response.content_part.done', item_id: clientSse.itemId, output_index: 0, content_index: 0, part: { type: 'output_text', text: clientSse.text } }, 'response.content_part.done');
      sseEvent({ type: 'response.output_item.done', output_index: 0, item: message }, 'response.output_item.done');
      sseEvent({ type: 'response.completed', response: { id: finalResponseId, object: 'response', status: 'completed', output: [message] } }, 'response.completed');
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

    function recordMissingFinal(target, parsed, restored = false) {
      record({
        kind: restored ? 'codex-render-final-restored' : 'codex-render-final-missing',
        route: target.kind,
        visible_text_bytes: Buffer.byteLength(clientSse.text || '', 'utf8'),
        upstream_final_bytes: Buffer.byteLength(finalOutputText(parsed) || '', 'utf8'),
        ...traceFields(target),
      });
    }

    function sendParsedOverClientSse(target, status, headers, parsed, errorSummary = '') {
      const text = finalOutputText(parsed);
      if (!clientSse.started) {
        if (!target?.body?.stream || !text.trim()) return false;
        clientSse.responseId = parsed && (parsed.id || parsed.response_id || parsed.response?.id) || clientSse.responseId;
        writeClientText(target, text, status, headers);
        return completeClientSse(target, status, errorSummary, parsed);
      }
      if (text.trim()) {
        if (clientSse.text && !clientSse.text.endsWith('\n')) writeClientText(target, '\n', status, headers);
        writeClientText(target, text, status, headers);
        if (clientSse.toolLoops > 0) recordMissingFinal(target, parsed, true);
      } else if (clientSse.toolLoops > 0 && !finalOutputText(parsed).trim()) {
        recordMissingFinal(target, parsed, false);
      }
      return completeClientSse(target, status, errorSummary, parsed);
    }

    function finishResponse(target, status, errorSummary = '', parsed = null) {
      if (finished) return;
      finished = true;
      const parsedUpstreamId = parsed && (parsed.id || parsed.response_id || parsed.response?.id) || '';
      record({
        kind: 'response', route: target.kind, upstream: target.url, status,
        ...traceFields(target, { upstream_response_id: parsedUpstreamId }),
        client_sse_started: clientSse.started,
        client_visible_progress_events: clientSse.progressEvents,
        tool_loop_count: clientSse.toolLoops,
        call_ids: clientSse.callIds.slice(-32),
        // Telemetry: id the proxy actually sent the client via response.completed.
        // On error path parsed=null but clientSse.responseId IS the real upstream
        client_sse_response_id: clientSse.responseId || '',
        chain_id_used: parsedUpstreamId || clientSse.responseId || '',
        duration_ms: Date.now() - started, error_summary: errorSummary,
        ...responseUsage(parsed),
        model: target.body && target.body.model ? target.body.model : visibility.model,
      });
      if (onResponseComplete && status >= 200 && status < 300 && parsed && Array.isArray(parsed.output) && parsed.output.length > 0) {
        try { onResponseComplete(source && source.session_id, parsed.output); }
        catch (err) { record({ kind: 'codex-history-capture-error', message: err.message }); }
      }
    }

    function sendSseError(target, httpStatus, errCode, errMessage, attempts = 0) {
      const wantsStream = Boolean(target.body && target.body.stream);
      if (!wantsStream || res.headersSent || res.writableEnded) {
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errCode, message: errMessage, attempts }));
        } else { try { res.end(); } catch (_e) { /* socket already closed */ } }
        return;
      }
      const responseId = `hme_upstream_error_${Date.now()}`;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      });
      const errObj = { code: errCode, message: errMessage };
      const failedResponse = { id: responseId, object: 'response', status: 'failed', error: errObj, output: [] };
      res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: responseId, object: 'response', status: 'in_progress', output: [] } })}\n\n`);
      res.write(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: failedResponse })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }

    function droppedIncompleteCalls(calls, target) {
      const depth = target.tool_loop_depth || 0;
      const dropped = calls.map((call) => ({ call_id: call.id, name: call.name, missing: missingRequiredToolFields(call) }));
      record({ kind: 'codex-incomplete-tool-call-dropped', route: target.kind, depth, calls: dropped, ...traceFields(target, { call_ids: dropped.map((call) => call.call_id).filter(Boolean) }) });
      return dropped;
    }

    function toolGraphFallbackResponse(parsed, decision) {
      // Only fired for interrupt_before_tool (HITL gate, opt-in). All other
      // decisions (malformed/duplicate) fall through to upstream passthrough.
      const text = `HME paused before executing a tool that requires human approval. No tool was executed. Checkpoint: ${decision.checkpoint_id || 'unavailable'}.`;
      return {
        id: parsed && parsed.id ? parsed.id : '',
        object: 'response',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
        hme_tool_loop_graph: {
          action: 'interrupt_before_tool',
          reason: decision && decision.reason || '',
          invariant: decision && decision.invariant || '',
          checkpoint_id: decision && decision.checkpoint_id || '',
        },
      };
    }

    function sendToolGraphFallback(target, status, headers, parsed, decision) {
      record({ kind: 'codex-tool-loop-graph-fallback', route: target.kind, action: decision.action, reason: decision.reason, invariant: decision.invariant, checkpoint_id: decision.checkpoint_id || '', ...traceFields(target, { call_ids: (decision.calls || []).map((call) => call.id).filter(Boolean) }) });
      const fallback = toolGraphFallbackResponse(parsed, decision);
      if (sendParsedOverClientSse(target, status, headers, fallback, `tool graph ${decision.action}`)) return;
      res.writeHead(status, { ...headers, 'content-type': 'application/json' });
      res.end(JSON.stringify(fallback));
      finishResponse(target, status, `tool graph ${decision.action}`, fallback);
    }

    function continueAfterTools(index, target, parsed, calls, forcedResults = null, graphDecision = null) {
      const decision = graphDecision || (forcedResults ? { action: 'execute_tools', actionable_calls: calls, skipped_calls: [], next_depth: (target.tool_loop_depth || 0) + 1, reason: 'forced tool results' } : runCodexToolLoopGraph({ target, source, parsed, calls, executed_call_ids: clientSse.callIds, response_kind: 'model_response' }, { record }));
      const depth = target.tool_loop_depth || 0;
      if (!calls.length && !forcedResults) return false;
      if (decision.action !== 'execute_tools') return false;
      // Sync clientSse.responseId to the real upstream id BEFORE any fake SSE
      // event opens. Otherwise response.created/output_item/etc emit a synthetic
      const upstreamId = parsed && (parsed.id || parsed.response_id || (parsed.response && parsed.response.id));
      if (upstreamId && !clientSse.started) clientSse.responseId = String(upstreamId);
      const actionableCalls = forcedResults ? calls : decision.actionable_calls;
      const skipped = forcedResults ? [] : decision.skipped_calls;
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
      clientSse.toolLoops += forcedResults ? 0 : 1;
      const hiddenStreamLoop = Boolean(target.body && target.body.stream && !forcedResults && clientSse.progressEvents === 0);
      if (hiddenStreamLoop) record({ kind: 'codex-hidden-tool-loop-violation', route: target.kind, depth: depth + 1, reason: 'streamed tool loop executed without client-visible progress', ...traceFields(target, { call_ids: actionableCalls.map((call) => call.id).filter(Boolean) }) });
      record({ kind: 'codex-proxy-tool-loop', route: target.kind, depth: depth + 1, calls: results.map((r) => ({ call_id: r.call_id, is_error: toolOutputIsError(r) })), client_visible: clientSse.started, ...traceFields(target, { call_ids: results.map((r) => r.call_id).filter(Boolean) }) });
      // Persist intermediate tool-loop state to conversation_store BEFORE re-issuing
      // upstream. If the next iteration's upstream socket-hangs (common at deep
      if (onResponseComplete && parsed && Array.isArray(parsed.output) && parsed.output.length) {
        try { onResponseComplete(source && source.session_id, parsed.output); }
        catch (err) { record({ kind: 'codex-history-capture-error', message: err.message, stage: 'intermediate-assistant' }); }
      }
      if (onResponseComplete && results.length) {
        try { onResponseComplete(source && source.session_id, results); }
        catch (err) { record({ kind: 'codex-history-capture-error', message: err.message, stage: 'intermediate-tool-result' }); }
      }
      const nextBody = followupBody(target.body, parsed, results, parsed && parsed._sse_events || []);
      attemptTarget(index, { ...target, body: nextBody, tool_loop_depth: depth + 1 });
      return true;
    }

    function sendJsonFinal(target, status, headers, full) {
      const parsed = safeJson(full);
      if (parsed && parsed.id && !clientSse.started) clientSse.responseId = String(parsed.id);
      const calls = collectToolCalls(parsed);
      if (calls.length) {
        const decision = runCodexToolLoopGraph({ target, source, parsed, calls, executed_call_ids: clientSse.callIds, response_kind: 'json' }, { record });
        if (continueAfterTools(target.index, target, parsed, calls, null, decision)) return;
        // malformed_tool_fallback: do NOT fabricate a replacement response.
        // Forward upstream bytes unchanged so the model's own context survives;
        if (decision.action === 'interrupt_before_tool') return sendToolGraphFallback(target, status, headers, parsed, decision);
        record({ kind: 'codex-malformed-tool-passthrough', route: target.kind, reason: decision.reason || '', ...traceFields(target) });
      }
      const rewritten = parsed && typeof parsed === 'object' ? rewriteCodexResponseObject(parsed) : null;
      if (rewritten && rewritten.stats.unknown_calls) record({ kind: 'codex-unknown-tool-call', route: target.kind, count: rewritten.stats.unknown_calls, names: rewritten.stats.unknown_names || [], ...traceFields(target) });
      const finalParsed = rewritten ? rewritten.body : parsed;
      const finalBody = rewritten && rewritten.stats.calls ? JSON.stringify(rewritten.body) : full;
      if (finalParsed && typeof finalParsed === 'object') planScanner.scanObjectForPlan(finalParsed, source);
      if (sendParsedOverClientSse(target, status, headers, finalParsed, '')) return;
      res.writeHead(status, headers);
      res.end(finalBody);
      finishResponse(target, status, '', finalParsed);
    }

    function sendSseFinal(target, status, headers, full) {
      const events = parseSseEvents(full);
      if (!clientSse.started && target.body && target.body.stream && events.length === 0) {
        finishResponse(target, status, 'empty upstream SSE (no events)');
        sendSseError(status >= 400 ? status : 502, 'codex_proxy_empty_upstream_sse', 'upstream closed SSE stream without response events');
        return;
      }
      const calls = collectSseToolCalls(full);
      const parsed = sseFinalResponse(events);
      // Last-ditch upstream id extraction: scan raw SSE bytes for resp_* token
      // when structured parsing failed. Without a real upstream id, the chain
      if (!parsed.id) {
        const m = full.match(/"id"\s*:\s*"(resp_[A-Za-z0-9_-]{8,})"/);
        if (m) parsed.id = m[1];
      }
      if (parsed.id && !clientSse.started) clientSse.responseId = String(parsed.id);
      if (calls.length) {
        const decision = runCodexToolLoopGraph({ target, source, parsed, calls, executed_call_ids: clientSse.callIds, response_kind: 'sse' }, { record });
        if (continueAfterTools(target.index, target, parsed, calls, null, decision)) return;
        if (decision.action === 'interrupt_before_tool') return sendToolGraphFallback(target, status, headers, parsed, decision);
        record({ kind: 'codex-malformed-tool-passthrough', route: target.kind, reason: decision.reason || '', ...traceFields(target) });
      }
      const rewriter = createNativeToolSseRewriter();
      const finalFull = rewriter.feed(Buffer.from(full)) + rewriter.finish();
      if (rewriter.stats.calls) record({ kind: 'codex-sse-native-tool-rewrite', route: target.kind, count: rewriter.stats.calls, ...traceFields(target) });
      if (rewriter.stats.unknown_calls) record({ kind: 'codex-unknown-tool-call', route: target.kind, count: rewriter.stats.unknown_calls, names: rewriter.stats.unknown_names || [], ...traceFields(target) });
      const scanner = planScanner.createSseScanner(source);
      scanner.feed(Buffer.from(finalFull));
      scanner.finish();
      if (sendParsedOverClientSse(target, status, headers, parsed, '')) return;
      res.writeHead(status, headers);
      res.end(finalFull);
      finishResponse(target, status, '', parsed);
    }

    const MAX_RETRIES = 5;
    const RETRY_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

    function attemptTarget(index, overrideTarget = null) {
      const target = attachTrace({ ...(overrideTarget || targets[index]), index });
      const attempt = Number(target.attempt || 0);
      const bodyBytes = Buffer.from(JSON.stringify(target.body));
      const upstream = new URL(target.url);
      const client = upstream.protocol === 'http:' ? http : https;
      const options = {
        method: 'POST', hostname: upstream.hostname,
        port: upstream.port || (upstream.protocol === 'http:' ? 80 : 443),
        path: `${upstream.pathname}${upstream.search}`,
        headers: upstreamHeaders(req, bodyBytes, target),
      };
      function scheduleRetry(reason) {
        if (attempt >= MAX_RETRIES || clientSse.started || res.headersSent) return false;
        const delay = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
        record({ kind: 'codex-upstream-retry', route: target.kind, upstream: target.url, attempt: attempt + 1, max_retries: MAX_RETRIES, delay_ms: delay, reason, ...traceFields(target) });
        setTimeout(() => attemptTarget(index, { ...target, attempt: attempt + 1 }), delay);
        return true;
      }
      // For stream:true requests codex CLI's Rust SSE parser panics on JSON
      // error bodies. Emit upstream errors as proper SSE response.failed events
      function sendSseError(httpStatus, errCode, errMessage) {
        const wantsStream = Boolean(target.body && target.body.stream);
        if (!wantsStream || res.headersSent || res.writableEnded) {
          if (!res.headersSent && !res.writableEnded) {
            res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errCode, message: errMessage, attempts: attempt + 1 }));
          } else { try { res.end(); } catch (_) {} }
          return;
        }
        const responseId = `hme_upstream_error_${Date.now()}`;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        });
        const errObj = { code: errCode, message: errMessage };
        const failedResponse = { id: responseId, object: 'response', status: 'failed', error: errObj, output: [] };
        res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: responseId, object: 'response', status: 'in_progress', output: [] } })}\n\n`);
        res.write(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: failedResponse })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
      }
      const upstreamReq = client.request(options, (upstreamRes) => {
        const status = upstreamRes.statusCode || 502;
        let upstreamSawBytes = false;
        upstreamRes.on('data', () => { upstreamSawBytes = true; });
        if (target.fallbackHttpStatuses && target.fallbackHttpStatuses.has(status)) {
          const chunks = [];
          upstreamRes.on('data', (chunk) => chunks.push(chunk));
          upstreamRes.on('end', () => {
            const preview = Buffer.concat(chunks).toString('utf8').slice(0, 500);
            record({ kind: 'upstream-http-retryable', route: target.kind, upstream: target.url, status, body_preview: preview, ...traceFields(target) });
            if (scheduleRetry(`http ${status}`)) return;
            if (target.fallbackDirect && targets[index + 1] && !res.headersSent && !clientSse.started) return attemptTarget(index + 1);
            if (clientSse.started && !res.writableEnded) { try { completeClientSse(target, status, `upstream ${status}`, null); } catch (_e) { try { res.end(); } catch (_) {} } return; }
            finishResponse(target, status, `upstream ${status} after ${attempt + 1} attempts`);
            sendSseError(status, 'codex_proxy_upstream_exhausted', `upstream ${status} after ${attempt + 1} attempts: ${preview}`.slice(0, 800));
          });
          return;
        }
        const headers = { ...upstreamRes.headers };
        delete headers['content-length'];
        const chunks = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          const full = Buffer.concat(chunks).toString('utf8');
          const isSse = String(upstreamRes.headers['content-type'] || '').includes('text/event-stream');
          if (isSse) {
            const eventCount = parseSseEvents(full).length;
            if (target.body && target.body.stream && eventCount === 0) {
              const bodyBytes = Buffer.byteLength(full, 'utf8');
              record({ kind: 'codex-empty-upstream-sse', route: target.kind, upstream: target.url, status, body_bytes: bodyBytes, saw_bytes: upstreamSawBytes, ...traceFields(target) });
              finishResponse(target, status, `empty upstream SSE (${bodyBytes} bytes)`);
              sendSseError(status >= 400 ? status : 502, 'codex_proxy_empty_upstream_sse', `upstream closed SSE stream without response events (status ${status}, ${bodyBytes} bytes)`);
              return;
            }
            sendSseFinal(target, status, headers, full);
          } else if (status >= 400 && target.body && target.body.stream) {
            const preview = full.slice(0, 500);
            record({ kind: 'codex-non-sse-error-to-stream', route: target.kind, upstream: target.url, status, body_preview: preview, saw_bytes: upstreamSawBytes, ...traceFields(target) });
            finishResponse(target, status, `non-SSE upstream error for stream request (${preview})`);
            sendSseError(status, 'codex_proxy_non_sse_upstream_error', `upstream ${status}: ${preview}`);
          } else sendJsonFinal(target, status, headers, full);
        });
      });
      upstreamReq.on('error', (err) => {
        record({ kind: 'upstream-error', route: target.kind, upstream: target.url, message: err.message, attempt: attempt + 1, client_sse_started: clientSse.started, tool_loop_count: clientSse.toolLoops, ...traceFields(target) });
        if (scheduleRetry(`socket ${err.message}`)) return;
        if (target.fallbackDirect && targets[index + 1] && !res.headersSent && !clientSse.started) return attemptTarget(index + 1);
        if (clientSse.started && !res.writableEnded) {
          try { completeClientSse(target, 502, err.message, null); }
          catch (_e) { try { res.end(); } catch (_) { /* socket already closed */ } }
          return;
        }
        finishResponse(target, 502, err.message);
        sendSseError(502, 'codex_proxy_upstream_error', `${err.message} after ${attempt + 1} attempts`);
      });
      upstreamReq.write(bodyBytes);
      upstreamReq.end();
    }

    attemptTarget(0);
  };
}

module.exports = { createCodexResponseForwarder, finalOutputText, contentText };
