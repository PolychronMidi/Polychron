// src/conductor/conductorDiagnostics.js - Diagnostics/introspection factory
// for the conductor intelligence registry. Created by conductorIntelligence
// via conductorDiagnostics.create(), which passes the private bias arrays
// so diagnostics can aggregate across all five registry buckets.

conductorDiagnostics = (() => {
  /**
   * Create a diagnostics bundle bound to the given bias arrays and collector functions.
   * @param {{ density: Array<{name:string}>, tension: Array<{name:string}>, flicker: Array<{name:string}> }} biasArrays
   * @param {{ collectDensityBias: ()=>number, collectTensionBias: ()=>number, collectFlickerModifier: ()=>number }} collectors
   * @returns {{ getContributorNames: ()=>string[], getCounts: ()=>{density:number,tension:number,flicker:number,recorders:number,stateProviders:number}, getRegistryNames: ()=>{density:string[],tension:string[],flicker:string[],recorders:string[],stateProviders:string[]}, getSignalSnapshot: ()=>Readonly<{densityProduct:number,tensionProduct:number,flickerProduct:number,stateFields:Record<string,any>,counts:{density:number,tension:number,flicker:number,recorders:number,stateProviders:number}}> }}
   */
  function create(biasArrays, collectors) {

    /** @param {Array<{name:string}>} arr @returns {string[]} colon-normalized sorted */
    function _normalizedNames(arr) {
      const out = new Set();
      for (let i = 0; i < arr.length; i++) {
        out.add(arr[i].name.split(':')[0]);
      }
      return Array.from(out).sort();
    }

    /** @param {string[]} rawNames @returns {string[]} colon-normalized sorted */
    function _normalizedRaw(rawNames) {
      const out = new Set();
      for (let i = 0; i < rawNames.length; i++) {
        out.add(rawNames[i].split(':')[0]);
      }
      return Array.from(out).sort();
    }

    /**
     * Return every unique name that has registered any contribution
     * (density, tension, flicker, recorder, or stateProvider).
     * Strips colon-suffixed variants (e.g. 'Foo:bar' -> 'Foo').
     * @returns {string[]}
     */
    function getContributorNames() {
      const raw = new Set();
      biasArrays.density.forEach(e => raw.add(e.name));
      biasArrays.tension.forEach(e => raw.add(e.name));
      biasArrays.flicker.forEach(e => raw.add(e.name));
      conductorRecorderRegistry.getNames().forEach(n => raw.add(n));
      conductorStateProviderRegistry.getNames().forEach(n => raw.add(n));
      const normalized = new Set();
      raw.forEach(n => normalized.add(n.split(':')[0]));
      return Array.from(normalized).sort();
    }

    /** @returns {{ density: number, tension: number, flicker: number, recorders: number, stateProviders: number }} */
    function getCounts() {
      return {
        density: biasArrays.density.length,
        tension: biasArrays.tension.length,
        flicker: biasArrays.flicker.length,
        recorders: conductorRecorderRegistry.getCount(),
        stateProviders: conductorStateProviderRegistry.getCount()
      };
    }

    /**
     * Get normalized contributor names for each registry bucket.
     * Colon-qualified labels are folded to base names.
     * @returns {{ density: string[], tension: string[], flicker: string[], recorders: string[], stateProviders: string[] }}
     */
    function getRegistryNames() {
      return {
        density: _normalizedNames(biasArrays.density),
        tension: _normalizedNames(biasArrays.tension),
        flicker: _normalizedNames(biasArrays.flicker),
        recorders: _normalizedRaw(conductorRecorderRegistry.getNames()),
        stateProviders: _normalizedRaw(conductorStateProviderRegistry.getNames())
      };
    }

    /**
     * Frozen snapshot of all current signal products and state fields.
     * Intended for cross-module reading (e.g., feedback loops, diagnostics).
     * @returns {Readonly<{ densityProduct: number, tensionProduct: number, flickerProduct: number, stateFields: Record<string, any>, counts: { density: number, tension: number, flicker: number, recorders: number, stateProviders: number } }>}
     */
    function getSignalSnapshot() {
      return Object.freeze({
        densityProduct: collectors.collectDensityBias(),
        tensionProduct: collectors.collectTensionBias(),
        flickerProduct: collectors.collectFlickerModifier(),
        stateFields: conductorStateProviderRegistry.collectStateFields(),
        counts: getCounts()
      });
    }

    return { getContributorNames, getCounts, getRegistryNames, getSignalSnapshot };
  }

  return { create };
})();
