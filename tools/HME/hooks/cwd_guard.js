'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');

function _payloadCwd(stdinJson) {
  try {
    const payload = JSON.parse(stdinJson || '{}');
    return typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  } catch (_) {
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
