'use strict';
// Child process specs. Edit here to change what the supervisor owns.
// Each spec: { name, cmd, args, env, healthUrl, startupMs, restartDelayMs, maxRestarts, callTimeoutMs }

const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const MCP_PORT = parseInt(process.env.HME_MCP_PORT || '9098', 10);
const SHIM_PORT = parseInt(process.env.HME_SHIM_PORT || '7734', 10);

const PYTHONPATH = process.env.PYTHONPATH || '';
const MCP_DIR = path.join(PROJECT_ROOT, 'tools/HME/mcp');

function mcpEnv() {
  return {
    ...process.env,
    PROJECT_ROOT,
    PYTHONPATH: [MCP_DIR, PYTHONPATH].filter(Boolean).join(':'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HME_MCP_PORT: String(MCP_PORT),
  };
}

function shimEnv() {
  return {
    ...process.env,
    PROJECT_ROOT,
    PYTHONPATH: [MCP_DIR, PYTHONPATH].filter(Boolean).join(':'),
  };
}

const CHILDREN = [
  {
    name: 'shim',
    cmd: 'python3',
    args: [path.join(MCP_DIR, 'hme_http.py'), '--port', String(SHIM_PORT)],
    env: shimEnv,
    healthUrl: `http://127.0.0.1:${SHIM_PORT}/health`,
    startupMs: 8_000,    // shim loads models — give it time
    restartDelayMs: 3_000,
    maxRestarts: 10,
    callTimeoutMs: null, // no per-call timeout; shim calls are short or streaming
  },
  {
    name: 'worker',
    cmd: 'python3',
    args: [path.join(MCP_DIR, 'worker.py'), '--port', String(MCP_PORT)],
    env: mcpEnv,
    healthUrl: `http://127.0.0.1:${MCP_PORT}/health`,
    startupMs: 15_000,   // worker waits on shim before marking ready
    restartDelayMs: 2_000,
    maxRestarts: 20,
    callTimeoutMs: 90_000, // proxy-side hang guard on /tool/<name>
  },
];

module.exports = { CHILDREN, MCP_PORT, SHIM_PORT };
