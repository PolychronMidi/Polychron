'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const guard = require('../../proxy/codex_session_guard');
const REPO = path.resolve(__dirname, '..', '..', '..', '..');

test('codex session guard keeps newest wrapper and selects stale descendants', () => {
  const rows = [
    { pid: 10, ppid: 1, start: 100, kind: 'wrapper', session_id: 's' },
    { pid: 11, ppid: 10, start: 101, kind: 'child', session_id: 's' },
    { pid: 20, ppid: 1, start: 200, kind: 'wrapper', session_id: 's' },
    { pid: 21, ppid: 20, start: 201, kind: 'child', session_id: 's' },
  ];
  assert.deepEqual(guard.duplicatePlan(rows), [{ session_id: 's', keep: 20, kill: [10, 11], wrappers: [10, 20] }]);
});

test('omniroute recent helper reads metadata only from artifacts', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-omni-recent-'));
  const dir = path.join(home, '.omniroute', 'call_logs', '2026-05-16');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-05-16T01-02-03.000Z_a.json'), JSON.stringify({
    summary: {
      timestamp: '2026-05-16T01:02:04.000Z', method: 'POST', path: '/v1/responses', status: 200,
      requestedModel: 'codex/gpt-5.5', model: 'gpt-5.5', provider: 'codex', sourceFormat: 'openai-responses', targetFormat: 'openai-responses',
      tokens: { in: 10, out: 2, cacheRead: 7 },
    },
    requestBody: { model: 'codex/gpt-5.5', input: 'SECRET PROMPT SHOULD NOT PRINT' },
    responseBody: { _streamed: true },
  }));
  const code = `import json\nfrom omniroute_recent import recent_requests\nprint(json.dumps(recent_requests(limit=1)))`;
  const result = spawnSync('python3', ['-c', code], { env: { ...process.env, HOME: home, PYTHONPATH: path.join(REPO, 'tools', 'HME', 'scripts') }, encoding: 'utf8' });
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows[0].requested_model, 'codex/gpt-5.5');
  assert.equal(rows[0].tokens_in, 10);
  assert.equal(JSON.stringify(rows).includes('SECRET PROMPT'), false);
});
