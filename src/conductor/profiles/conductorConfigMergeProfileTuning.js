conductorConfigMergeProfileTuning = (base, override) => {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override.slice() : base.slice();
  }
  if (!base || typeof base !== 'object') {
    return override === undefined ? base : override;
  }

  const result = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(override || {})]);
  for (const key of keys) {
    const baseValue = base[key];
    const overrideValue = override ? override[key] : undefined;
    if (overrideValue === undefined) {
      result[key] = Array.isArray(baseValue)
        ? baseValue.slice()
        : (baseValue && typeof baseValue === 'object' ? conductorConfigMergeProfileTuning(baseValue, {}) : baseValue);
    } else if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
      result[key] = Array.isArray(overrideValue)
        ? overrideValue.slice()
        : (Array.isArray(baseValue) ? baseValue.slice() : overrideValue);
    } else if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
      result[key] = conductorConfigMergeProfileTuning(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
};
