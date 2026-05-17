const { test } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..', '..');
const source = fs.readFileSync(path.join(repo, 'tools/HME/service/server/route_health.py'), 'utf8');

test('routing health makes stale proxy sources actionable', () => {
  assert.match(source, /proxy_stale_sources/);
  assert.match(source, /codex_proxy_stale_sources/);
  assert.match(source, /newer-than-process/);
  assert.match(source, /proxy stale sources/);
  assert.match(source, /codex_proxy stale sources/);
});

test('Claude proxy binds dual-stack localhost', () => {
  const proxySource = fs.readFileSync(path.join(repo, 'tools/HME/proxy/hme_proxy.js'), 'utf8');
  assert.match(proxySource, /host: '::'/);
  assert.match(proxySource, /ipv6Only: false/);
  assert.match(proxySource, /http:\/\/\[::1\]/);
});


test('Claude proxy imports failure classification under call-site aliases', () => {
  const claudeSource = fs.readFileSync(path.join(repo, 'tools/HME/proxy/hme_proxy_claude.js'), 'utf8');
  assert.match(claudeSource, /detectUpstreamFailure:\s*_detectUpstreamFailure/);
  assert.match(claudeSource, /alertCooldownActive:\s*_alertCooldownActive/);
});

test('routing health clears resolved autocommit epoch errors', () => {
  const code = String.raw`
from pathlib import Path
import tempfile
from server.route_health import _epoch_errors
root = Path(tempfile.mkdtemp(prefix='route-health-clear-'))
(root / 'log').mkdir(parents=True)
state = root / 'tools/HME/runtime'
state.mkdir(parents=True)
log = root / 'log/hme-codex-proxy.out'
log.write_text('''=== codex_proxy start 2026-05-17T15:00:00Z ===\n[autocommit:proxy FAIL 2026-05-17T15:02:25Z] [onRequest] git commit failed twice: VIOLATION: \${HME_RUNTIME_DIR}/metrics -- misplaced root/runtime directory\n    throw new Error(\nError: check-root-only-dirs: 1 misplaced log/metrics/tmp directory and 0 forbidden root file(s) found.\n''')
(state / 'autocommit.counter').write_text('0')
(state / 'autocommit.last-success').write_text('2026-05-17T15:03:25Z')
assert _epoch_errors(root, 'log/hme-codex-proxy.out', 'codex_proxy') == []
(state / 'autocommit.fail').write_text('still failing')
assert _epoch_errors(root, 'log/hme-codex-proxy.out', 'codex_proxy')
`;
  const proc = childProcess.spawnSync('python3', ['-c', code], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: path.join(repo, 'tools/HME/service') },
  });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
});
