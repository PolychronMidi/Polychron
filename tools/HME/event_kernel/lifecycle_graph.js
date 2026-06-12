'use strict';

/** Universal hook lifecycle graph. */

const { dispatchEvent } = require('./dispatcher');
const timeTravel = require('./lifecycle_time_travel');

function parseJson(raw, fallback = {}) {
  try { return JSON.parse(raw || '{}'); } catch (_err) { return fallback; }
}

function resultSummary(result = {}) {
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exit_code: Number.isInteger(result.exit_code) ? result.exit_code : 0,
  };
}

class HookLifecycleGraph {
  constructor({ root, host, event, body, payload }) {
    this.root = root;
    this.host = host || 'unknown';
    this.event = event || 'unknown';
    this.body = body || '{}';
    this.payload = payload || parseJson(this.body);
    this.thread_id = timeTravel.threadId({ host: this.host, event: this.event, payload: this.payload });
  }

  checkpoint(phase, values = {}, source = 'loop') {
    return timeTravel.checkpoint({
      root: this.root,
      host: this.host,
      event: this.event,
      payload: this.payload,
      phase,
      source,
      values: { thread_id: this.thread_id, ...values },
    });
  }

  async dispatch() {
    this.checkpoint('kernel:dispatch-start');
    const result = await dispatchEvent(this.event, this.body);
    this.checkpoint('kernel:dispatch-end', resultSummary(result));
    return result;
  }

  recordTransport(kind, result = null) {
    this.checkpoint(`transport:${kind}`, result ? resultSummary(result) : {});
  }

  recordRelay(phase, values = {}) {
    this.checkpoint(`relay:${phase}`, values);
  }
}

function createLifecycleGraph(opts) {
  return new HookLifecycleGraph(opts);
}

module.exports = { HookLifecycleGraph, createLifecycleGraph, resultSummary };
