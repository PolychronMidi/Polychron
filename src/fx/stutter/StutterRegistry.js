// StutterRegistry.js - allow tests/plugins to register a custom stutterNotes helper

let _registeredHelper = null;

function registerHelper(fn) {
  if (typeof fn === 'function') {
    _registeredHelper = fn;
    _registeredHelper._isStutterNotesHelper = true;
    return true;
  }
  _registeredHelper = null;
  return false;
}

function getHelper() { return _registeredHelper; }

StutterRegistry = {
  registerHelper,
  getHelper
};
