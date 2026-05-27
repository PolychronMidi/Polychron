'use strict';

function strictModeValue() {
  return String(process.env.strict_mode ?? process.env.STRICT_MODE ?? process.env.HME_STRICT_MODE ?? '1').trim();
}

function isStrictMode() {
  return strictModeValue() !== '0';
}

function isQuietMode() {
  return !isStrictMode();
}

function isOpenCodeHost() {
  return process.env.HME_HOST === 'opencode'
    || process.env.OPENCODE_PROJECT_ROOT
    || process.env.HME_OPENCODE === '1';
}

module.exports = {
  strictModeValue,
  isStrictMode,
  isQuietMode,
  isOpenCodeHost,
};
