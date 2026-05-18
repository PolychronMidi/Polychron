'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, loadModelsJson } = require('./shared');
const {
  omniProviderForConfigProvider, isCodexOmniTarget, omniTargetFormat, firstLegacyChatCandidate,
} = require('./omniroute_protocol');
const { servicePort } = require('./service_registry');
const { applyEffortParams } = require('./model_effort');

function effectiveMode(env = process.env) {
  const mode = String(env.OVERDRIVE_MODE || '0');
  return mode === '1' ? '1' : '0';
}

function roleFromPayload(payload, env = process.env) {
  const msgText = (payload.messages || []).map((m) => {
    const c = m && m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((p) => (p && (p.text || p.content)) || '').join('\n');
    return '';
  }).join('\n');
  if (msgText.includes('You are Blue Lead')) return 'blue_lead';
  if (msgText.includes('You are Red Lead')) return 'red_lead';
  if (msgText.includes('You are Blue Purple')) return 'blue_purple';
  if (msgText.includes('You are Red Purple')) return 'red_purple';
  const crew = /\bcrew_e[1-4]_[01]\b/.exec(msgText);
  return (crew ? crew[0] : (env.HME_TEAM_ROLE || '')).toLowerCase();
}

function roleTier(role, modelTier) {
  if (['driver', 'blue_lead', 'red_lead', 'team_lead'].includes(role)) return 'E5';
  if (['blue_purple', 'red_purple', 'team_purple'].includes(role)) return 'E4';
  const crew = /^crew_e([1-4])/.exec(role);
  return crew ? `E${crew[1]}` : modelTier;
}

function roleKey(role) {
  if (role === 'driver') return 'driver';
  if (['blue_lead', 'red_lead', 'team_lead'].includes(role)) return 'team_lead';
  if (['blue_purple', 'red_purple', 'team_purple'].includes(role)) return 'team_purple';
  if (role.startsWith('crew_') || role === 'stage_crew') return 'stage_crew';
  return '';
}

function modelTier(modelId) {
  const model = String(modelId || '').toLowerCase();
  if (model.includes('opus')) return 'E5';
  if (model.includes('sonnet')) return 'E4';
  if (model.includes('haiku')) return 'E2';
  return 'E5';
}

function rankedForTier(cfg, tier) {
  const models = (cfg.tiers && cfg.tiers[tier] && cfg.tiers[tier].models) || [];
  const costOrder = (cfg.ranking_rules && cfg.ranking_rules.cost_order) || ['free', 'subscription', 'usage'];
  const ranked = [];
  for (const cost of costOrder) ranked.push(...models.filter((m) => m.cost === cost).sort((a, b) => (b.tier_score || 0) - (a.tier_score || 0)));
  return { models, ranked };
}

function buildMode1Chain(payload, env = process.env, cfg = loadModelsJson()) {
  const role = roleFromPayload(payload, env);
  const tier = roleTier(role, modelTier(payload.model));
  const key = roleKey(role);
  const spec = key && cfg.team_role_models ? cfg.team_role_models[key] : null;
  const specTier = spec && spec.tier === 'role' ? tier : ((spec && spec.tier) || tier);
  const base = rankedForTier(cfg, specTier);
  let front = [];
  if (spec && spec.source === 'manually_toprank') front = (cfg.manually_toprank && cfg.manually_toprank[specTier]) || [];
  const frontSet = new Set(front);
  const chain = [
    ...front.map((id) => base.models.find((m) => m.id === id)).filter(Boolean),
    ...base.ranked.filter((m) => !frontSet.has(m.id)),
  ];
  return { chain, role, tier: specTier };
}

function stateFile(projectRoot = PROJECT_ROOT) { return path.join(projectRoot, 'tmp', 'hme-omni-swap-state.json'); }
function selectedIndex(chain, projectRoot = PROJECT_ROOT) {
  if (!chain.length) return 0;
  try {
    const st = JSON.parse(fs.readFileSync(stateFile(projectRoot), 'utf8'));
    return Math.min(st.idx || 0, chain.length - 1);
  } catch (_err) { return 0; }
}

function upstreamModelId(model) {
  const raw = typeof model === 'string' ? model : (model && (model.api_model || model.id));
  return String(raw || '').endsWith('-go') ? String(raw).slice(0, -3) : String(raw || '');
}

function stripGo(id) { return upstreamModelId(id); }

function applyOverdriveRoute({ payload, clientReq, clientRes, outBody, stripStaleToolResults, stripClaudeIdentity, shrinkForContext, env = process.env, projectRoot = PROJECT_ROOT }) {
  const requested = String(env.OVERDRIVE_MODE || '0');
  const mode = effectiveMode(env);
  const result = {
    applied: false,
    ended: false,
    outBody,
    injected: false,
    wasStreaming: false,
    isLegacySwap: false,
    isOmniRoute: false,
    swapChain: [],
    swapModel: 'deepseek-v4-pro',
    omniProvider: 'opencode-go',
    mode,
    requestedMode: requested,
    lastPayloadBytes: 0,
  };
  console.error(`[hme-proxy] swap-check: odMode=${requested} effective=${mode} model=${payload && payload.model ? payload.model : 'no-payload'} upstream=${!!clientReq.headers['x-hme-upstream']}`);
  if (requested !== '0' && requested !== '1') console.error(`[hme-proxy] OVERDRIVE_MODE=${requested} retired; use 0 or 1.`);
  if (mode !== '1' || !payload || typeof payload.model !== 'string' || !payload.model.startsWith('claude-') || clientReq.headers['x-hme-upstream']) return result;

  const zenKey = env.OPENCODE_API_KEY || '';
  if (!zenKey) {
    console.error('[hme-proxy] OVERDRIVE_MODE=1 active but OPENCODE_API_KEY missing -- swap skipped');
    return result;
  }
  result.wasStreaming = payload.stream === true;
  result.injected = true;
  let chainInfo;
  try { chainInfo = buildMode1Chain(payload, env); }
  catch (err) { console.error(`[hme-proxy] MODE=1 chain build failed: ${err.message}`); chainInfo = { chain: [], role: '', tier: modelTier(payload.model) }; }
  result.swapChain = chainInfo.chain || [];
  console.error(`[hme-proxy] MODE=1 ${chainInfo.tier} chain built (role=${chainInfo.role || 'none'} model=${payload.model}): ${result.swapChain.map((m) => m.id).join(' -> ')} (${result.swapChain.length} models)`);
  if (result.swapChain.length > 0) {
    const idx = selectedIndex(result.swapChain, projectRoot);
    result.swapModel = upstreamModelId(result.swapChain[idx]);
    result.omniProvider = omniProviderForConfigProvider(result.swapChain[idx].provider || '');
    result.swapMeta = result.swapChain[idx];
  }
  result.swapModel = upstreamModelId(result.swapModel);
  if (env.HME_OMNIROUTE_PROVIDER) result.omniProvider = env.HME_OMNIROUTE_PROVIDER;

  if (env.HME_OMNIROUTE_OFF !== '1') {
    const targetFormat = omniTargetFormat(result.omniProvider);
    console.error(`[hme-proxy] swap pre-omni: chainLen=${result.swapChain.length} model=${result.swapModel} provider=${result.omniProvider} targetFormat=${targetFormat}`);
    try { stripStaleToolResults(payload); stripClaudeIdentity(payload); }
    catch (err) { console.error(`[hme-proxy] OmniRoute payload strip failed: ${err.message}`); }
    if (typeof shrinkForContext === 'function') {
      try { shrinkForContext(payload, result.swapModel); }
      catch (err) { console.error(`[hme-proxy] OmniRoute context preflight failed: ${err.message}`); }
    }
    payload.model = `${result.omniProvider}/${result.swapModel}`;
    try { result.outBody = Buffer.from(JSON.stringify(payload), 'utf8'); }
    catch (err) {
      console.error(`[hme-proxy] OmniRoute payload serialize failed: ${err.message} (len=${JSON.stringify(payload).length}B)`);
      result.outBody = Buffer.from(JSON.stringify({ model: payload.model, messages: payload.messages.slice(-50), system: payload.system, stream: payload.stream, max_tokens: payload.max_tokens }), 'utf8');
    }
    result.lastPayloadBytes = result.outBody.length;
    clientReq.headers['x-hme-upstream'] = `http://127.0.0.1:${String(servicePort('omniroute'))}`;
    delete clientReq.headers.authorization;
    delete clientReq.headers['x-api-key'];
    result.isOmniRoute = true;
    result.applied = true;
    console.error(`[hme-proxy] MODE=1 OmniRoute: claude-* -> ${result.omniProvider}/${result.swapModel} via ${clientReq.headers['x-hme-upstream']} targetFormat=${targetFormat} (stream=${result.wasStreaming} msgs=${payload.messages.length} sys=${(payload.system || '').length}B tools=${(payload.tools || []).length})`);
    return result;
  }

  if (isCodexOmniTarget(result.omniProvider)) {
    const startIdx = result.swapChain.findIndex((m) => m && m.id === result.swapModel);
    const legacy = firstLegacyChatCandidate(result.swapChain, startIdx < 0 ? 0 : startIdx);
    if (!legacy) {
      clientRes.writeHead(503, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'omniroute_required', message: 'Codex targets require OmniRoute openai-responses; legacy chat translation is blocked.' }));
      result.ended = true;
      return result;
    }
    console.error(`[hme-proxy] MODE=1 legacy: skipping Codex responses target ${result.omniProvider}/${result.swapModel}; chat translator requires non-Codex target`);
    result.swapModel = upstreamModelId(legacy.model);
    result.omniProvider = omniProviderForConfigProvider(legacy.model.provider || '');
  }
  const { translateRequestToOpenAI } = require('./zen_translator');
  const oaPayload = translateRequestToOpenAI(payload, result.swapModel);
  clientReq.headers['x-hme-upstream'] = 'https://opencode.ai/zen/go';
  clientReq.headers.authorization = `Bearer ${zenKey}`;
  clientReq.headers['x-api-key'] = zenKey;
  clientReq.url = '/v1/chat/completions';
  result.outBody = Buffer.from(JSON.stringify(oaPayload), 'utf8');
  result.isLegacySwap = true;
  result.applied = true;
  console.error(`[hme-proxy] MODE=1 legacy: claude-* -> ${result.swapModel} via Zen Go /v1/chat/completions (tools=${(oaPayload.tools || []).length}, stream=${result.wasStreaming})`);
  return result;
}

module.exports = { effectiveMode, roleFromPayload, roleTier, roleKey, modelTier, rankedForTier, buildMode1Chain, upstreamModelId, applyOverdriveRoute };
