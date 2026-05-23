'use strict';

const fs = require('fs');
const path = require('path');
const { sessionKey, emit, PROJECT_ROOT } = require('./shared');
const { isPassthroughMode } = require('./upstream');
const { routeDecision } = require('./model_route_resolver');
const { shouldInject, consumeStatusContext, buildJurisdictionContext, injectIntoLastUserMessage, stripSystemCacheControl, normalizeCacheControlTtls } = require('./context');
const { stripBoilerplate, stripSemanticRedundancy, scanMessages } = require('./messages');
const { applyAnthropicCommonTransforms } = require('./request_transform_core');
const { requestTelemetry } = require('./request_telemetry');

function applyExplicitOtpmCap(payload) {
  const raw = process.env.HME_PROXY_MAX_OUTPUT_TOKENS;
  if (!raw) return false;
  const cap = parseInt(raw, 10);
  const maxTokensCap = cap + 2048;
  let changed = false;
  if (payload.thinking && typeof payload.thinking === 'object') {
    if (typeof payload.thinking.budget_tokens === 'number' && payload.thinking.budget_tokens > cap) {
      console.error(`OTPM-cap (explicit): thinking.budget_tokens ${payload.thinking.budget_tokens} -> ${cap}`);
      payload.thinking.budget_tokens = cap;
      changed = true;
    }
  }
  if (typeof payload.max_tokens === 'number' && payload.max_tokens > maxTokensCap) {
    console.error(`OTPM-cap (explicit): max_tokens ${payload.max_tokens} -> ${maxTokensCap}`);
    payload.max_tokens = maxTokensCap;
    changed = true;
  }
  return changed;
}

// Claude Code autocompact prompt signature (extracted from cli binary strings).
// If a request carries this prompt, autocompact has fired despite our env-level
// kill (DISABLE_AUTO_COMPACT=1 + CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=100 +
const _AUTOCOMPACT_SIG_RE = /Your task is to create a detailed summary of (?:this conversation|the conversation so far)/;

function _detectAutocompactRequest(payload) {
  if (!payload || !Array.isArray(payload.messages)) return false;
  const inspect = (txt) => typeof txt === 'string' && _AUTOCOMPACT_SIG_RE.test(txt);
  if (typeof payload.system === 'string' && inspect(payload.system)) return true;
  if (Array.isArray(payload.system)) {
    for (const b of payload.system) if (b && inspect(b.text)) return true;
  }
  for (const msg of payload.messages) {
    if (!msg) continue;
    if (typeof msg.content === 'string' && inspect(msg.content)) return true;
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) if (b && b.type === 'text' && inspect(b.text)) return true;
    }
  }
  return false;
}

function _writeAutocompactLifesaver(root, payload) {
  try {
    const logDir = path.join(root, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString();
    let normLine = '';
    try {
      const sink = path.join(root, 'tools', 'HME', 'runtime', 'proxy-context-norm.json');
      normLine = ' norm=' + fs.readFileSync(sink, 'utf8').trim();
    } catch (_e) { /* best effort */ }
    const model = (payload && payload.model) || 'unknown';
    const msgCount = (payload && Array.isArray(payload.messages)) ? payload.messages.length : 0;
    const line = `[${ts}] [autocompact-fired-DESPITE-DISABLE] model=${model} messages=${msgCount}${normLine}\n`;
    fs.appendFileSync(path.join(logDir, 'hme-lifesaver.log'), line);
    process.stderr.write(`LIFESAVER! autocompact fired despite DISABLE_AUTO_COMPACT=1 -- see log/hme-lifesaver.log\n`);
    process.stderr.write(`LIFESAVER! ${line}`);
  } catch (_e) { /* best effort */ }
}

function _lastUserPromptText(payload) {
  const last = payload && Array.isArray(payload.messages) ? payload.messages[payload.messages.length - 1] : null;
  if (!last || last.role !== 'user') return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return last.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text).join('\n');
  }
  return '';
}

async function mutateClaudeRequest({
  payload,
  outBody,
  injected,
  upstream,
  clientReq,
  isAnthropic,
  isInteractivePath,
  shrinkForPassthrough,
  stripHmePrefixOutgoing,
  injectHmeTools,
  sanitizePayload,
  injectStopReminderSystem,
  lifecycleInactive,
  runInlineFallback,
  middleware,
}) {
  const passthrough = isPassthroughMode();
  if (isAnthropic && _detectAutocompactRequest(payload)) {
    _writeAutocompactLifesaver(PROJECT_ROOT, payload);
    emit({ event: 'autocompact_fired_despite_disable', session: sessionKey(payload), model: payload && payload.model });
  }
  if (passthrough && isAnthropic && isInteractivePath && payload && Array.isArray(payload.messages)) {
    const dropped = shrinkForPassthrough(payload);
    if (dropped > 0) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
    if (applyExplicitOtpmCap(payload)) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
  }

  if (payload && Array.isArray(payload.messages) && !passthrough) {
    const session = sessionKey(payload);
    let bodyDirtiedByStrip = false;
    if (isAnthropic) {
      try {
        require('./_dump').writeDump(
          payload, PROJECT_ROOT, 'pre',
          (m) => console.warn('Acceptable warning: [middleware]', m),
        );
      } catch (err) {
        console.error(`pre-dump failed: ${err.message}`);
      }
      if (process.env.HME_REPLACE_SYSTEM_PROMPT === '1') {
        if (stripSystemCacheControl(payload)) bodyDirtiedByStrip = true;
      }
      const common = applyAnthropicCommonTransforms(payload);
      const iw = common.i.command_rewrites + common.i.text_rewrites;
      const hns = common.hook_noise;
      const b = stripBoilerplate(payload);
      const s = stripSemanticRedundancy(payload);
      const r = stripHmePrefixOutgoing(payload);
      const n = await injectHmeTools(payload);
      sanitizePayload(payload);
      if (iw > 0 || hns.stripped > 0 || common.sanitized > 0 || b > 0 || s > 0 || r || n > 0) bodyDirtiedByStrip = true;
    }

    if (isAnthropic) {
      const scan = scanMessages(payload);
      if (lifecycleInactive('UserPromptSubmit')) {
        const promptText = _lastUserPromptText(payload);
        if (promptText) runInlineFallback('UserPromptSubmit', JSON.stringify({ user_prompt: promptText, session_id: session }));
      }
      try {
        const mwDirtied = await middleware.runPipeline(payload, scan, session);
        const postMwSanitized = sanitizePayload(payload);
        if (mwDirtied || postMwSanitized > 0) bodyDirtiedByStrip = true;
      } catch (err) {
        console.error('middleware pipeline error:', err.message);
      }
      if (injectStopReminderSystem(payload)) {
        emit({ event: 'stop_reminder_inject', session });
        bodyDirtiedByStrip = true;
      }
      if (shouldInject()) {
        const statusBlock = consumeStatusContext(session);
        if (statusBlock) {
          const injectedStatus = injectIntoLastUserMessage(payload, statusBlock.trim(), 'HME Session Status (proxy-injected)');
          if (injectedStatus) {
            emit({ event: 'status_inject', session });
            bodyDirtiedByStrip = true;
          }
        }
        if (scan.jurisdictionTargets.length > 0) {
          const block = buildJurisdictionContext(scan.jurisdictionTargets);
          injected = injectIntoLastUserMessage(payload, block, 'HME Jurisdiction Context (proxy-injected)');
          if (injected) {
            emit({
              event: 'jurisdiction_inject',
              session,
              targets: scan.jurisdictionTargets.length,
              first_target: (scan.jurisdictionTargets[0] || '').replace(/[,=\s]/g, '_'),
            });
            bodyDirtiedByStrip = true;
          }
        }
      }
      const ccChanged = normalizeCacheControlTtls(payload);
      if (ccChanged > 0) {
        bodyDirtiedByStrip = true;
        emit({ event: 'cache_control_normalized', session, count: ccChanged });
      }
      if (bodyDirtiedByStrip) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
    }

    emit({
      event: 'inference_call',
      session,
      provider: upstream.provider,
      path: clientReq.url || '?',
      model: (payload.model || 'unknown').replace(/[,=\s]/g, '_'),
      messages: payload.messages.length,
      injected,
      route_decision: routeDecision({ host: 'claude', requestedModel: payload.model || '', provider: upstream.provider, protocol: 'anthropic-messages', route: upstream.provider }),
      telemetry: requestTelemetry({ host: 'claude', protocol: 'anthropic-messages', provider: upstream.provider, route: upstream.provider, path: clientReq.url || '?', body: payload, stream: payload.stream }),
    });
  }
  return { outBody, injected, passthrough };
}

module.exports = { mutateClaudeRequest, applyExplicitOtpmCap };
