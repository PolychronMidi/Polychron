'use strict';
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = _hmeRequireEnv('PROJECT_ROOT');

function _payloadCwd(stdinJson) {
  try {
    const payload = JSON.parse(stdinJson || '{}');
    return typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  } catch (_) {
    // silent-ok: optional fallback path.
    return process.cwd();
  }
}

function projectHasOwnHooks(eventName, cwd, projectRoot = PROJECT_ROOT) {
  if (!eventName || !cwd) return false;
  let dir = path.resolve(cwd);
  const root = path.resolve(projectRoot);
  while (dir && dir !== path.dirname(dir)) {
    if (dir === root) return false;
    const settings = path.join(dir, '.claude', 'settings.json');
    if (fs.existsSync(settings)) {
      try {
        const data = JSON.parse(fs.readFileSync(settings, 'utf8'));
        const hooks = data.hooks && data.hooks[eventName];
        if (Array.isArray(hooks) && hooks.length > 0) return true;
      } catch (_) {
        // silent-ok: optional fallback path.
        return false;
      }
    }
    dir = path.dirname(dir);
  }
  return false;
}

function shouldSkipForNestedHooks(eventName, stdinJson, projectRoot = PROJECT_ROOT) {
  return projectHasOwnHooks(eventName, _payloadCwd(stdinJson), projectRoot);
}

module.exports = { projectHasOwnHooks, shouldSkipForNestedHooks };
