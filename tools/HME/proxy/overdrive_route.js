'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, loadModelsJson } = require('./shared');
const {
  omniProviderForConfigProvider, isCodexOmniTarget, omniTargetFormat, providerRequestOverrides, firstLegacyChatCandidate,
} = require('./omniroute_protocol');
const { servicePort } = require('./service_registry');
const { applyEffortParams } = require('./model_effort');
const { loadModelRouteHealth, routeSkipReason } = require('./model_route_health');

function effectiveMode(env = process.env) {
  const mode = String(env.OVERDRIVE_MODE || '0');
  return mode === '1' ? '1' : '0';
}

function messageTextForRoleDetection(message) {
  if (!message || message.role !== 'user') return '';
  const c = message.content;
  const parts = Array.isArray(c) ? c : [{ type: 'text', text: c }];
  const out = [];
  for (const p of parts) {
    if (!p || (p.type && p.type !== 'text')) continue;
    const text = typeof p.text === 'string' ? p.text : (typeof p.content === 'string' ? p.content : '');
    if (!text || text.includes('<system-reminder>') || text.includes('This session is being continued from a previous conversation')) continue;
    out.push(text);
  }
  return out.join('\n');
}

function roleFromPayload(payload, env = process.env) {
  const envRole = String(env.HME_TEAM_ROLE || '').trim().toLowerCase();
  if (envRole) return envRole;
  const msgText = (payload.messages || []).map(messageTextForRoleDetection).filter(Boolean).join('\n');
  if (/^\s*You are Blue Lead\b/m.test(msgText)) return 'blue_lead';
  if (/^\s*You are Red Lead\b/m.test(msgText)) return 'red_lead';
  if (/^\s*You are Blue Purple\b/m.test(msgText)) return 'blue_purple';
  if (/^\s*You are Red Purple\b/m.test(msgText)) return 'red_purple';
  const crew = /^\s*(crew_e[1-4]_[01])\b/m.exec(msgText);
  if (crew) return crew[1].toLowerCase();
  return 'driver';
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

function claudeModelForOverdrive(modelId) {
  const raw = String(modelId || '');
  return raw.startsWith('claude-') ? raw : '';
}

function providerPrefixedClaudeModel(modelId) {
  const raw = String(modelId || '');
  const slash = raw.indexOf('/');
  if (slash < 0) return '';
  const provider = raw.slice(0, slash).toLowerCase();
  const bare = raw.slice(slash + 1);
  if (provider !== 'anthropic' && provider !== 'claude') return '';
  return bare.startsWith('claude-') ? bare : '';
}

function providerKey(provider, env = process.env) {
  return omniProviderForConfigProvider(provider, env).replace(/_/g, '-');
}

function providerSkipSet(cfg, env = process.env) {
  const raw = cfg && cfg.providers_to_skip && Array.isArray(cfg.providers_to_skip.providers)
    ? cfg.providers_to_skip.providers : [];
  return new Set(raw.map((provider) => providerKey(provider, env)));
}

function hasOmniCredential(_model, _env = process.env) {
  return true;
}

function modelRouteKey(model, env = process.env) {
  const provider = providerKey(model && model.provider, env);
  const upstream = upstreamModelId(model);
  return provider && upstream ? `${provider}/${upstream}` : '';
}

function availableModel(model, skipSet, env = process.env, routeHealth = {}) {
  if (!model) return false;
  if (skipSet.has(providerKey(model.provider, env))) return false;
  if (!hasOmniCredential(model, env)) return false;
  return !routeSkipReason(modelRouteKey(model, env), routeHealth, env);
}

function findModelById(cfg, id) {
  const wanted = String(id || '');
  for (const tier of Object.values((cfg && cfg.tiers) || {})) {
    for (const model of (tier && tier.models) || []) {
      if (model && model.id === wanted) return model;
    }
  }
  return null;
}

function findAnthropicModelByApiId(cfg, apiModel) {
  const wanted = String(apiModel || '');
  if (!wanted) return null;
  for (const tier of Object.values((cfg && cfg.tiers) || {})) {
    for (const model of (tier && tier.models) || []) {
      if (!model || String(model.provider || '') !== 'anthropic') continue;
      if (upstreamModelId(model) === wanted) return model;
    }
  }
  return null;
}

function rankedForTier(cfg, tier, env = process.env, routeHealth = {}) {
  const skipSet = providerSkipSet(cfg, env);
  const models = ((cfg.tiers && cfg.tiers[tier] && cfg.tiers[tier].models) || [])
    .filter((m) => availableModel(m, skipSet, env, routeHealth));
  const costOrder = (cfg.ranking_rules && cfg.ranking_rules.cost_order) || ['free', 'subscription', 'usage'];
  const ranked = [];
  for (const cost of costOrder) ranked.push(...models.filter((m) => m.cost === cost).sort((a, b) => (b.tier_score || 0) - (a.tier_score || 0)));
  return { models, ranked };
}

function buildMode1Chain(payload, env = process.env, cfg = loadModelsJson(), opts = {}) {
  const role = roleFromPayload(payload, env);
  const tier = roleTier(role, modelTier(payload.model));
  const key = roleKey(role);
  const spec = key && cfg.team_role_models ? cfg.team_role_models[key] : null;
  const specTier = spec && spec.tier === 'role' ? tier : ((spec && spec.tier) || tier);
  const routeHealth = opts.routeHealth || loadModelRouteHealth(opts.projectRoot || PROJECT_ROOT);
  const base = rankedForTier(cfg, specTier, env, routeHealth);
  const skipSet = providerSkipSet(cfg, env);
  let front = [];
  if (spec && spec.source === 'manually_toprank') {
    const manual = cfg.manually_toprank || {};
    front = (key && manual[key] && manual[key].length) ? manual[key] : (manual[specTier] || []);
  }
  const frontSet = new Set(front);
  const manualModels = front.map((id) => {
    const m = findModelById(cfg, id);
    return m ? { ...m, _manual_toprank: true } : null;
  }).filter((m) => availableModel(m, skipSet, env, routeHealth));
  const chain = [
    ...manualModels,
    ...base.ranked.filter((m) => !frontSet.has(m.id) && availableModel(m, skipSet, env, routeHealth)),
  ];
  return { chain, role, tier: specTier };
}

const swapStore = require('./swap_state_store');
const { chainSignature } = swapStore;
function isManualTopActive(chain) {
  return !!(chain && chain[0] && chain[0]._manual_toprank === true);
}
function selectedIndex(chain, projectRoot = PROJECT_ROOT) {
  return swapStore.currentIndex(chain, projectRoot);
}

function upstreamModelId(model) {
  const raw = typeof model === 'string' ? model : (model && (model.api_model || model.id));
  return String(raw || '').endsWith('-go') ? String(raw).slice(0, -3) : String(raw || '');
}

function stripGo(id) { return upstreamModelId(id); }

function stripOmniUnsupportedRequestFields(payload, omniProvider) {
  if (!payload || typeof payload !== 'object') return false;
  let changed = false;
  if (payload.thinking && typeof payload.thinking === 'object') {
    const thinkingType = String(payload.thinking.type || '').toLowerCase();
    if (thinkingType === 'adaptive') {
      delete payload.thinking;
      changed = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'output_config')) {
    delete payload.output_config;
    changed = true;
  }
  return changed;
}

function applyOverdriveRoute({ payload, clientReq, clientRes, outBody, stripStaleToolResults, stripClaudeIdentity, shrinkForContext, env = process.env, projectRoot = PROJECT_ROOT, cfg = loadModelsJson() }) {
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
  const prefixedClaudeModel = payload && typeof payload.model === 'string' ? providerPrefixedClaudeModel(payload.model) : '';
  const claudeModel = payload && typeof payload.model === 'string' ? claudeModelForOverdrive(payload.model) : '';
  const requestedClaudeModel = prefixedClaudeModel || claudeModel;
  console.error(`[hme-proxy] swap-check: odMode=${requested} effective=${mode} model=${payload && payload.model ? payload.model : 'no-payload'} upstream=${!!clientReq.headers['x-hme-upstream']}`);
  if (requested !== '0' && requested !== '1') console.error(`[hme-proxy] OVERDRIVE_MODE=${requested} retired; use 0 or 1.`);
  if (mode !== '1' || !payload || clientReq.headers['x-hme-upstream']) return result;
  if (!requestedClaudeModel && !claudeModel) return result;
  if (requestedClaudeModel) {
    payload.model = requestedClaudeModel;
  }

  const zenKey = env.OPENCODE_API_KEY || '';
  result.wasStreaming = payload.stream === true;
  result.injected = true;
  let chainInfo;
  try { chainInfo = buildMode1Chain(payload, env, cfg, { projectRoot }); }
  catch (err) { console.error(`[hme-proxy] MODE=1 chain build failed: ${err.message}`); chainInfo = { chain: [], role: '', tier: modelTier(payload.model) }; }
  result.swapChain = chainInfo.chain || [];
  if (requestedClaudeModel) {
    const primary = findAnthropicModelByApiId(cfg, requestedClaudeModel) || { id: requestedClaudeModel, api_model: requestedClaudeModel, provider: 'anthropic' };
    const primaryRoute = modelRouteKey(primary, env);
    result.swapChain = [primary, ...result.swapChain.filter((m) => modelRouteKey(m, env) !== primaryRoute)];
  }
  console.error(`[hme-proxy] MODE=1 ${chainInfo.tier} chain built (role=${chainInfo.role || 'none'} model=${payload.model}): ${result.swapChain.map((m) => m.id).join(' -> ')} (${result.swapChain.length} models)`);
  if (result.swapChain.length > 0) {
    const idx = selectedIndex(result.swapChain, projectRoot);
    result.swapModel = upstreamModelId(result.swapChain[idx]);
    result.omniProvider = omniProviderForConfigProvider(result.swapChain[idx].provider || '', env);
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
    Object.assign(payload, providerRequestOverrides(result.omniProvider, env, cfg));
    stripOmniUnsupportedRequestFields(payload, result.omniProvider);
    applyEffortParams(payload, result.swapMeta, result.omniProvider);
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
    result.omniProvider = omniProviderForConfigProvider(legacy.model.provider || '', env);
    result.swapMeta = legacy.model;
  }
  applyEffortParams(payload, result.swapMeta, result.omniProvider);
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

module.exports = { effectiveMode, roleFromPayload, roleTier, roleKey, modelTier, claudeModelForOverdrive, findModelById, rankedForTier, buildMode1Chain, chainSignature, selectedIndex, isManualTopActive, upstreamModelId, modelRouteKey, applyOverdriveRoute, messageTextForRoleDetection };
