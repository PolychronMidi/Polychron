// src/crossLayer/feedbackOscillator.js - Cross-layer feedback loop oscillation.
// Layer A posts a reaction - B picks it up and posts its own reaction -
// A picks up B's reaction - etc. Each round-trip dampens the intensity,
// creating convergent rhythmic dialogues between layers.
// Pitch Memory: carries pitch-class info through the loop. When layer A
// plays a note that feeds back to B, B biases toward the complementary
// interval (e.g., A plays a 5th - B gravitates toward the tritone).

/** @type {ReadonlyArray<number>} complementary interval map: for each interval 0-11, the "answer" interval */
const COMPLEMENT_MAP = Object.freeze([6, 5, 4, 3, 8, 7, 0, 5, 4, 3, 2, 1]);

feedbackOscillator = (() => {
  const V = validator.create('feedbackOscillator');
  const CHANNEL = 'feedbackLoop';
  const SYNC_TOLERANCE_MS = 250;
  const DAMPING = 0.55;
  let cimScale = 0.5;
  const MIN_ENERGY = 0.03;
  const MAX_ROUND_TRIPS = 6;

  /**
   * Inject an initial impulse into the feedback loop.
   * Call this when a noteworthy musical event happens (e.g. accent, convergence).
   * @param {number} absoluteSeconds - absolute ms
   * @param {string} layer - source layer
   * @param {number} energy - initial energy 0-1
   * @param {string} [impulseType='accent'] - what triggered the impulse
   * @param {number} [pitchClass=-1] - MIDI pitch class 0-11 or -1 for none
   */
  function inject(absoluteSeconds, layer, energy, impulseType, pitchClass) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(layer, 'layer');
    V.requireFinite(energy, 'energy');
    const safePitchClass = /** @type {number} */ (Number.isFinite(pitchClass) ? pitchClass : -1);
    let finalImpulseType = 'accent';
    const impulseTypeMaybe = V.optionalType(impulseType, 'string');
    if (impulseTypeMaybe !== undefined) {
      finalImpulseType = V.assertNonEmptyString(impulseTypeMaybe, 'impulseType');
    }
    // Xenolinguistic: articulation shapes feedback energy character.
    // Staccato -> percussive impulses (higher energy, shorter). Legato -> sustained (lower, longer).
    const artEntry = L0.getLast(L0_CHANNELS.articulation, { layer });
    const artSustain = artEntry && Number.isFinite(artEntry.avgSustain) ? artEntry.avgSustain : 0.5;
    const artScale = artSustain > 0.7 ? 0.8 : artSustain < 0.3 ? 1.2 : 1.0;
    // R50: emergent rhythm density amplifies feedback energy (rhythmic activity = richer feedback)
    const emergentEntry = L0.getLast(L0_CHANNELS.emergentRhythm, { layer: 'both' });
    const emergentScale = emergentEntry && Number.isFinite(emergentEntry.density) ? 1.0 + clamp(emergentEntry.density * 0.3, 0, 0.15) : 1.0;
    // R57: melodic contour shapes feedback energy. Rising -> stronger resonance (ascending momentum).
    // Contrary counterpoint -> dampened (layers diverging, don't force resonance).
    // High thematic density -> slight boost (familiar material creates stronger feedback echo).
    // R87 E2: registerMigrationDir antagonism bridge with convergenceDetector -- ascending pitch center
    // amplifies feedback resonance (climbing register builds cross-layer dialogue energy).
    // Counterpart: convergenceDetector NARROWS tolerance under same signal (ascending divergence makes rhythmic unison harder).
    const melodicCtxFO = emergentMelodicEngine.getContext();
    const melodicScaleFO = melodicCtxFO
      ? (melodicCtxFO.contourShape === 'rising' ? 1.12 : melodicCtxFO.contourShape === 'falling' ? 0.90 : 1.0)
      * (melodicCtxFO.counterpoint === 'contrary' ? 0.82 : 1.0)
      * (1.0 + clamp(melodicCtxFO.thematicDensity, 0, 1) * 0.12)
      * (melodicCtxFO.registerMigrationDir === 'ascending' ? 1.10 : melodicCtxFO.registerMigrationDir === 'descending' ? 0.92 : 1.0)
      : 1.0;
    // R77 E4: channel-coherence gate -- high cross-layer coherence dampens impulse (already synchronized)
    const ccEntry = L0.getLast(L0_CHANNELS.channelCoherence, { layer: 'both' });
    const ccDamp = ccEntry && Number.isFinite(ccEntry.coherence) && ccEntry.coherence > 0.70
      ? clamp((ccEntry.coherence - 0.70) * 0.30, 0, 0.09)
      : 0;
    // R89 E3: biasStrength antagonism bridge with grooveTransfer -- confident rhythm pulse calms feedback energy
    // (groove is established; cross-layer oscillation settles as shared pulse takes hold).
    // Counterpart: grooveTransfer AMPLIFIES transfer rate under same signal (confident pulse = reliable groove = amplify).
    const biasStrengthFO = emergentEntry && Number.isFinite(emergentEntry.biasStrength) ? emergentEntry.biasStrength : 0;
    const biasScaleFO = 1.0 - clamp((biasStrengthFO - 0.30) * 0.20, 0, 0.09);
    // R92 E3: hotspots antagonism bridge with entropyRegulator -- dense active grid slots amplify feedback depth
    // (rhythmic concentration gives oscillation more signal to work with, deepening cross-layer resonance).
    // Counterpart: entropyRegulator LOWERS entropy target under same signal (concentration brings order, not chaos).
    const hotspotsFO = emergentEntry && Number.isFinite(emergentEntry.hotspots) ? emergentEntry.hotspots : 0;
    const hotspotsScaleFO = 1.0 + clamp(hotspotsFO * 0.18, 0, 0.09);
    L0.post(CHANNEL, layer, absoluteSeconds, {
      energy: clamp(energy * artScale * emergentScale * melodicScaleFO * biasScaleFO * hotspotsScaleFO * (1 - ccDamp), 0, 1),
      roundTrip: 0,
      impulseType: finalImpulseType,
      originLayer: layer,
      pitchClass: safePitchClass >= 0 ? safePitchClass % 12 : -1
    });
  }

  /**
   * Check for pending feedback from the other layer and react.
   * Each reaction dampens the energy and increments the round-trip counter.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ energy: number, roundTrip: number, impulseType: string, syncOffset: number, pitchBias: number } | null}
   */
  function react(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(activeLayer, 'activeLayer');

    const incoming = L0.findClosest(
      CHANNEL, absoluteSeconds, SYNC_TOLERANCE_MS / 1000, activeLayer
    );
    if (!incoming) return null;
    V.assertObject(incoming, 'incoming');
    if (V.optionalFinite(incoming.energy) === undefined || incoming.energy < MIN_ENERGY) return null;
    if (incoming.roundTrip >= MAX_ROUND_TRIPS) return null;

    // Modulate damping by entropy - high entropy means feedback should be stronger to create convergence
    const entropyEntry = L0.getLast(L0_CHANNELS.entropy, { layer: activeLayer });
    const entropyModulation = entropyEntry && Number.isFinite(entropyEntry.smoothed) ? clamp(1.0 + (entropyEntry.smoothed - 0.5) * 0.3, 0.85, 1.15) : 1.0;
    // CIM: coordinated = less damping (energy flows freely), independent = more
    const cimDamping = DAMPING * (1.3 - cimScale * 0.6);
    // R41: regime-responsive feedback character. Coherent = longer feedback chains
    // (less damping, energy sustains), exploring = shorter chains (more damping,
    // energy dissipates quickly). Creates regime-specific cross-layer dialogue depth.
    const fbRegime = regimeClassifier.getLastRegime();
    const regimeDamping = fbRegime === 'coherent' ? 0.90 : fbRegime === 'exploring' ? 1.15 : 1.0;
    const dampedEnergy = incoming.energy * cimDamping * entropyModulation * regimeDamping;
    if (dampedEnergy < MIN_ENERGY) return null;

    const incomingRoundTrip = V.requireFinite(incoming.roundTrip, 'react.incoming.roundTrip');
    const nextRoundTrip = incomingRoundTrip + 1;

    // Pitch Memory: compute complementary pitch-class bias
    const incomingPC = (typeof incoming.pitchClass === 'undefined')
      ? -1
      : V.requireFinite(incoming.pitchClass, 'react.incoming.pitchClass');
    const pitchBias = (incomingPC >= 0 && incomingPC < 12)
      ? (incomingPC + COMPLEMENT_MAP[incomingPC]) % 12
      : -1;

    const incomingImpulseType = (typeof incoming.impulseType === 'undefined')
      ? 'accent'
      : V.assertNonEmptyString(incoming.impulseType, 'react.incoming.impulseType');
    const incomingOriginLayer = (typeof incoming.originLayer === 'undefined')
      ? activeLayer
      : V.assertNonEmptyString(incoming.originLayer, 'react.incoming.originLayer');

    // Convert to this layer's tick space
    const syncOffset = crossLayerHelpers.syncOffset(incoming.timeInSeconds);

    // Post our reaction for the other layer to pick up (with evolved pitch)
    L0.post(CHANNEL, activeLayer, absoluteSeconds, {
      energy: dampedEnergy,
      roundTrip: nextRoundTrip,
      impulseType: incomingImpulseType,
      originLayer: incomingOriginLayer,
      pitchClass: pitchBias
    });
    // Post feedback pitch preference to L0 for pitchMemoryRecall
    if (pitchBias >= 0) L0.post(L0_CHANNELS.feedbackPitch, activeLayer, absoluteSeconds, { pitchClass: pitchBias, energy: dampedEnergy });

    return {
      energy: dampedEnergy,
      roundTrip: nextRoundTrip,
      impulseType: incomingImpulseType,
      syncOffset,
      pitchBias
    };
  }

  /**
   * Apply feedback oscillation effects based on the reaction.
   * Modulates velocity and stutter intensity based on feedback energy.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
     * @returns {{ applied: boolean, energy: number, roundTrip: number, pitchBias: number }}
   */
  function applyFeedback(absoluteSeconds, activeLayer) {
      V.requireFinite(absoluteSeconds, 'absoluteSeconds');
      V.assertNonEmptyString(activeLayer, 'activeLayer');
    const reaction = react(absoluteSeconds, activeLayer);
      if (!reaction) {
        return {
          applied: false,
          energy: 0,
          roundTrip: 0,
          pitchBias: -1
        };
      }

    // Energy decays with each round-trip - subtle micro-accents
    // The receiving layer can use reaction.energy to modulate:
    // - note velocity (boost by energy * 15%)
    // - stutter probability (energy as probability multiplier)
    // - pan width (wider stereo at higher energy)
    // Pitch Memory: pitchBias is the complementary PC the receiver should favor
    return {
      applied: true,
      energy: reaction.energy,
      roundTrip: reaction.roundTrip,
      pitchBias: reaction.pitchBias
    };
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  return { inject, react, applyFeedback, setCoordinationScale, reset() { cimScale = 0.5; } };
})();
crossLayerRegistry.register('feedbackOscillator', feedbackOscillator, ['all']);
