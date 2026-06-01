// stutterRegistry.js - allow tests/plugins to register a custom stutterNotes helper

let stutterRegistryRegisteredHelper = null;

function registerHelper(fn) {
  if (typeof fn === 'function') {
    stutterRegistryRegisteredHelper = fn;
    stutterRegistryRegisteredHelper.stutterRegistryIsStutterNotesHelper = true;
    return true;
  }
  stutterRegistryRegisteredHelper = null;
  return false;
}

function getHelper() { return stutterRegistryRegisteredHelper; }

stutterRegistry = {
  registerHelper,
  getHelper
};
