'use strict';

const http = require('http');
const {
  servicePort,
} = require('../../service_registry');
const { omniProviderForConfigProvider, omniTargetFormat } = require('../../omniroute_protocol');
const swapStore = require('../../swap_state_store');
function isManualTopActive(chain) { return !!(chain && chain[0] && chain[0]._manual_toprank === true); }
const { chainSignature } = swapStore;

function upstreamModelId(model) {
  const raw = model && (model.api_model || model.id || model);
  return String(raw || '').endsWith('-go') ? String(raw).slice(0, -3) : String(raw || '');
}

function recordOmniRouteFailureAdvance({
  isOmniRouteSwap,
  swapChain,
  odMode,
  omniProvider,
  swapModel,
  status,
  isRateLimit,
  projectRoot,
}) {
  console.error(`[hme-proxy] fallback probe: _isOmniRouteSwap=${isOmniRouteSwap} chainLen=${swapChain.length} _isRateLimit=${isRateLimit} status=${status}`);
  if (!isOmniRouteSwap || swapChain.length <= 1) return;
  const st = swapStore.recordFailure(swapChain, projectRoot);
  const next = swapChain[st.idx];
  const np = omniProviderForConfigProvider(next.provider || '');
  const ntf = omniTargetFormat(np);
  const failureKind = isRateLimit ? 'rate-limited' : `status=${status}`;
  console.error(`[hme-proxy] MODE=${odMode} fallback: ${failureKind} on ${omniProvider}/${swapModel} -> advancing to ${np}/${next.id} targetFormat=${ntf} (chain pos ${st.idx}/${swapChain.length}, fail count ${st.fail})`);
}

function blankRetryDisabledReason({ payload, swapChain: _swapChain, env: _env = process.env }) {
  // manually_toprank only fronts the chain; blank retry still cascades.
  if (payload && typeof payload.max_tokens === 'number' && payload.max_tokens <= 1) return 'max_tokens_probe';
  return '';
}

async function retryBlankOmniRouteResponse({
  isBlank,
  isOmniRouteSwap,
  swapChain,
  payload,
  outStatus,
  outBuf,
  outHeaders,
  projectRoot,
  env = process.env,
}) {
  if (!isBlank || !isOmniRouteSwap || swapChain.length <= 1) return null;
  const disabledReason = blankRetryDisabledReason({ payload, swapChain, env });
  if (disabledReason) {
    console.error(`[hme-proxy] BLANK retry skipped: ${disabledReason}`);
    return null;
  }
  const startIdx = swapStore.peek(projectRoot).idx || 0;
  for (let ri = 1; ri < swapChain.length; ri++) {
    const retryIdx = (startIdx + ri) % swapChain.length;
    const candidate = swapChain[retryIdx];
    const tp = omniProviderForConfigProvider(candidate.provider || '');
    const tid = upstreamModelId(candidate);
    const retryPayload = JSON.parse(JSON.stringify(payload));
    retryPayload.model = `${tp}/${tid}`;
    retryPayload.stream = false;
    if (typeof retryPayload.max_tokens !== 'number' || retryPayload.max_tokens < 200) retryPayload.max_tokens = 200;
    delete retryPayload.thinking;
    const retryBody = Buffer.from(JSON.stringify(retryPayload), 'utf8');
    console.error(`[hme-proxy] BLANK retry ${ri}/${swapChain.length - 1}: ${tp}/${tid}`);
    try {
      const retryRes = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: servicePort('omniroute'),
          path: '/v1/messages',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'content-length': String(retryBody.length) },
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.write(retryBody);
        req.end();
      });
      if (retryRes.status >= 200 && retryRes.status < 300) {
        try {
          const retryJson = JSON.parse(retryRes.body);
          const retryText = (retryJson.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          if (retryText && retryText !== '(empty response)') {
            swapStore.recordSuccess(swapChain, retryIdx, projectRoot);
            const headers = { ...outHeaders, 'content-type': 'application/json' };
            delete headers['transfer-encoding'];
            console.error(`[hme-proxy] BLANK retry OK: ${tp}/${tid} -> "${retryText.slice(0,80)}"`);
            return { outStatus: retryRes.status, outBuf: Buffer.from(retryRes.body), outHeaders: headers };
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error(`[hme-proxy] BLANK retry fail: ${err.message}`);
    }
  }
  console.error('[hme-proxy] BLANK retry exhausted all models');
  return { outStatus, outBuf, outHeaders };
}

module.exports = { recordOmniRouteFailureAdvance, retryBlankOmniRouteResponse, upstreamModelId, chainSignature, isManualTopActive, blankRetryDisabledReason };
