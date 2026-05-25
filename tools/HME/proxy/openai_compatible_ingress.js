'use strict';

function isOpenAICompatiblePath(url) {
  return /^\/v1\/(chat\/completions|responses)(?:\?|$)/.test(String(url || ''));
}

function routeOpenAICompatibleThroughHme(clientReq, payload, { servicePort, env = process.env } = {}) {
  if (!isOpenAICompatiblePath(clientReq.url) || clientReq.headers['x-hme-upstream']) return false;
  const provider = env.HME_OPENCODE_OMNI_PROVIDER || env.HME_CODEX_OMNIROUTE_PROVIDER || 'cx';
  const port = typeof servicePort === 'function' ? servicePort('omniroute') : (env.HME_OMNIROUTE_PORT || 20128);
  clientReq.headers['x-hme-upstream'] = `http://127.0.0.1:${String(port)}`;
  clientReq.headers['x-hme-host'] = clientReq.headers['x-hme-host'] || 'opencode';
  if (payload && typeof payload.model === 'string' && payload.model && !payload.model.includes('/')) {
    payload.model = `${provider}/${payload.model}`;
    return true;
  }
  return false;
}

module.exports = { isOpenAICompatiblePath, routeOpenAICompatibleThroughHme };
