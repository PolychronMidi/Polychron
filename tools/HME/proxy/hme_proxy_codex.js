'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { servicePort } = require('./service_registry');
const { omniProviderForConfigProvider, omniTargetFormat } = require('./omniroute_protocol');

function upstreamModelId(model) {
  const raw = model && (model.api_model || model.id || model);
  return String(raw || '').endsWith('-go') ? String(raw).slice(0, -3) : String(raw || '');
}

function chainSignature(chain) {
  return (chain || []).map((m) => `${m.provider || ''}:${m.api_model || m.id || ''}`).join('|');
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
  const stFile = path.join(projectRoot, 'tmp', 'hme-omni-swap-state.json');
  let st = { idx: 0, ts: 0, fail: 0, chain: '' };
  try { st = JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch (_) {}
  const now = Date.now();
  const sig = chainSignature(swapChain);
  if (st.chain !== sig) st = { idx: 0, ts: 0, fail: 0, chain: sig };
  // Advance on failure; reset to start after 5min success window.
  if (st.fail > 0 || st.ts > 0 && (now - st.ts) < 300000) {
    st.idx = (st.idx + 1) % swapChain.length;
  } else {
    st.idx = 0;
  }
  st.ts = now;
  st.fail++;
  st.chain = sig;
  fs.writeFileSync(stFile, JSON.stringify(st));
  const next = swapChain[st.idx];
  const np = omniProviderForConfigProvider(next.provider || '');
  const ntf = omniTargetFormat(np);
  console.error(`[hme-proxy] MODE=${odMode} fallback: rate-limited on ${omniProvider}/${swapModel} -> advancing to ${np}/${next.id} targetFormat=${ntf} (chain pos ${st.idx}/${swapChain.length}, fail count ${st.fail})`);
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
}) {
  if (!isBlank || !isOmniRouteSwap || swapChain.length <= 1) return null;
  const stFile = path.join(projectRoot, 'tmp', 'hme-omni-swap-state.json');
  let st = { idx: 0, chain: '' };
  try { st = JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch (_) {}
  const sig = chainSignature(swapChain);
  if (st.chain !== sig) st = { idx: 0, chain: sig };
  for (let ri = 1; ri < swapChain.length; ri++) {
    const candidate = swapChain[(st.idx + ri) % swapChain.length];
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
            st.idx = (st.idx + ri) % swapChain.length;
            st.ts = Date.now();
            st.fail = 0;
            st.chain = sig;
            fs.writeFileSync(stFile, JSON.stringify(st));
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

module.exports = { recordOmniRouteFailureAdvance, retryBlankOmniRouteResponse, upstreamModelId, chainSignature };
