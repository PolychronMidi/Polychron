'use strict';
// Child process specs. Edit here to change what the supervisor owns.
// Each spec: { name, cmd, args, env, healthUrl, startupMs, restartDelayMs, maxRestarts, callTimeoutMs }
//
// History: the HTTP shim (hme_http.py on :7734) used to be a separate child
// that held the RAG engine across stdio-MCP restarts. With the worker now
// proxy-supervised and long-lived, the shim's persistence role is moot —
// worker.py loads RAG engines directly and absorbs every shim endpoint on
// its own port (:9098). SHIM_PORT stays exported for back-compat; it now
// aliases MCP_PORT so any legacy code reading `SHIM_PORT` transparently
// reaches the worker.

const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const MCP_PORT = parseInt(process.env.HME_MCP_PORT || '9098', 10);
// Deprecated: the shim is gone. SHIM_PORT now aliases MCP_PORT.
const SHIM_PORT = MCP_PORT;

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

const CHILDREN = [
  {
    name: 'worker',
    cmd: 'python3',
    args: [path.join(MCP_DIR, 'worker.py'), '--port', String(MCP_PORT)],
    env: mcpEnv,
    healthUrl: `http://127.0.0.1:${MCP_PORT}/health`,
    startupMs: 25_000,   // worker loads RAG engines directly now — slower cold boot
    restartDelayMs: 2_000,
    maxRestarts: 20,
    callTimeoutMs: 90_000,
  },
];

module.exports = { CHILDREN, MCP_PORT, SHIM_PORT };
