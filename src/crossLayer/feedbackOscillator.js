// src/crossLayer/feedbackOscillator.js — Cross-layer feedback loop oscillation.
// Layer A posts a reaction → B picks it up and posts its own reaction →
// A picks up B's reaction → etc. Each round-trip dampens the intensity,
// creating convergent rhythmic dialogues between layers.
// Pitch Memory: carries pitch-class info through the loop. When layer A
// plays a note that feeds back to B, B biases toward the complementary
// interval (e.g., A plays a 5th → B gravitates toward the tritone).

/** @type {ReadonlyArray<number>} complementary interval map: for each interval 0-11, the "answer" interval */
const COMPLEMENT_MAP = Object.freeze([6, 5, 4, 3, 8, 7, 0, 5, 4, 3, 2, 1]);

FeedbackOscillator = (() => {
  const V = Validator.create('FeedbackOscillator');
  const CHANNEL = 'feedbackLoop';
  const SYNC_TOLERANCE_MS = 250;
  const DAMPING = 0.55;
  const MIN_ENERGY = 0.03;
  const MAX_ROUND_TRIPS = 6;

  /**
   * Inject an initial impulse into the feedback loop.
   * Call this when a noteworthy musical event happens (e.g. accent, convergence).
   * @param {number} absTimeMs - absolute ms
   * @param {string} layer - source layer
   * @param {number} energy - initial energy 0-1
   * @param {string} [impulseType='accent'] - what triggered the impulse
   * @param {number} [pitchClass=-1] - MIDI pitch class 0-11 or -1 for none
   */
  function inject(absTimeMs, layer, energy, impulseType, pitchClass) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.assertNonEmptyString(layer, 'layer');
    V.requireFinite(energy, 'energy');
    const safePitchClass = (typeof pitchClass === 'number' && Number.isFinite(pitchClass))
      ? pitchClass
      : -1;
    let finalImpulseType = 'accent';
    if (typeof impulseType !== 'undefined') {
      V.assertNonEmptyString(impulseType, 'impulseType');
      finalImpulseType = impulseType;
    }
    AbsoluteTimeGrid.post(CHANNEL, layer, absTimeMs, {
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
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ energy: number, roundTrip: number, impulseType: string, syncTick: number, pitchBias: number } | null}
   */
  function react(absTimeMs, activeLayer) {
    V.requireFinite(absTimeMs, 'absTimeMs');
    V.assertNonEmptyString(activeLayer, 'activeLayer');

    const incoming = AbsoluteTimeGrid.findClosest(
      CHANNEL, absTimeMs, SYNC_TOLERANCE_MS, activeLayer
    );
    if (!incoming) return null;
    if (typeof incoming !== 'object') {
      throw new Error('FeedbackOscillator.react: AbsoluteTimeGrid.findClosest must return object|null');
    }
    if (!Number.isFinite(incoming.energy) || incoming.energy < MIN_ENERGY) return null;
    if (incoming.roundTrip >= MAX_ROUND_TRIPS) return null;

    const dampedEnergy = incoming.energy * DAMPING;
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
    const incomingTimeMs = V.requireFinite(incoming.timeMs, 'react.incoming.timeMs');

    // Convert to this layer's tick space
    V.requireFinite(measureStart, 'measureStart');
    V.requireFinite(measureStartTime, 'measureStartTime');
    V.requireFinite(tpSec, 'tpSec');
    const syncTickRaw = Math.round(measureStart + ((incomingTimeMs / 1000) - measureStartTime) * tpSec);
    const syncTick = Math.max(0, syncTickRaw);

    // Post our reaction for the other layer to pick up (with evolved pitch)
    AbsoluteTimeGrid.post(CHANNEL, activeLayer, absTimeMs, {
      energy: dampedEnergy,
      roundTrip: nextRoundTrip,
      impulseType: incomingImpulseType,
      originLayer: incomingOriginLayer,
      pitchClass: pitchBias
    });

    return {
      energy: dampedEnergy,
      roundTrip: nextRoundTrip,
      impulseType: incomingImpulseType,
      syncTick,
      pitchBias
    };
  }

  /**
   * Apply feedback oscillation effects based on the reaction.
   * Modulates velocity and stutter intensity based on feedback energy.
   * @param {number} absTimeMs - current absolute ms
   * @param {string} activeLayer - current layer
     * @returns {{ applied: boolean, energy: number, roundTrip: number, pitchBias: number }}
   */
  function applyFeedback(absTimeMs, activeLayer) {
      V.requireFinite(absTimeMs, 'absTimeMs');
      V.assertNonEmptyString(activeLayer, 'activeLayer');
    const reaction = react(absTimeMs, activeLayer);
      if (!reaction) {
        return {
          applied: false,
          energy: 0,
          roundTrip: 0,
          pitchBias: -1
        };
      }

    // Energy decays with each round-trip → subtle micro-accents
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

  return { inject, react, applyFeedback };
})();
