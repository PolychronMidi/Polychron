'use strict';

const fs = require('fs');
const path = require('path');
const { sessionKey, emit, PROJECT_ROOT } = require('./shared');
const { isPassthroughMode } = require('./contexts/upstream_dispatch');
const { routeDecision } = require('./contexts/upstream_dispatch');
const { shouldInject, consumeStatusContext, buildJurisdictionContext, injectIntoLastUserMessage, stripSystemCacheControl, normalizeCacheControlTtls } = require('./context');
const { stripBoilerplate, stripSemanticRedundancy, scanMessages } = require('./messages');
const { enforceReminderProvenance, loadLedger } = require('./system_reminder_provenance');
const { recordProxyFailure } = require('./middleware/_middleware_throw_lifesaver');
const { applyAnthropicCommonTransforms } = require('./request_transform_core');
const { requestTelemetry } = require('./request_telemetry');
const { shrinkForPassthrough: compactAnthropicPayload } = require('./passthrough_compact');
const { semanticTokenEstimate, serializedBytes } = require('./context_token_estimate');
const {
  detectAutocompactRequest,
  writeAutocompactLifesaver,
  detectAndMarkUndefinedUserPrompt,
  detectUnparsedToolCallRetry,
  lastUserPromptText,
} = require('./request_recovery_guards');

let _outputRegistry = { mtimeMs: 0, map: new Map() };
function _positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function _loadOutputRegistry() {
  const modelsPath = path.join(PROJECT_ROOT, 'config', 'models.json');
  let stat; try { stat = fs.statSync(modelsPath); } catch { return _outputRegistry.map; }
  if (stat.mtimeMs === _outputRegistry.mtimeMs) return _outputRegistry.map;
  const text = fs.readFileSync(modelsPath, 'utf8');
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  let cfg; try { cfg = JSON.parse(stripped); } catch { return _outputRegistry.map; }
  const map = new Map();
  for (const tier of Object.values(cfg.tiers || {})) {
    for (const m of tier.models || []) {
      const out = _positiveNumber(m.max_output_tokens);
      const input = _positiveNumber(m.max_input_tokens);
      const ctx = _positiveNumber(m.context_length);
      if (!out) continue;
      const info = { maxOutput: out, maxInput: input, context: ctx };
      if (m.id) map.set(String(m.id), info);
      if (m.api_model) map.set(String(m.api_model), info);
    }
  }
  _outputRegistry = { mtimeMs: stat.mtimeMs, map };
  return map;
}
function _modelOutputInfo(modelId) {
  const id = String(modelId || '');
  const reg = _loadOutputRegistry();
  if (reg.has(id)) return reg.get(id);
  for (const [k, v] of reg) if (id.includes(k)) return v;
  return { maxOutput: 32768, maxInput: 0, context: 0 };
}
function _estimatedInputTokens(payload) {
  return semanticTokenEstimate(payload, process.env);
}
function _dynamicOutputCap(payload) {
  const info = _modelOutputInfo(payload && payload.model);
  const modelCap = info.maxOutput || 32768;
  const requested = _positiveNumber(payload && payload.max_tokens) || modelCap;
  const inputTokens = _estimatedInputTokens(payload);
  const context = info.context || ((info.maxInput || 0) + modelCap);
  // Physical headroom only; no input-size throttle ladder.
  const headroomCap = context > 0 ? Math.max(2048, context - inputTokens - 8192) : modelCap;
  // Opt-in deliberate ceiling for genuine provider OTPM limits; unset = no throttle.
  const envCeil = _positiveNumber(process.env.HME_PROXY_MAX_OUTPUT_TOKENS);
  const envCap = envCeil ? envCeil + 2048 : Infinity;
  return Math.max(1024, Math.min(requested, modelCap, headroomCap, envCap));
}

function _anthropicTransportMaxBytes(_payload) {
  return _positiveNumber(process.env.HME_PROXY_INTERACTIVE_MAX_BYTES);
}

function compactLargeInteractiveAnthropicPayload(payload) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  const threshold = _anthropicTransportMaxBytes(payload);
  if (!threshold) return 0;
  const bytes = serializedBytes(payload);
  if (bytes <= threshold) return 0;
  return compactAnthropicPayload(payload, {
    route: 'interactive',
    model: payload.model || payload.target_model || payload.original_model || '',
    keepMin: Number(process.env.HME_PROXY_INTERACTIVE_KEEP_MIN || 24),
    effectiveThreshold: () => ({
      threshold,
      maxTier: 3,
      maxToolResultAge: Number(process.env.HME_PROXY_INTERACTIVE_STALE_TOOL_KEEP_TURNS || 32),
      toolResultByteFloor: Number(process.env.HME_PROXY_INTERACTIVE_TOOL_RESULT_FLOOR || 4000),
    }),
  });
}

function applyExplicitOtpmCap(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const maxTokensCap = _dynamicOutputCap(payload);
  const thinkingCap = Math.max(1024, Math.min(maxTokensCap - 1024, Math.floor(maxTokensCap * 0.8)));
  let changed = false;
  if (payload.thinking && typeof payload.thinking === 'object') {
    if (typeof payload.thinking.budget_tokens === 'number' && payload.thinking.budget_tokens > thinkingCap) {
      console.error(`OTPM-cap (dynamic): thinking.budget_tokens ${payload.thinking.budget_tokens} -> ${thinkingCap}`);
      payload.thinking.budget_tokens = thinkingCap;
      changed = true;
    }
  }
  if (typeof payload.max_tokens === 'number' && payload.max_tokens > maxTokensCap) {
    console.error(`OTPM-cap (dynamic): max_tokens ${payload.max_tokens} -> ${maxTokensCap} model=${payload.model || ''} est_input=${_estimatedInputTokens(payload)}`);
    payload.max_tokens = maxTokensCap;
    changed = true;
  }
  return changed;
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
  if (isAnthropic && detectAutocompactRequest(payload)) {
    writeAutocompactLifesaver(PROJECT_ROOT, payload);
    emit({ event: 'autocompact_fired_despite_disable', session: sessionKey(payload), model: payload && payload.model });
  }
  if (isAnthropic && detectAndMarkUndefinedUserPrompt(payload, PROJECT_ROOT)) {
    emit({ event: 'undefined_user_prompt_corrupted', session: sessionKey(payload) });
    outBody = Buffer.from(JSON.stringify(payload), 'utf8');
  }
  if (isAnthropic && detectUnparsedToolCallRetry(payload, PROJECT_ROOT)) {
    emit({ event: 'unparsed_tool_call_recovered', session: sessionKey(payload) });
    outBody = Buffer.from(JSON.stringify(payload), 'utf8');
  }
  if (isAnthropic && isInteractivePath && payload && Array.isArray(payload.messages)) {
    let compacted = 0;
    if (passthrough) compacted += shrinkForPassthrough(payload);
    compacted += compactLargeInteractiveAnthropicPayload(payload);

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
        recordProxyFailure(PROJECT_ROOT, 'pre-dump', err);
      }
      if (process.env.HME_REPLACE_SYSTEM_PROMPT === '1') {
        if (stripSystemCacheControl(payload)) bodyDirtiedByStrip = true;
      }
      const common = applyAnthropicCommonTransforms(payload);
      const iw = common.i.command_rewrites + common.i.text_rewrites;
      const hns = common.hook_noise;
      const b = stripBoilerplate(payload);
      const s = stripSemanticRedundancy(payload);
      // Narrative-control gate: strip every <system-reminder>/<ide_selection>
      // block that is not of HME origin (binary -- ours or gone).
      let prov = { stripped: 0 };
      try {
        prov = enforceReminderProvenance(payload, { ledger: loadLedger(PROJECT_ROOT) });
      } catch (err) { console.error(`reminder-provenance failed: ${err.message}`); recordProxyFailure(PROJECT_ROOT, 'reminder-provenance', err); }
      const r = stripHmePrefixOutgoing(payload);
      const n = await injectHmeTools(payload);
      sanitizePayload(payload);
      if (iw > 0 || hns.stripped > 0 || common.sanitized > 0 || b > 0 || s > 0 || prov.stripped > 0 || r || n > 0) bodyDirtiedByStrip = true;
    }

    if (isAnthropic) {
      const scan = scanMessages(payload);
      const promptText = lastUserPromptText(payload);
      const directSmoke = Boolean(
        (clientReq && clientReq.headers && clientReq.headers['x-hme-smoke-direct'] === '1')
        || /^You are running an automated HME CLI smoke test\./.test(promptText)
      );
      if (!directSmoke && lifecycleInactive('UserPromptSubmit')) {
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
  // FINAL GUARANTEE -- runs on EVERY outbound Anthropic path, including
  // passthrough (which skips the sanitize block above). No request may carry an
  if (isAnthropic && payload && Array.isArray(payload.messages)) {
    if (sanitizePayload(payload) > 0) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
  }
  return { outBody, injected, passthrough };
}

module.exports = { mutateClaudeRequest, applyExplicitOtpmCap, compactLargeInteractiveAnthropicPayload, modelOutputInfo: _modelOutputInfo };
