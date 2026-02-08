// StutterRegistry.js - helper registration for stutter system

let _registeredHelper = null; // function

function registerHelper(fn) {
  if (typeof fn === 'function') {
    _registeredHelper = fn;
    try { _registeredHelper._isStutterNotesHelper = true; } catch (e) { /* ignore */ }
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
