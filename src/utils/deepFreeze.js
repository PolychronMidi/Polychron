// deepFreeze.js - Recursive Object.freeze utility.
// Turns accidental mutation into immediate crash (Principle 2: Fail Fast).
// Extracted from config.js for reuse across subsystems.

deepFreeze = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach(name => {
    const val = obj[name];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  });
  return obj;
};
