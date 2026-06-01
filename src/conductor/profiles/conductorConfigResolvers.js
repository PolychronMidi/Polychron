// conductorConfigResolvers.js - Journey FX modulation and noise profile resolution.
// Extracted from conductorConfig to keep the profile hub focused on accessor dispatch.

/**
 * @param {Object} deps
 * @param {Function} deps.getProfileTuning - returns the active profile tuning object
 * @returns {{ getJourneyFxModulation: Function, getNoiseProfileForSection: Function }}
 */
conductorConfigResolvers = function({ getProfileTuning }) {
  const V = validator.create('conductorConfigResolvers');

  /**
   * Compute FX modulation scalars based on current journey stop (or an override).
   * @param {{distance?:number,move?:string}|undefined} [stopOverride]
   * @returns {{reverbScale:number,filterScale:number,portamentoScale:number}}
   */
  function getJourneyFxModulation(stopOverride) {
    const profileTuning = getProfileTuning();
    const tuning = profileTuning.journeyFx;

    /** @type {{distance?:number,move?:string}|null} */
    let stop = V.optionalType(stopOverride, 'object', null);
    if (!stop) {
      V.requireFinite(sectionIndex, 'sectionIndex');
      const maybe = harmonicJourney.getStop(Number(sectionIndex));
      if (!maybe) throw new Error('conductorConfigResolvers.getJourneyFxModulation: harmonicJourney.getStop returned invalid stop object');
      V.assertObject(maybe, 'maybe');
      stop = maybe;
    }

    const distanceDivisor = V.assertRange(tuning.distanceDivisor, 0.1, 64, 'conductorConfigResolvers.journeyFx.distanceDivisor');
    const reverbMaxBoost = V.assertRange(tuning.reverbMaxBoost, 0, 2, 'conductorConfigResolvers.journeyFx.reverbMaxBoost');
    const filterMaxBoost = V.assertRange(tuning.filterMaxBoost, 0, 2, 'conductorConfigResolvers.journeyFx.filterMaxBoost');
    const returnHomePortamentoBoost = V.assertRange(tuning.returnHomePortamentoBoost, 0, 2, 'conductorConfigResolvers.journeyFx.returnHomePortamentoBoost');
    const returnHomeReverbDamp = V.assertRange(tuning.returnHomeReverbDamp, 0.1, 2, 'conductorConfigResolvers.journeyFx.returnHomeReverbDamp');

    const s = /** @type {{distance?:number,move?:string}} */ (stop);
    const distance = V.assertRange(Number(s.distance), 0, 64, 'conductorConfigResolvers.getJourneyFxModulation.stop.distance');
    const move = V.assertNonEmptyString(s.move, 'conductorConfigResolvers.getJourneyFxModulation.stop.move');
    const distanceFactor = clamp(distance / distanceDivisor, 0, 1);

    const baseReverbScale = 1 + distanceFactor * reverbMaxBoost;
    const reverbScale = move === 'return-home'
      ? clamp(baseReverbScale * returnHomeReverbDamp, 0.4, 2)
      : clamp(baseReverbScale, 0.4, 2);

    return {
      reverbScale,
      filterScale: clamp(1 + distanceFactor * filterMaxBoost, 0.4, 2),
      portamentoScale: move === 'return-home'
        ? clamp(1 + returnHomePortamentoBoost, 0.4, 2)
        : 1
    };
  }

  /**
   * Resolve noise profile by section phase for conductor-coherent timbral movement.
   * @param {string|undefined} [sectionPhaseOverride]
   * @returns {string}
   */
  function getNoiseProfileForSection(sectionPhaseOverride) {
    const tuning = getProfileTuning();
    const mapping = tuning.noiseProfileByPhase;
    V.assertPlainObject(mapping, 'conductorConfigResolvers.noiseProfileByPhase');
    const defaultProfile = V.assertNonEmptyString(mapping.default, 'conductorConfigResolvers.noiseProfileByPhase.default');

    const sectionPhase = (typeof sectionPhaseOverride === 'string' && sectionPhaseOverride.length > 0)
      ? sectionPhaseOverride
      : harmonicContext.getField('sectionPhase');

    const selected = Object.prototype.hasOwnProperty.call(mapping, sectionPhase)
      ? V.assertNonEmptyString(mapping[sectionPhase], `conductorConfigResolvers.noiseProfileByPhase.${sectionPhase}`)
      : defaultProfile;
    if (NOISE_PROFILES) {
      if (!Object.prototype.hasOwnProperty.call(NOISE_PROFILES, selected)) {
        throw new Error(`conductorConfigResolvers.getNoiseProfileForSection: unknown noise profile "${selected}"`);
      }
    }
    return selected;
  }

  return { getJourneyFxModulation, getNoiseProfileForSection };
};
