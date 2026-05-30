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

function applyShortcutCompact(payload) {
  if (!payload || !payload.__shortcut_compact || !Array.isArray(payload.messages)) return null;
  // `cc` means: run the proxy's `/compact` implementation (passthrough_compact's
  // three gears) and then send `continue`. The shortcuts middleware already
  // rewrote the visible user text from `cc` to `continue`; this function is the
  const before = serializedBytes(payload);
  const forcedThreshold = Math.max(1, Math.floor(before * 0.75));
  let changed = 0;
  if (typeof shrinkForPassthrough === 'function') {
    changed = shrinkForPassthrough(payload, {
      effectiveThreshold: () => ({
        threshold: forcedThreshold,
        maxTier: 3,
        maxToolResultAge: Number(process.env.HME_PROXY_COMPACT_SHORTCUT_STALE_TOOL_KEEP_TURNS || 0),
        toolResultByteFloor: Number(process.env.HME_PROXY_COMPACT_SHORTCUT_TOOL_RESULT_FLOOR || 1),
      }),
      route: 'shortcut-compact',
      model: payload.model || payload.target_model || payload.original_model || '',
      keepMin: 10,
    });
  }
  delete payload.__shortcut_compact;
  emit({ event: 'shortcut_compact_applied', before_bytes: before, after_bytes: serializedBytes(payload), changed });
  return changed;
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

// Claude Code autocompact prompt signature (extracted from cli binary strings).
// If a request carries this prompt, autocompact has fired despite our env-level
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

// Upstream prompt-corruption detector: user reports they never type "undefined"
// yet that string keeps appearing as the literal user message body. Source is
const _LITERAL_UNDEF_RE = /^\s*(?:<system-reminder>\s*undefined\s*<\/system-reminder>\s*)?undefined\s*$/i;
function _detectAndMarkUndefinedUserPrompt(payload) {
  if (!payload || !Array.isArray(payload.messages)) return false;
  const last = payload.messages[payload.messages.length - 1];
  if (!last || last.role !== 'user') return false;
  let corrupted = false;
  if (typeof last.content === 'string' && _LITERAL_UNDEF_RE.test(last.content)) {
    corrupted = true;
    last.content = '[HME LIFESAVER: upstream Claude Code corrupted user prompt to literal "undefined"; original user input lost. Do NOT treat this as user intent. Report the corruption and wait for the user to retry.]';
  } else if (Array.isArray(last.content)) {
    for (const b of last.content) {
      if (b && b.type === 'text' && typeof b.text === 'string' && _LITERAL_UNDEF_RE.test(b.text)) {
        corrupted = true;
        b.text = '[HME LIFESAVER: upstream Claude Code corrupted user prompt to literal "undefined"; original user input lost. Do NOT treat this as user intent. Report the corruption and wait for the user to retry.]';
      }
    }
  }
  if (corrupted) {
    try {
      const logDir = path.join(PROJECT_ROOT, 'log');
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, 'hme-lifesaver.log'),
        `[${new Date().toISOString()}] [undefined-user-prompt] last user message body was literal "undefined"; injected marker. session=${sessionKey(payload)}\n`);
    } catch (_) { /* lifesaver log best-effort */ }
  }
  return corrupted;
}

// Unparsed-tool-call recovery (the user's "continue" fix). When a tool call
// fails to parse, Claude Code injects a user-role text block with one of these
// literal strings and re-sends. Detected from real request bodies -- this is
const _PARSE_FAIL_RE = /tool call (?:was malformed and could not|could not) be parsed|retry also failed/i;

function _lastUserTextBlocks(payload) {
  const last = payload.messages[payload.messages.length - 1];
  if (!last || last.role !== 'user') return [];
  if (typeof last.content === 'string') return [last.content];
  if (Array.isArray(last.content)) {
    return last.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  }
  return [];
}

function _detectUnparsedToolCallRetry(payload) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) return false;
  const texts = _lastUserTextBlocks(payload);
  if (texts.length === 0) return false;
  // Only fire when the parse-error text is essentially the WHOLE last message
  // (the client's stand-in), not when the user merely quoted the phrase.
  const blob = texts.join('\n');
  if (!_PARSE_FAIL_RE.test(blob)) return false;
  if (blob.length > 400) return false;   // a real user message that just mentions it -> skip
  payload.messages.push({ role: 'user', content: 'continue' });
  try {
    const logDir = path.join(PROJECT_ROOT, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'hme-lifesaver.log'),
      `[${new Date().toISOString()}] [unparsed-tool-call] parse-failure text detected as last user message; injected user "continue". session=${sessionKey(payload)}\n`);
  } catch (_) { /* best-effort */ }
  return true;
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
  if (isAnthropic && _detectAndMarkUndefinedUserPrompt(payload)) {
    emit({ event: 'undefined_user_prompt_corrupted', session: sessionKey(payload) });
    outBody = Buffer.from(JSON.stringify(payload), 'utf8');
  }
  if (isAnthropic && _detectUnparsedToolCallRetry(payload)) {
    emit({ event: 'unparsed_tool_call_recovered', session: sessionKey(payload) });
    outBody = Buffer.from(JSON.stringify(payload), 'utf8');
  }
  if (isAnthropic && isInteractivePath && payload && Array.isArray(payload.messages)) {
    let compacted = 0;
    if (passthrough) compacted += shrinkForPassthrough(payload);
    compacted += compactLargeInteractiveAnthropicPayload(payload);
    const shortcutCompacted = applyShortcutCompact(payload, shrinkForPassthrough);
    compacted += shortcutCompacted;
    if (compacted > 0 || shortcutCompacted >= 0) outBody = Buffer.from(JSON.stringify(payload), 'utf8');
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
      const promptText = _lastUserPromptText(payload);
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
