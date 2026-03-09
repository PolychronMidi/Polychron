const CONDUCTOR_CONFIG_MERGE_NO_OVERRIDE = {};

conductorConfigMergeProfileTuning = (base, override, seen = new WeakMap()) => {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override.slice() : base.slice();
  }
  if (!base || typeof base !== 'object') {
    return override === undefined ? base : override;
  }

  const overrideKey = override && typeof override === 'object'
    ? override
    : CONDUCTOR_CONFIG_MERGE_NO_OVERRIDE;
  let seenOverrides = seen.get(base);
  if (!seenOverrides) {
    seenOverrides = new WeakMap();
    seen.set(base, seenOverrides);
  } else {
    const cached = seenOverrides.get(overrideKey);
    if (cached) {
      return cached;
    }
  }

  const result = {};
  seenOverrides.set(overrideKey, result);
  const keys = new Set([...Object.keys(base), ...Object.keys(override || {})]);
  for (const key of keys) {
    const baseValue = base[key];
    const overrideValue = override ? override[key] : undefined;
    if (overrideValue === undefined) {
      result[key] = Array.isArray(baseValue)
        ? baseValue.slice()
        : (baseValue && typeof baseValue === 'object' ? conductorConfigMergeProfileTuning(baseValue, {}, seen) : baseValue);
    } else if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
      result[key] = Array.isArray(overrideValue)
        ? overrideValue.slice()
        : (Array.isArray(baseValue) ? baseValue.slice() : overrideValue);
    } else if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
      result[key] = conductorConfigMergeProfileTuning(baseValue, overrideValue, seen);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
};
