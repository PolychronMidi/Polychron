'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const { retryBlankOmniRouteResponse } = require('./contexts/failure_policy');

function _sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const lk = String(k).toLowerCase();
    if (lk === 'authorization' || lk === 'x-api-key' || lk === 'cookie') {
      out[k] = typeof v === 'string'
        ? `<redacted len=${v.length} prefix=${v.slice(0, 12)}...>`
        : '<redacted>';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function _sseStats(bodyStr) {
  const events = [];
  let textChars = 0;
  let textBlocks = 0;
  let thinkingChars = 0;
  let thinkingBlocks = 0;
  let toolUseBlocks = 0;
  let stopReason = null;
  const errorEventsSeen = [];
  for (const evRaw of String(bodyStr || '').split('\n\n')) {
    if (!evRaw.trim()) continue;
    let evName = '';
    const evDataLines = [];
    for (const line of evRaw.split('\n')) {
      if (line.startsWith('event: ')) evName = line.slice(7).trim();
      else if (line.startsWith('data: ')) evDataLines.push(line.slice(6));
    }
    const evDataStr = evDataLines.join('\n');
    let evData = null;
    try { evData = JSON.parse(evDataStr); } catch (_e) { /* skip non-JSON */ }
    events.push({ event: evName, data: evData });
    try {
      const { reasoningTextFromData } = require('./reasoning_to_thinking');
      const rt = reasoningTextFromData(evData);
      if (rt) thinkingChars += rt.length;
    } catch (_e) { /* diagnostics only */ }
    if (evName === 'content_block_start' && evData && evData.content_block) {
      const t = evData.content_block.type;
      if (t === 'text') textBlocks++;
      else if (t === 'thinking') thinkingBlocks++;
      else if (t === 'tool_use') toolUseBlocks++;
    } else if (evName === 'content_block_delta' && evData && evData.delta) {
      if (evData.delta.type === 'text_delta' && typeof evData.delta.text === 'string') {
        textChars += evData.delta.text.length;
      } else if (evData.delta.type === 'thinking_delta' && typeof evData.delta.thinking === 'string') {
        thinkingChars += evData.delta.thinking.length;
      }
    } else if (evName === 'message_delta' && evData && evData.delta && evData.delta.stop_reason) {
      stopReason = evData.delta.stop_reason;
    } else if (evName === 'error') {
      errorEventsSeen.push(evData);
    }
  }
  return { events, textChars, textBlocks, thinkingChars, thinkingBlocks, toolUseBlocks, stopReason, errorEventsSeen };
}

function _jsonStats(bodyStr) {
  const stats = {
    events: [],
    textChars: 0,
    textBlocks: 0,
    thinkingChars: 0,
    thinkingBlocks: 0,
    toolUseBlocks: 0,
    stopReason: null,
    errorEventsSeen: [],
  };
  let data = null;
  try { data = JSON.parse(String(bodyStr || '')); } catch (_e) { return stats; }
  if (!data || typeof data !== 'object') return stats;

  if (data.error) stats.errorEventsSeen.push(data.error);
  if (data.stop_reason) stats.stopReason = data.stop_reason;
  if (typeof data.completion === 'string' && data.completion.trim() !== '(empty response)') {
    stats.textBlocks++;
    stats.textChars += data.completion.length;
  }
  if (typeof data.content === 'string' && data.content.trim() !== '(empty response)') {
    stats.textBlocks++;
    stats.textChars += data.content.length;
  }

  const blocks = Array.isArray(data.content) ? data.content : [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const type = String(block.type || '');
    if (type === 'text') {
      stats.textBlocks++;
      if (typeof block.text === 'string' && block.text.trim() !== '(empty response)') {
        stats.textChars += block.text.length;
      }
    } else if (type === 'thinking') {
      stats.thinkingBlocks++;
      if (typeof block.thinking === 'string') stats.thinkingChars += block.thinking.length;
    } else if (type === 'tool_use' || type === 'server_tool_use') {
      stats.toolUseBlocks++;
    }
  }
  return stats;
}

async function traceAnthropicResponse({
  isAnthropic,
  outStatus,
  outHeaders,
  outBuf,
  clientReq,
  upstreamHeaders,
  bodyBuf,
  outBody,
  payload,
  final,
  passthrough,
  isOmniRouteSwap,
  swapChain,
  isInteractivePath,
  getConsecutive429s,
  getLastInputTokensRemaining,
  getLastInputTokensLimit,
}) {
  if (!isAnthropic) return { outStatus, outHeaders, outBuf };
  try {
    const dumpDir = path.join(PROJECT_ROOT, 'tmp', 'blank-debug');
    try { fs.mkdirSync(dumpDir, { recursive: true }); } catch (_e) { /* ignore */ }
    try {
      const existing = fs.readdirSync(dumpDir)
        .filter((n) => n.startsWith('hme-resp-') && (n.endsWith('.json') || n.endsWith('.body')))
        .map((n) => ({ n, t: fs.statSync(path.join(dumpDir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { n } of existing.slice(199 * 2)) {
        try { fs.unlinkSync(path.join(dumpDir, n)); } catch (_e) { /* ignore */ }
      }
    } catch (_e) { /* ignore rotation errors */ }

    const isSse = (outHeaders['content-type'] || '').toLowerCase().includes('text/event-stream');
    const bodyStr = outBuf.toString('utf8');
    const stats = isSse ? _sseStats(bodyStr) : _jsonStats(bodyStr);
    const hasErrorEvent = stats.errorEventsSeen.length > 0;
    const isBlank = !hasErrorEvent && stats.textChars === 0 && stats.toolUseBlocks === 0;
    const verdict = hasErrorEvent ? 'ERROR' : (isBlank ? 'BLANK' : 'OK');
    console.error(`[hme-proxy] verdict=${verdict} omni=${isOmniRouteSwap} chain=${swapChain.length} blank=${isBlank} text=${stats.textChars} tools=${stats.toolUseBlocks}`);

    const blankRetry = await retryBlankOmniRouteResponse({
      isBlank,
      isOmniRouteSwap,
      swapChain,
      payload,
      outStatus,
      outBuf,
      outHeaders,
      projectRoot: PROJECT_ROOT,
    });
    if (blankRetry) {
      outStatus = blankRetry.outStatus;
      outBuf = blankRetry.outBuf;
      outHeaders = blankRetry.outHeaders;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const pathLabel = isInteractivePath ? 'interactive' : 'sub';
    const corrId = `${ts}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const dumpFile = path.join(dumpDir, `hme-resp-${corrId}-${verdict}-${pathLabel}.json`);
    const bodyFile = path.join(dumpDir, `hme-resp-${corrId}-${verdict}-${pathLabel}.body`);
    const reqBodyFile = path.join(dumpDir, `hme-resp-${corrId}-${verdict}-${pathLabel}.reqBody`);
    const envSnap = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^(HME_|CLAUDE_CODE_|ANTHROPIC_(BASE_URL|MODEL|VERSION|BETA))/.test(k)) envSnap[k] = v;
    }
    const dump = {
      ts: new Date().toISOString(),
      corr_id: corrId,
      verdict,
      path_label: pathLabel,
      request: {
        method: clientReq.method,
        url: clientReq.url,
        client_headers: _sanitizeHeaders(clientReq.headers),
        upstream_outgoing_headers: _sanitizeHeaders(upstreamHeaders),
        body_bytes: bodyBuf.length,
        outBody_bytes: outBody.length,
        proxy_mutated_body: outBody.length !== bodyBuf.length,
        payload_summary: payload ? {
          model: payload.model,
          thinking: payload.thinking,
          output_config: payload.output_config,
          max_tokens: payload.max_tokens,
          stream: payload.stream,
          temperature: payload.temperature,
          messages_count: Array.isArray(payload.messages) ? payload.messages.length : 0,
          system_block_count: Array.isArray(payload.system) ? payload.system.length : (payload.system ? 1 : 0),
          system_total_chars: Array.isArray(payload.system)
            ? payload.system.reduce((acc, b) => acc + ((b && b.text) ? b.text.length : 0), 0)
            : (typeof payload.system === 'string' ? payload.system.length : 0),
          tools_count: Array.isArray(payload.tools) ? payload.tools.length : 0,
          betas: payload.betas,
          tool_choice: payload.tool_choice,
          metadata: payload.metadata,
        } : null,
      },
      response: {
        status: outStatus,
        headers: outHeaders,
        body_bytes: outBuf.length,
        is_sse: isSse,
        had_continuation: !!final,
        text_chars: stats.textChars,
        thinking_chars: stats.thinkingChars,
        text_blocks: stats.textBlocks,
        thinking_blocks: stats.thinkingBlocks,
        tool_use_blocks: stats.toolUseBlocks,
        total_events: stats.events.length,
        stop_reason: stats.stopReason,
        error_events: stats.errorEventsSeen,
      },
      events: stats.events,
      proxy_state: {
        passthrough_mode: passthrough,
        consecutive_429s: getConsecutive429s(),
        last_input_tokens_remaining: getLastInputTokensRemaining(),
        last_input_tokens_limit: getLastInputTokensLimit(),
        proxy_pid: process.pid,
        proxy_uptime_s: Math.round(process.uptime()),
      },
      env_snapshot: envSnap,
    };
    try {
      fs.writeFileSync(dumpFile, JSON.stringify(dump, null, 2));
      fs.writeFileSync(bodyFile, outBuf);
      fs.writeFileSync(reqBodyFile, outBody);
      console.error(`dump ${verdict}/${pathLabel} status=${outStatus} sse=${isSse} textC=${stats.textChars} thC=${stats.thinkingChars} blocks=${stats.textBlocks}t/${stats.thinkingBlocks}th/${stats.toolUseBlocks}tu stop=${stats.stopReason} bodyB=${outBuf.length} reqB=${outBody.length} -> ${dumpFile}`);
    } catch (err) {
      console.error(`dump write failed: ${err.message} stack=${err.stack}`);
    }
  } catch (err) {
    console.error(`response-trace dumper threw: ${err.message} stack=${err.stack}`);
  }
  return { outStatus, outHeaders, outBuf };
}

module.exports = { traceAnthropicResponse, _sseStats, _jsonStats, _sanitizeHeaders };
