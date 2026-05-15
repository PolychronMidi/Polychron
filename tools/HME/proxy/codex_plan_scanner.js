'use strict';

const { spawnFileInput } = require('../event_kernel/fs_ipc');

function stableCallKey(candidate, source) {
  const id = candidate.call_id || candidate.id || candidate.item_id || '';
  const args = typeof candidate.arguments === 'string'
    ? candidate.arguments
    : JSON.stringify(candidate.arguments || '');
  return `${source.thread_id || ''}:${source.turn_id || ''}:${id}:${args}`;
}

function normalizePlanPayload(args, source, nowIso) {
  const plan = args && args.plan;
  if (!Array.isArray(plan)) return null;
  return {
    plan,
    explanation: typeof args.explanation === 'string' ? args.explanation : '',
    timestamp: nowIso(),
    session_file: source.thread_id ? `codex-proxy:${source.thread_id}` : 'codex-proxy',
  };
}

function createPlanScanner(deps) {
  const seenPlanCalls = new Map();
  const loadConfig = deps.loadConfig;
  const record = deps.record;
  const nowIso = deps.nowIso;
  const planSync = deps.planSync;
  const projectRoot = deps.projectRoot;

  function rememberPlanCall(key) {
    const now = Date.now();
    seenPlanCalls.set(key, now);
    if (seenPlanCalls.size > 500) {
      for (const [k, t] of seenPlanCalls.entries()) {
        if (now - t > 60 * 60 * 1000 || seenPlanCalls.size > 500) seenPlanCalls.delete(k);
      }
    }
  }

  function syncPlanArguments(argumentsText, source, candidate) {
    const cfg = loadConfig();
    if (cfg?.todo_sync && cfg.todo_sync.enabled === false) return;
    let args;
    try {
      args = typeof argumentsText === 'string' ? JSON.parse(argumentsText || '{}') : argumentsText;
    } catch (_e) {
      return;
    }
    const payload = normalizePlanPayload(args, source, nowIso);
    if (!payload) return;
    const key = stableCallKey(candidate, source);
    if (seenPlanCalls.has(key)) return;
    rememberPlanCall(key);
    record({ kind: 'todo-sync-start', items: payload.plan.length, session_file: payload.session_file });
    spawnFileInput('python3', [planSync, 'sync-payload', '--json'], {
      input: JSON.stringify(payload),
      timeoutMs: 30_000,
      cwd: projectRoot,
      env: { PROJECT_ROOT: projectRoot },
      label: 'codex-plan-sync',
    }).then((result) => {
      if (result.exit_code === 0) {
        let parsed = null;
        try { parsed = JSON.parse(result.stdout.trim() || '{}'); } catch (_e) { parsed = null; }
        record({ kind: 'todo-sync-ok', result: parsed || result.stdout.trim().slice(0, 500) });
      } else {
        record({
          kind: 'todo-sync-failed',
          exit_code: result.exit_code,
          stderr: (result.stderr || '').slice(0, 1000),
          stdout: (result.stdout || '').slice(0, 1000),
        });
      }
    });
  }

  function maybePlanCandidate(obj, source) {
    if (!obj || typeof obj !== 'object') return;
    const name = obj.name || (obj.function && obj.function.name);
    const args = obj.arguments || obj.arguments_json || (obj.function && obj.function.arguments);
    const type = obj.type || obj.item_type || '';
    const nameLooksRight = name === 'update_plan';
    const typeLooksRight = type === 'function_call' || type === 'tool_call' || nameLooksRight;
    if (nameLooksRight && typeLooksRight && args) syncPlanArguments(args, source, obj);
  }

  function scanObjectForPlan(obj, source, seen = new Set()) {
    if (!obj || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    maybePlanCandidate(obj, source);
    if (Array.isArray(obj)) {
      for (const item of obj) scanObjectForPlan(item, source, seen);
      return;
    }
    for (const value of Object.values(obj)) scanObjectForPlan(value, source, seen);
  }

  class SsePlanScanner {
    constructor(source) {
      this.source = source;
      this.buffer = '';
      this.dataLines = [];
    }

    feed(chunk) {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const rawLine = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '') {
          this.flushEvent();
        } else if (line.startsWith('data:')) {
          this.dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    flushEvent() {
      if (!this.dataLines.length) return;
      const data = this.dataLines.join('\n');
      this.dataLines = [];
      if (!data || data === '[DONE]') return;
      try { scanObjectForPlan(JSON.parse(data), this.source); }
      catch (_e) { /* ignore non-JSON data frames */ }
    }

    finish() {
      this.flushEvent();
    }
  }

  return {
    scanObjectForPlan,
    createSseScanner: (source) => new SsePlanScanner(source),
  };
}

module.exports = { createPlanScanner };
