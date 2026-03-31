// src/crossLayer/stutterContagion.js - Cross-layer stutter infection via ATG.
// When one layer stutters, the other layer picks up a complementary stutter
// at the same ms-derived tick with decaying intensity.

/**
 * @typedef {{
 *   intensity: number,
 *   channels: number[],
 *   type: string
 * }} ContagionPayload
 */

stutterContagion = (() => {
  const V = validator.create('stutterContagion');
  const STUTTER_TYPES = new Set(['fade', 'pan', 'fx']);
  const SYNC_TOLERANCE_MS = 150;
  const BASE_DECAY = 0.6;
  const ALIGNED_DECAY = 0.35; // tighter decay = stickier when converged
  const DIVERGED_DECAY = 0.8;  // looser decay = fades faster when divergent
  const CONVERGENCE_WINDOW_MS = 2000; // look for recent convergences within this window
  const CHANNEL = 'stutterContagion';
  let cimScale = 0.5;

  /**
   * Compute adaptive decay factor based on recent convergence state.
   * @param {number} absoluteSeconds
   * @returns {number} decay factor (lower = stickier)
   */
  function getAdaptiveDecay(absoluteSeconds) {
    // Check if convergence happened recently via ATG onset channel
    const recentConvergence = L0.findClosest(
      'onset', absoluteSeconds, CONVERGENCE_WINDOW_MS / 1000
    );
    if (!recentConvergence) return BASE_DECAY;
    const dist = m.abs(recentConvergence.timeInSeconds - absoluteSeconds);
    const recency = 1 - (dist / (CONVERGENCE_WINDOW_MS / 1000));
    // Interpolate: recent convergence - ALIGNED (sticky), distant - DIVERGED (loose)
    const baseResult = BASE_DECAY + recency * (ALIGNED_DECAY - BASE_DECAY) + (1 - recency) * (DIVERGED_DECAY - BASE_DECAY) * 0.3;
    // Tempo modulation: faster tempo = tighter decay, slower = more lingering
    const tempoEntry = L0.getLast('tickDuration', {});
    const bpmScale = tempoEntry && Number.isFinite(tempoEntry.bpmScale) ? tempoEntry.bpmScale : 1.0;
    return baseResult * clamp(0.8 + bpmScale * 0.2, 0.85, 1.15);
  }

  /**
   * Post a stutter event from the active layer into ATG.
   * Call this after any stutter fires in the main loop.
   * @param {number} absoluteSeconds - absolute ms
   * @param {string} layer - source layer
   * @param {number} intensity - 0-1 normalized stutter intensity
   * @param {number[]} channels - MIDI channels that stuttered
   * @param {string} type - 'fade' | 'pan' | 'fx'
   */
  function postStutter(absoluteSeconds, layer, intensity, channels, type) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(layer, 'layer');
    const normalizedIntensity = clamp(V.requireFinite(intensity, 'intensity'), 0, 1);
    const normalizedChannels = V.assertArray(channels, 'channels');
    for (let i = 0; i < normalizedChannels.length; i++) {
      V.requireFinite(normalizedChannels[i], `channels[${i}]`);
    }
    const normalizedType = V.assertInSet(type, STUTTER_TYPES, 'type');
    L0.post(CHANNEL, layer, absoluteSeconds, {
      intensity: normalizedIntensity,
      channels: normalizedChannels,
      type: normalizedType
    });
  }

  /**
   * Check for cross-layer stutter infection. Returns null if no infection
   * should happen, otherwise returns the contagion parameters.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   * @returns {{ syncOffset: number, intensity: number, channels: number[], type: string } | null}
   */
  function checkContagion(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const match = L0.findClosest(
      CHANNEL, absoluteSeconds, SYNC_TOLERANCE_MS / 1000, activeLayer
    );
    if (!match) return null;
    V.assertObject(match, 'checkContagion.match');
    const matchIntensity = V.requireFinite(match.intensity, 'checkContagion.match.intensity');
        const matchChannels = V.assertArray(match.channels, 'checkContagion.match.channels');
    for (let i = 0; i < matchChannels.length; i++) {
      V.requireFinite(matchChannels[i], `checkContagion.match.channels[${i}]`);
    }
    const matchType = V.assertInSet(match.type, STUTTER_TYPES, 'checkContagion.match.type');

    // CIM: coordinated = stickier contagion, independent = faster decay
    const decay = getAdaptiveDecay(absoluteSeconds) * (1.3 - cimScale * 0.6);
    const decayedIntensity = matchIntensity * decay;
    if (decayedIntensity < 0.05) return null;

    // Convert the source stutter's ms to this layer's tick space
  const syncOffset = crossLayerHelpers.syncOffset(match.timeInSeconds);

    return {
      syncOffset,
      intensity: decayedIntensity,
      channels: matchChannels,
      type: matchType
    };
  }

  /**
   * Apply stutter contagion: triggers a secondary stutter on the receiving layer.
   * @param {number} absoluteSeconds - current absolute ms
   * @param {string} activeLayer - current layer
   */
  function apply(absoluteSeconds, activeLayer) {
    V.requireFinite(absoluteSeconds, 'absoluteSeconds');
    V.assertNonEmptyString(activeLayer, 'activeLayer');
    const contagion = checkContagion(absoluteSeconds, activeLayer);
    if (!contagion) return;

    // Scale stutter parameters by decayed intensity
    const numStutters = m.max(5, m.round(ri(10, 70) * contagion.intensity));
    const duration = spBeat * rf(.1, .8) * contagion.intensity;

    if (contagion.type === 'fade' && stutterFade) {
      stutterFade(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'pan' && stutterPan) {
      stutterPan(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    } else if (contagion.type === 'fx' && stutterFX) {
      stutterFX(flipBin ? flipBinT3 : flipBinF3, numStutters, duration);
    }

    // Contagion note stutter: force ghostStutter variant (most reductive)
    // to prevent dense variant cascades across layers
    const ghostFn = stutterVariants.getVariant('ghostStutter');
    if (ghostFn && contagion.intensity > 0.15) {
      const savedVariant = stutterRegistry.getHelper();
      stutterRegistry.registerHelper(ghostFn);
      const chs = flipBin ? flipBinT3 : flipBinF3;
      if (chs.length > 0) {
        const ch = chs[ri(chs.length - 1)];
        const lastNote = L0.getLast('note', { layer: activeLayer });
        if (lastNote && Number.isFinite(lastNote.midi)) {
          StutterManager.scheduleStutterForUnit({
            profile: 'reflection', channel: ch,
            note: lastNote.midi, on: absoluteSeconds,
            sustain: duration, velocity: clamp(m.round(40 * contagion.intensity), 10, 40),
            binVel: clamp(m.round(40 * contagion.intensity), 10, 40), isPrimary: false
          });
        }
      }
      stutterRegistry.registerHelper(savedVariant);
    }

    // Re-post with decayed intensity to sustain the chain across more layers
    const repostDecay = getAdaptiveDecay(absoluteSeconds);
    L0.post(CHANNEL, activeLayer, absoluteSeconds, {
      intensity: contagion.intensity * repostDecay,
      channels: contagion.channels,
      type: contagion.type
    });
  }

  function setCoordinationScale(scale) { cimScale = clamp(scale, 0, 1); }

  return { postStutter, checkContagion, apply, setCoordinationScale, reset() { cimScale = 0.5; } };
})();
crossLayerRegistry.register('stutterContagion', stutterContagion, ['all']);
