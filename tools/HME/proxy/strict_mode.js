'use strict';

function strictModeValue() {
  return String(process.env.strict_mode ?? process.env.STRICT_MODE ?? process.env.HME_STRICT_MODE ?? '1').trim();
}

function isStrictMode() {
  return strictModeValue() !== '0';
}

module.exports = {
  strictModeValue,
  isStrictMode,
};
