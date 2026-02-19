// validators.js - shared fail-fast validation helpers

Validator = (() => {
  function assertObject(value, label) {
    if (!value || typeof value !== 'object') {
      throw new Error(`${_fromLabel()}: ${label} must be an object`);
    }
    return value;
  }

  function assertPlainObject(value, label) {
    assertObject(value, label);
    if (Array.isArray(value)) {
      throw new Error(`${_fromLabel()}: ${label} must be a plain object`);
    }
    return value;
  }

  function assertBoolean(value, label) {
    if (typeof value !== 'boolean') {
      throw new Error(`${_fromLabel()}: ${label} must be a boolean`);
    }
    return value;
  }

  function assertNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${_fromLabel()}: ${label} must be a non-empty string`);
    }
    return value;
  }

  function assertFinite(value, label) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`${_fromLabel()}: ${label} must be finite`);
    }
    return num;
  }

  function assertRange(value, min, max, label) {
    const num = assertFinite(value, label);
    if (num < min || num > max) {
      throw new Error(`${_fromLabel()}: ${label} must be in [${min}, ${max}]`);
    }
    return num;
  }

  function assertIntegerRange(value, min, max, label) {
    const num = assertFinite(value, label);
    if (!Number.isInteger(num) || num < min || num > max) {
      throw new Error(`${_fromLabel()}: ${label} must be an integer in [${min}, ${max}]`);
    }
    return num;
  }

  function assertArray(value, label) {
    if (!Array.isArray(value)) {
      throw new Error(`${_fromLabel()}: ${label} must be an array`);
    }
    return value;
  }

  function assertArrayLength(value, length, label) {
    const arr = assertArray(value, label);
    if (arr.length !== length) {
      throw new Error(`${_fromLabel()}: ${label} must have length ${length}`);
    }
    return arr;
  }

  function assertKeysPresent(obj, requiredKeys, label) {
    const target = assertPlainObject(obj, label);
    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) {
        throw new Error(`${_fromLabel()}: ${label}.${key} is required`);
      }
    }
    return target;
  }

  function assertAllowedKeys(obj, allowedSet, label) {
    const target = assertPlainObject(obj, label);
    for (const key of Object.keys(target)) {
      if (!allowedSet.has(key)) {
        throw new Error(`${_fromLabel()}: ${label}.${key} is not allowed`);
      }
    }
    return target;
  }

  function assertInSet(value, allowedSet, label) {
    if (!allowedSet.has(value)) {
      throw new Error(`${_fromLabel()}: ${label} has invalid value "${value}"`);
    }
    return value;
  }

  function _fromLabel(from) {
    if (from && String(from).length) return String(from);

    // best-effort: infer caller name from stack so missing `from` doesn't produce a useless message
    try {
      const stack = (new Error()).stack || '';
      const lines = stack.split('\n').map(l => l.trim()).filter(Boolean);
      // stack[0] = "Error", stack[1] = current fn, stack[2] = caller — prefer that
      if (lines.length >= 3) {
        const callerLine = lines[2];
        const fnMatch = callerLine.match(/at\s+([^\s(]+)\s*\(/);
        if (fnMatch && fnMatch[1]) {
          return fnMatch[1].replace(/^Object\./, '');
        }
        const fileMatch = callerLine.match(/at\s+(.+?):\d+:\d+/);
        if (fileMatch && fileMatch[1]) {
          const parts = fileMatch[1].split(/[/\\]/);
          return parts[parts.length - 1];
        }
      }
    } catch {
      /* ignore — fall through */
    }

    return 'Module';
  }

  function getEventsOrThrow(from) {
    if (typeof EventCatalog === 'undefined' || !EventCatalog || !EventCatalog.names) {
      throw new Error(`${_fromLabel(from)}: EventCatalog.names is required`);
    }
    return EventCatalog.names;
  }

  function _wrapWithFrom(fn, from) {
    const fromLabel = _fromLabel(from);
    return function wrapped(...args) {
      try {
        return fn(...args);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        const stripped = msg.replace(/^[^:]+:\s*/, '');
        throw new Error(`${fromLabel}: ${stripped}`);
      }
    };
  }

  function create(from) {
    return {
      assertObject: _wrapWithFrom(assertObject, from),
      assertPlainObject: _wrapWithFrom(assertPlainObject, from),
      assertBoolean: _wrapWithFrom(assertBoolean, from),
      assertNonEmptyString: _wrapWithFrom(assertNonEmptyString, from),
      assertFinite: _wrapWithFrom(assertFinite, from),
      assertRange: _wrapWithFrom(assertRange, from),
      assertIntegerRange: _wrapWithFrom(assertIntegerRange, from),
      assertArray: _wrapWithFrom(assertArray, from),
      assertArrayLength: _wrapWithFrom(assertArrayLength, from),
      assertKeysPresent: _wrapWithFrom(assertKeysPresent, from),
      assertAllowedKeys: _wrapWithFrom(assertAllowedKeys, from),
      assertInSet: _wrapWithFrom(assertInSet, from),
      getEventsOrThrow: (/*optional*/ ) => getEventsOrThrow(from)
    };
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
    assertInSet,
    getEventsOrThrow,
    create
  };
})();
