// propertyExtractors.js - Shared safe property extraction helpers.

propertyExtractors = (() => {
  /**
   * @param {any} source
   * @param {string} key
   * @param {number} defaultValue
   * @returns {number}
   */
  function extractFiniteOrDefault(source, key, defaultValue) {
    if (source === null || source === undefined) return defaultValue;
    const value = source[key];
    return Number.isFinite(value) ? value : defaultValue;
  }

  /**
   * @param {any} source
   * @param {string} key
   * @param {number} defaultValue
   * @returns {number}
   */
  function extractNumberOrDefault(source, key, defaultValue) {
    if (source === null || source === undefined) return defaultValue;
    const value = source[key];
    return typeof value === 'number' ? value : defaultValue;
  }

  /**
   * @param {any} source
   * @param {string} key
   * @param {string} defaultValue
   * @returns {string}
   */
  function extractStringOrDefault(source, key, defaultValue) {
    if (source === null || source === undefined) return defaultValue;
    const value = source[key];
    return typeof value === 'string' ? value : defaultValue;
  }

  /**
   * @param {any} source
   * @param {string[]} path
   * @param {number} defaultValue
   * @returns {number}
   */
  function extractNestedNumberOrDefault(source, path, defaultValue) {
    if (!Array.isArray(path) || path.length === 0) return defaultValue;
    let current = source;
    for (let i = 0; i < path.length; i++) {
      if (current === null || current === undefined) return defaultValue;
      current = current[path[i]];
    }
    return typeof current === 'number' ? current : defaultValue;
  }

  return {
    extractFiniteOrDefault,
    extractNumberOrDefault,
    extractStringOrDefault,
    extractNestedNumberOrDefault
  };
})();
