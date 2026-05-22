'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function isLoopbackRequest(clientReq) {
  const remoteAddr = (clientReq.socket && clientReq.socket.remoteAddress) || '';
  return remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
}

function bodyModel(outBody) {
  if (!outBody || outBody.length === 0) return '';
  try {
    const parsed = JSON.parse(Buffer.isBuffer(outBody) ? outBody.toString('utf8') : String(outBody));
    return typeof parsed.model === 'string' ? parsed.model : '';
  } catch (_err) {
    return '';
  }
}

function shouldInjectLoopbackOauth({ clientReq, upstreamHeaders, outBody, isAnthropic, isOmniRouteSwap }) {
  if (!isAnthropic || upstreamHeaders.authorization || upstreamHeaders['x-api-key']) return false;
  if (!isLoopbackRequest(clientReq)) return false;
  if (!isOmniRouteSwap) return true;

  // Overdrive OmniRoute swaps intentionally remove client auth before forwarding
  // to the local OmniRoute service. Re-inject Claude OAuth only for Claude-family
  const model = bodyModel(outBody).toLowerCase();
  return model.startsWith('claude/') || model.startsWith('anthropic/');
}

function injectLoopbackOauth(upstreamHeaders, clientReq) {
  try {
    const credsPath = path.join(os.homedir(), '.claude/.credentials.json');
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    const token = creds && creds.claudeAiOauth && creds.claudeAiOauth.accessToken;
    if (token) {
      upstreamHeaders.authorization = `Bearer ${token}`;
      if (!upstreamHeaders['anthropic-beta']) upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
      console.error(`injected OAuth token for loopback request (path=${clientReq.url})`);
    }
  } catch (err) {
    console.error(`auth injection failed: ${err.message}`);
  }
}

function prepareUpstreamHeaders({ clientReq, upstream, outBody, isAnthropic, isOmniRouteSwap }) {
  const upstreamHeaders = { ...clientReq.headers };
  delete upstreamHeaders.host;
  delete upstreamHeaders['content-length'];
  delete upstreamHeaders['x-hme-upstream'];
  upstreamHeaders.host = upstream.host;
  if (outBody.length > 0) upstreamHeaders['content-length'] = String(outBody.length);

  if (isAnthropic) delete upstreamHeaders['accept-encoding'];

  if (isAnthropic && typeof upstreamHeaders.authorization === 'string'
      && upstreamHeaders.authorization.startsWith('Bearer ')) {
    if (!upstreamHeaders['anthropic-beta']) upstreamHeaders['anthropic-beta'] = 'oauth-2025-04-20';
  }

  if (shouldInjectLoopbackOauth({ clientReq, upstreamHeaders, outBody, isAnthropic, isOmniRouteSwap })) {
    injectLoopbackOauth(upstreamHeaders, clientReq);
  }
  return upstreamHeaders;
}

module.exports = { prepareUpstreamHeaders };
