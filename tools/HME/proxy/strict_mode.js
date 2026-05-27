'use strict';

function strictModeValue() {
  return String(process.env.strict_mode ?? '1').trim();
}

function isStrictMode() {
  return strictModeValue() !== '0';
}

module.exports = {
  strictModeValue,
  isStrictMode,
};
