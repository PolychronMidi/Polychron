// regimeDispatch.js - Regime-conditional value dispatch.
// Replaces verbose ternary chains: regime === 'coherent' ? X : regime === 'exploring' ? Y : Z
// Used in 9+ files across conductor, crossLayer, rhythm subsystems.

/**
 * @param {string} regime
 * @param {number} coherentVal
 * @param {number} exploringVal
 * @param {number} [evolvingVal] - defaults to average of coherent and exploring
 * @returns {number}
 */
regimeDispatch = (regime, coherentVal, exploringVal, evolvingVal) => {
  if (regime === 'coherent') return coherentVal;
  if (regime === 'exploring') return exploringVal;
  return evolvingVal !== undefined ? evolvingVal : (coherentVal + exploringVal) / 2;
};
