// validator.js - shared fail-fast validation helpers

validator = (() => {
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

  function assertArray(value, label, checkNonEmpty = false) {
    if (!Array.isArray(value)) {
      throw new Error(`${_fromLabel()}: ${label} must be an array`);
    }
    if (checkNonEmpty && value.length === 0) {
      throw new Error(`${_fromLabel()}: ${label} must be a non-empty array`);
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

  function requireDefined(value, name, from) {
    if (value === undefined || value === null) {
      throw new Error(`${_fromLabel(from)}: ${name} is required`);
    }
    return value;
  }

  function requireFinite(value, name, from) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`${_fromLabel(from)}: ${name} must be a finite number`);
    }
    return n;
  }

  function requireType(value, type, name, from) {
    if (type === 'array') {
      if (!Array.isArray(value)) {
        throw new Error(`${_fromLabel(from)}: ${name} must be an array`);
      }
      return value;
    }

    if (typeof value !== type) {
      throw new Error(`${_fromLabel(from)}: ${name} must be of type ${type}`);
    }
    return value;
  }

  function optionalFinite(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return fallback;
  }

  function optionalType(value, type, fallback) {
    if (type === 'array') {
      if (Array.isArray(value)) return value;
      return fallback;
    }
    if (typeof value === type) return value;
    return fallback;
  }

  /**
   * Assert a manager-shaped global: defined, has expected static methods.
   * Works for both plain objects and class constructors with static members.
   * @param {unknown} mgr
   * @param {string} label
   * @param {string[]} methods - method names that must exist as functions
   */
  function assertManagerShape(mgr, label, methods) {
    if (mgr === undefined || mgr === null) {
      throw new Error(`${_fromLabel()}: ${label} is not defined`);
    }
    for (let i = 0; i < methods.length; i++) {
      const m = methods[i];
      if (typeof mgr[m] !== 'function') {
        throw new Error(`${_fromLabel()}: ${label}.${m} must be a function`);
      }
    }
    return mgr;
  }

  function requireEnum(value, allowedValues, name, from) {
    if (!allowedValues) {
      throw new Error(`${_fromLabel(from)}: allowedValues must be provided for ${name}`);
    }

    let ok = false;
    if (Array.isArray(allowedValues)) ok = allowedValues.includes(value);
    else if (allowedValues instanceof Set) ok = allowedValues.has(value);
    else if (allowedValues && typeof allowedValues === 'object') ok = Object.prototype.hasOwnProperty.call(allowedValues, value);
    else throw new Error(`${_fromLabel(from)}: allowedValues must be Array|Set|Object for ${name}`);

    if (!ok) {
      throw new Error(`${_fromLabel(from)}: ${name} has invalid value "${value}"`);
    }
    return value;
  }

  function _fromLabel(from) {
    if (from && String(from).length) return String(from);

    // best-effort: infer caller name from stack so missing `from` doesn't produce a useless message
    try {
      const stack = (new Error()).stack || '';
      const lines = stack.split('\n').map(l => l.trim()).filter(Boolean);
      // stack[0] = "Error", stack[1] = current fn, stack[2] = caller - prefer that
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
      /* ignore - fall through */
    }

    return 'Module';
  }

  function getEventsOrThrow(from) {
    if (!eventCatalog || !eventCatalog.names) {
      throw new Error(`${_fromLabel(from)}: eventCatalog.names is required`);
    }
    return eventCatalog.names;
  }

  function _wrapWithFrom(fn, from) {
    const fromLabel = _fromLabel(from);
    // Avoid rest/spread (...args) to eliminate per-call array allocation on the hot path.
    // All validator methods take at most 4 arguments.
    return function wrapped(a, b, c, d) {
      try {
        return fn(a, b, c, d);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        const stripped = msg.replace(/^[^:]+:\s*/, '');
        const enriched = new Error(`${fromLabel}: ${stripped}`);
        // Attach system snapshot (loaded after validator; safePreBoot guards pre-load calls)
        safePreBoot.call(() => systemSnapshot.enrichError(enriched));
        throw enriched;
      }
    };
  }

  function create(from) {
    return {
      assertObject: _wrapWithFrom(assertObject, from),
      assertPlainObject: _wrapWithFrom(assertPlainObject, from),
      assertBoolean: _wrapWithFrom(assertBoolean, from),
      assertNonEmptyString: _wrapWithFrom(assertNonEmptyString, from),
      assertString: _wrapWithFrom(assertNonEmptyString, from),
      assertFinite: _wrapWithFrom(assertFinite, from),
      assertRange: _wrapWithFrom(assertRange, from),
      assertIntegerRange: _wrapWithFrom(assertIntegerRange, from),
      assertArray: _wrapWithFrom(assertArray, from),
      assertArrayLength: _wrapWithFrom(assertArrayLength, from),
      assertKeysPresent: _wrapWithFrom(assertKeysPresent, from),
      assertAllowedKeys: _wrapWithFrom(assertAllowedKeys, from),
      assertInSet: _wrapWithFrom(assertInSet, from),
      requireDefined: _wrapWithFrom(requireDefined, from),
      requireFinite: _wrapWithFrom(requireFinite, from),
      optionalFinite,
      optionalType,
      assertManagerShape: _wrapWithFrom(assertManagerShape, from),
      requireType: _wrapWithFrom(requireType, from),
      requireEnum: _wrapWithFrom(requireEnum, from),
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
    requireDefined,
    requireFinite,
    optionalFinite,
    optionalType,
    assertManagerShape,
    requireType,
    requireEnum,
    getEventsOrThrow,
    create
  };
})();
