'use strict';

function writeAnthropicStopSse(clientRes, model) {
  clientRes.write('event: message_start\n');
  clientRes.write(`data: {"type":"message_start","message":{"id":"proxy_${Date.now()}","type":"message","role":"assistant","content":[],"model":"${model}","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`);
  clientRes.write('event: content_block_start\n');
  clientRes.write('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
  clientRes.write('event: message_delta\n');
  clientRes.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n');
  clientRes.write('event: message_stop\n');
  clientRes.write('data: {"type":"message_stop"}\n\n');
}

function handleLegacySwapResponse({ upstreamRes, clientRes, wasStreaming, releaseOpusSlot, model = 'deepseek-v4-pro' }) {
  const { ZenSseTranslator, translateNonStreamResponseToAnthropic } = require('./zen_translator');
  if (upstreamRes.statusCode === 401 || upstreamRes.statusCode === 403) {
    console.error(`legacy swap auth failure: upstream returned ${upstreamRes.statusCode}; faking success to protect session.`);
    clientRes.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    writeAnthropicStopSse(clientRes, model);
    clientRes.end();
    return true;
  }
  if (wasStreaming) {
    const translator = new ZenSseTranslator({ model });
    let sentStop = false;
    let sentStart = false;
    let injectedThinking = false;
    clientRes.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    upstreamRes.on('data', (c) => {
      const translated = translator.feed(c);
      if (!translated) return;
      let output = translated;
      if (!injectedThinking && output.includes('message_start')) {
        injectedThinking = true;
        output = output.replace(/("type":"message_start".*?\n\n)/, '$1event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"DeepSeek reasoning..."}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
      }
      output = output.replace(/"index":(\d+)/g, (_match, p1) => `"index":${parseInt(p1, 10) + 1}`);
      if (!output.trim()) return;
      if (output.includes('message_start')) sentStart = true;
      if (output.includes('message_stop')) sentStop = true;
      clientRes.write(output.endsWith('\n\n') ? output : `${output}\n\n`);
    });
    upstreamRes.on('end', () => {
      if (!sentStart) {
        clientRes.write('event: message_start\n');
        clientRes.write(`data: {"type":"message_start","message":{"id":"proxy_${Date.now()}","type":"message","role":"assistant","content":[],"model":"${model}","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`);
      }
      if (!sentStop) {
        clientRes.write('event: message_delta\n');
        clientRes.write('data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n');
        clientRes.write('event: message_stop\n');
        clientRes.write('data: {"type":"message_stop"}\n\n');
      }
      clientRes.end();
      releaseOpusSlot();
    });
    upstreamRes.on('error', () => {
      releaseOpusSlot();
      try { clientRes.end(); } catch (_err) { /* already closed */ }
    });
    return true;
  }
  const chunks = [];
  upstreamRes.on('data', (c) => chunks.push(c));
  upstreamRes.on('end', () => {
    const buf = Buffer.concat(chunks).toString('utf8');
    let oaBody;
    try { oaBody = JSON.parse(buf); } catch (_err) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'zen response parse failed', raw: buf.slice(0, 500) }));
      releaseOpusSlot();
      return;
    }
    const anthropicBody = translateNonStreamResponseToAnthropic(oaBody, model);
    const body = JSON.stringify(anthropicBody);
    clientRes.writeHead(upstreamRes.statusCode || 200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    clientRes.end(body);
    releaseOpusSlot();
  });
  return true;
}

module.exports = { handleLegacySwapResponse, writeAnthropicStopSse };
