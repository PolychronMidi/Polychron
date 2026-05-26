'use strict';

const { loadModelsJson } = require('./shared');
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const { requireEnvBool } = require('./shared/load_env');

function isOpenAICompatiblePath(url) {
  return /^\/v1\/(chat\/completions|responses)(?:\?|$)/.test(String(url || ''));
}

function providerSkipSet(cfg, env = process.env) {
  const out = new Set(((cfg.providers_to_skip && cfg.providers_to_skip.providers) || []).map((p) => String(p).toLowerCase()));
  for (const p of String(env.HME_SKIP_PROVIDERS || '').split(',')) if (p.trim()) out.add(p.trim().toLowerCase());
  if (out.has('anthropic')) out.add('claude');
  if (out.has('claude')) out.add('anthropic');
  return out;
}

function omniProviderFor(provider, env = process.env) {
  const raw = String(provider || '').toLowerCase();
  if (raw === 'codex') return env.HME_CODEX_OMNIROUTE_PROVIDER || 'cx';
  if (raw === 'anthropic' || raw === 'claude') return 'claude';
  if (raw === 'openrouter') return 'openrouter';
  if (raw === 'opencode-go') return 'opencode-go';
  return raw || (env.HME_OPENCODE_OMNI_PROVIDER || 'cx');
}

function modelCatalog(cfg = loadModelsJson(), env = process.env) {
  const skipped = providerSkipSet(cfg, env);
  const data = [];
  for (const [tier, spec] of Object.entries(cfg.tiers || {})) {
    for (const m of (spec && spec.models) || []) {
      const provider = String(m.provider || '').toLowerCase();
      const omniProvider = omniProviderFor(provider, env).replace(/_/g, '-');
      if (skipped.has(provider) || skipped.has(omniProvider)) continue;
      if ((provider === 'anthropic' || provider === 'claude') && (skipped.has('anthropic') || skipped.has('claude'))) continue;
      const id = String(m.id || m.api_model || '');
      if (!id) continue;
      data.push({
        id,
        object: 'model',
        owned_by: 'hme',
        name: m.name || id,
        provider,
        omni_provider: omniProvider,
        tier,
        tier_score: m.tier_score || 0,
        context_length: m.context_length || null,
        max_input_tokens: m.max_input_tokens || null,
        max_output_tokens: m.max_output_tokens || null,
        supports_tools: m.supports_tools !== false,
        supports_reasoning: /gpt|claude|deepseek|qwen|kimi|mimo/i.test(`${id} ${m.name || ''}`),
      });
    }
  }
  return data;
}

function targetModelFor(requestedModel, cfg = loadModelsJson(), env = process.env) {
  const raw = String(requestedModel || '');
  if (!raw || raw.includes('/')) return raw;
  const hit = modelCatalog(cfg, env).find((m) => m.id === raw);
  const provider = hit ? hit.omni_provider : (env.HME_OPENCODE_OMNI_PROVIDER || env.HME_CODEX_OMNIROUTE_PROVIDER || 'cx');
  return `${provider}/${raw}`;
}

let canonicalPromptCache = { mtimeMs: 0, content: null };

function loadCanonicalPrompt(root = PROJECT_ROOT) {
  const file = path.join(root, 'doc', 'templates', 'canonical-system-prompt.md');
  try {
    const stat = fs.statSync(file);
    if (canonicalPromptCache.mtimeMs === stat.mtimeMs) return canonicalPromptCache.content;
    const content = fs.readFileSync(file, 'utf8');
    canonicalPromptCache = { mtimeMs: stat.mtimeMs, content: content.trim() ? content : null };
    return canonicalPromptCache.content;
  } catch (_err) {
    canonicalPromptCache = { mtimeMs: 0, content: null };
    return null;
  }
}

function replaceOpenAISystemPrompt(payload, env = process.env) {
  if (!payload || typeof payload !== 'object') return false;
  if (!requireEnvBool('HME_REPLACE_SYSTEM_PROMPT')) return false;
  const canonical = loadCanonicalPrompt(env.PROJECT_ROOT || PROJECT_ROOT);
  if (canonical === null) return false;
  let changed = false;
  if (!Array.isArray(payload.messages) && payload.instructions !== canonical) {
    payload.instructions = canonical;
    changed = true;
  }
  if (Array.isArray(payload.messages)) {
    const before = payload.messages.length;
    payload.messages = payload.messages.filter((message) => !message || message.role !== 'system');
    if (payload.messages.length !== before) changed = true;
    payload.messages.unshift({ role: 'system', content: canonical });
    changed = true;
  }
  return changed;
}

function applyOpenAIPassthroughCompaction(payload, shrinkForPassthrough) {
  if (!payload || !Array.isArray(payload.messages)) return false;
  if (typeof shrinkForPassthrough !== 'function') return false;
  const changed = shrinkForPassthrough(payload);
  return Number(changed || 0) > 0;
}

function handleOpenAIModelsRoute(clientReq, clientRes, cfg = loadModelsJson(), env = process.env) {
  if (!/^\/v1\/models(?:\?|$)/.test(String(clientReq.url || ''))) return false;
  clientRes.writeHead(200, { 'Content-Type': 'application/json' });
  clientRes.end(JSON.stringify({ object: 'list', data: modelCatalog(cfg, env) }));
  return true;
}

function routeOpenAICompatibleThroughHme(clientReq, payload, { servicePort, env = process.env, cfg = loadModelsJson(), shrinkForPassthrough } = {}) {
  if (!isOpenAICompatiblePath(clientReq.url) || clientReq.headers['x-hme-upstream']) return false;
  let changed = replaceOpenAISystemPrompt(payload, env);
  const port = typeof servicePort === 'function' ? servicePort('omniroute') : (env.HME_OMNIROUTE_PORT || 20128);
  clientReq.headers['x-hme-upstream'] = `http://127.0.0.1:${String(port)}`;
  clientReq.headers['x-hme-host'] = clientReq.headers['x-hme-host'] || 'opencode';
  delete clientReq.headers.authorization;
  delete clientReq.headers['x-api-key'];
  if (payload && typeof payload.model === 'string' && payload.model) {
    const routed = targetModelFor(payload.model, cfg, env);
    if (routed !== payload.model) {
      payload.model = routed;
      changed = true;
    }
  }
  if (applyOpenAIPassthroughCompaction(payload, shrinkForPassthrough)) changed = true;
  return changed;
}

module.exports = {
  isOpenAICompatiblePath,
  modelCatalog,
  targetModelFor,
  replaceOpenAISystemPrompt,
  applyOpenAIPassthroughCompaction,
  handleOpenAIModelsRoute,
  routeOpenAICompatibleThroughHme,
};
