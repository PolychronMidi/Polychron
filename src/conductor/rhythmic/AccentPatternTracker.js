// src/conductor/AccentPatternTracker.js - Tracks velocity accent patterns relative to metric position.
// Detects accent ruts (always downbeat emphasis, or no accents at all).
// Pure query API â€” biases velocity curves for variety.

AccentPatternTracker = (() => {
  const V = Validator.create('accentPatternTracker');
  const WINDOW_SECONDS = 4;

  /**
   * Analyze accent distribution across metric positions.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @param {number} [opts.windowSeconds]
   * @returns {{ downbeatRatio: number, backbeatRatio: number, offbeatRatio: number, accentShape: string }}
   */
  function getAccentProfile(opts = {}) {
    const { layer, windowSeconds } = opts;
    const ws = V.optionalFinite(windowSeconds, WINDOW_SECONDS);
    const notes = AbsoluteTimeWindow.getNotes({ layer, windowSeconds: ws });
    if (notes.length < 4) {
      return { downbeatRatio: 0, backbeatRatio: 0, offbeatRatio: 0, accentShape: 'unknown' };
    }

    // Beat duration in seconds
    const beatDur = beatGridHelpers.getBeatDuration();

    // Find velocity mean for accent detection
    let velSum = 0;
    for (let i = 0; i < notes.length; i++) {
      velSum += (typeof notes[i].velocity === 'number' ? notes[i].velocity : 64);
    }
    const velMean = velSum / notes.length;
    const accentThreshold = velMean * 1.15; // 15% above mean = accent

    let downbeats = 0;
    let backbeats = 0;
    let offbeats = 0;
    let accentCount = 0;

    const num = V.requireFinite(numerator, 'numerator');
    if (num <= 0) throw new Error('AccentPatternTracker.getAccentProfile: numerator must be > 0');
    const measureDur = beatDur * num;

    for (let i = 0; i < notes.length; i++) {
      const vel = (typeof notes[i].velocity === 'number' ? notes[i].velocity : 64);
      if (vel < accentThreshold) continue;
      accentCount++;

      const t = notes[i].time;
      const posInMeasure = (t % measureDur) / beatDur;
      const beatPos = posInMeasure % 1;

      // Classify by metric position
      if (beatPos < 0.15 && posInMeasure < 0.5) {
        downbeats++;
      } else if (beatPos < 0.15 && posInMeasure >= 1.5) {
        backbeats++;
      } else {
        offbeats++;
      }
    }

    if (accentCount === 0) {
      return { downbeatRatio: 0, backbeatRatio: 0, offbeatRatio: 0, accentShape: 'flat' };
    }

    const downbeatRatio = downbeats / accentCount;
    const backbeatRatio = backbeats / accentCount;
    const offbeatRatio = offbeats / accentCount;

    let accentShape = 'mixed';
    if (downbeatRatio > 0.6) accentShape = 'downbeat-heavy';
    else if (backbeatRatio > 0.5) accentShape = 'backbeat-heavy';
    else if (offbeatRatio > 0.6) accentShape = 'displaced';
    else if (downbeatRatio < 0.15 && backbeatRatio < 0.15) accentShape = 'flat';

    return { downbeatRatio, backbeatRatio, offbeatRatio, accentShape };
  }

  /**
   * Get a velocity accent bias to encourage variety.
   * Downbeat-heavy â†’ boost off-beat accents; flat â†’ boost downbeat emphasis.
   * @param {Object} [opts]
   * @param {string} [opts.layer]
   * @returns {{ downbeatBias: number, offbeatBias: number }}
   */
  function getAccentBias(opts) {
    const profile = getAccentProfile(opts);
    if (profile.accentShape === 'downbeat-heavy') {
      return { downbeatBias: 0.85, offbeatBias: 1.2 };
    }
    if (profile.accentShape === 'flat') {
      return { downbeatBias: 1.25, offbeatBias: 1.0 };
    }
    if (profile.accentShape === 'displaced') {
      return { downbeatBias: 1.15, offbeatBias: 0.9 };
    }
    return { downbeatBias: 1.0, offbeatBias: 1.0 };
  }

  ConductorIntelligence.registerStateProvider('AccentPatternTracker', () => {
    const b = AccentPatternTracker.getAccentBias();
    return {
      accentDownbeatBias: b ? b.downbeatBias : 1,
      accentOffbeatBias: b ? b.offbeatBias : 1
    };
  });

  return {
    getAccentProfile,
    getAccentBias
  };
})();

