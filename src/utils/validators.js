// validators.js - shared fail-fast validation helpers

Validator = (() => {
  function assertObject(value, label) {
    if (!value || typeof value !== 'object') {
      throw new Error(`Validator: ${label} must be an object`);
    }
    return value;
  }

  function assertPlainObject(value, label) {
    assertObject(value, label);
    if (Array.isArray(value)) {
      throw new Error(`Validator: ${label} must be a plain object`);
    }
    return value;
  }

  function assertBoolean(value, label) {
    if (typeof value !== 'boolean') {
      throw new Error(`Validator: ${label} must be a boolean`);
    }
    return value;
  }

  function assertNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Validator: ${label} must be a non-empty string`);
    }
    return value;
  }

  function assertFinite(value, label) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Validator: ${label} must be finite`);
    }
    return num;
  }

  function assertRange(value, min, max, label) {
    const num = assertFinite(value, label);
    if (num < min || num > max) {
      throw new Error(`Validator: ${label} must be in [${min}, ${max}]`);
    }
    return num;
  }

  function assertIntegerRange(value, min, max, label) {
    const num = assertFinite(value, label);
    if (!Number.isInteger(num) || num < min || num > max) {
      throw new Error(`Validator: ${label} must be an integer in [${min}, ${max}]`);
    }
    return num;
  }

  function assertArray(value, label) {
    if (!Array.isArray(value)) {
      throw new Error(`Validator: ${label} must be an array`);
    }
    return value;
  }

  function assertArrayLength(value, length, label) {
    const arr = assertArray(value, label);
    if (arr.length !== length) {
      throw new Error(`Validator: ${label} must have length ${length}`);
    }
    return arr;
  }

  function assertKeysPresent(obj, requiredKeys, label) {
    const target = assertPlainObject(obj, label);
    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) {
        throw new Error(`Validator: ${label}.${key} is required`);
      }
    }
    return target;
  }

  function assertAllowedKeys(obj, allowedSet, label) {
    const target = assertPlainObject(obj, label);
    for (const key of Object.keys(target)) {
      if (!allowedSet.has(key)) {
        throw new Error(`Validator: ${label}.${key} is not allowed`);
      }
    }
    return target;
  }

  function assertInSet(value, allowedSet, label) {
    if (!allowedSet.has(value)) {
      throw new Error(`Validator: ${label} has invalid value "${value}"`);
    }
    return value;
  }

  return {
    assertObject,
    assertPlainObject,
    assertBoolean,
    assertNonEmptyString,
    assertFinite,
    assertRange,
    assertIntegerRange,
    assertArray,
    assertArrayLength,
    assertKeysPresent,
    assertAllowedKeys,
    assertInSet
  };
})();
