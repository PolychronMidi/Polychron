const { rewriteStopHookText, STOP_HOOK_REWRITERS } = require('../proxy/sse_stop_hook_rewriters');
const { assertUniversalEvent } = require('./universal_event');

function evaluateStreamTextBlock(eventInput, options = {}) {
  const event = assertUniversalEvent(eventInput);
  if (event.phase !== 'stream.text_block') return { decision: { kind: 'allow' }, latencyMs: 0 };
  const started = Date.now();
  const text = event.stream && typeof event.stream.text === 'string' ? event.stream.text : '';
  const rewritten = rewriteStopHookText(text, options.ctx || {}, options.slot || null);
  const latencyMs = Date.now() - started;
  if (rewritten === text) return { decision: { kind: 'allow' }, latencyMs };
  if (rewritten.trim() === '') return { decision: { kind: 'drop', target: 'stream.block', reason: 'universal stream text block removed' }, latencyMs };
  return { decision: { kind: 'rewrite', target: 'stream.text', text: rewritten, reason: 'universal stream text block rewritten' }, latencyMs };
}

const streamTextBlockPolicy = Object.freeze({
  name: 'hme-stream-text-block-rewriters',
  trust: 'kernel',
  phases: ['stream.text_block'],
  capabilities: { decisions: ['allow', 'drop', 'rewrite'], targets: { drop: ['stream.block'], rewrite: ['stream.text'] } },
  async handler(event, options = {}) {
    return evaluateStreamTextBlock(event, options).decision;
  },
});

module.exports = { STOP_HOOK_REWRITERS, evaluateStreamTextBlock, streamTextBlockPolicy };
