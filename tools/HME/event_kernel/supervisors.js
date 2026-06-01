'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch (_e) { return false; }
}

function spawnDetached(command, args, env, logFile = '') {
  const stdio = logFile
    ? ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')]
    : 'ignore';
  const child = spawn(command, args, { cwd: env.PROJECT_ROOT, env, detached: true, stdio });
  child.unref();
  return child.pid;
}

function nudgeSupervisors(root) {
  const env = { ...process.env, PROJECT_ROOT: root, CLAUDE_PROJECT_DIR: root };
  const specs = [
    {
      pidFile: path.join(root, 'tools', 'HME', 'runtime', 'proxy-supervisor.pid'),
      script: path.join(root, 'tools', 'HME', 'hooks', 'direct', 'proxy-supervisor.sh'),
    },
    {
      pidFile: path.join(root, 'tools', 'HME', 'runtime', 'universal-pulse-supervisor.pid'),
      script: path.join(root, 'tools', 'HME', 'hooks', 'direct', 'universal-pulse-supervisor.sh'),
    },
  ];
  for (const spec of specs) {
    let pid = '';
    try { pid = fs.readFileSync(spec.pidFile, 'utf8').trim(); } catch (_e) { /* no pid */ }
    if (isPidAlive(pid) || !fs.existsSync(spec.script)) continue;
    try { spawnDetached('bash', [spec.script, 'start'], env); } catch (_e) { /* non-blocking watchdog */ }
  }
}

module.exports = { nudgeSupervisors };
