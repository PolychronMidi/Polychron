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
    const safePitchClass = (typeof pitchClass === 'number' && Number.isFinite(pitchClass))
      ? pitchClass
      : -1;
    let finalImpulseType = 'accent';
    const impulseTypeMaybe = V.optionalType(impulseType, 'string');
    if (impulseTypeMaybe !== undefined) {
      finalImpulseType = V.assertNonEmptyString(impulseTypeMaybe, 'impulseType');
    }
    L0.post(CHANNEL, layer, absoluteSeconds, {
      energy: clamp(energy, 0, 1),
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
    if (!Number.isFinite(incoming.energy) || incoming.energy < MIN_ENERGY) return null;
    if (incoming.roundTrip >= MAX_ROUND_TRIPS) return null;

    // Modulate damping by entropy - high entropy means feedback should be stronger to create convergence
    const entropyEntry = L0.getLast('entropy', { layer: activeLayer });
    const entropyModulation = entropyEntry && Number.isFinite(entropyEntry.smoothed) ? clamp(1.0 + (entropyEntry.smoothed - 0.5) * 0.3, 0.85, 1.15) : 1.0;
    // CIM: coordinated = less damping (energy flows freely), independent = more
    const cimDamping = DAMPING * (1.3 - cimScale * 0.6);
    // R41: regime-responsive feedback character. Coherent = longer feedback chains
    // (less damping, energy sustains), exploring = shorter chains (more damping,
    // energy dissipates quickly). Creates regime-specific cross-layer dialogue depth.
    const fbRegime = safePreBoot.call(() => regimeClassifier.getLastRegime(), 'evolving');
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
    if (pitchBias >= 0) L0.post('feedbackPitch', activeLayer, absoluteSeconds, { pitchClass: pitchBias, energy: dampedEnergy });

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
