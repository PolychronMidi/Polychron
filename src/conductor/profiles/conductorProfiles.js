// conductorProfiles.js — Conductor profile definitions
// Each profile configures how GlobalConductor + DynamismEngine shape
// dynamics, density, stutter, and energy weighting over time.
// These are meta-profiles: they don't generate notes, they control
// the *interpretation* of the music the composers produce.

if (typeof CONDUCTOR_PROFILE_SOURCES !== 'undefined' && CONDUCTOR_PROFILE_SOURCES !== null && typeof CONDUCTOR_PROFILE_SOURCES !== 'object') {
  throw new Error('conductorProfiles: CONDUCTOR_PROFILE_SOURCES must be an object when pre-defined');
}
if (typeof CONDUCTOR_PROFILE_SOURCES === 'undefined' || CONDUCTOR_PROFILE_SOURCES === null) {
  CONDUCTOR_PROFILE_SOURCES = {};
}

CONDUCTOR_PROFILE_SOURCES = {
  // ── Default: current hardcoded behavior, extracted verbatim ─────────
  default: {
    label: 'Default',
    density: {
      floor: 0.15,
      ceiling: 0.95,
      range: [0.3, 0.8],
      smoothing: 0.8
    },
    phaseMultipliers: {
      intro: 0.8,
      opening: 0.8,
      exposition: 1.0,
      development: 1.0,
      climax: 1.3,
      resolution: 0.7,
      conclusion: 0.7,
      coda: 0.7
    },
    stutter: {
      rateTiers: [
        { threshold: 0, rate: 8 },
        { threshold: 0.5, rate: 16 },
        { threshold: 0.8, rate: 32 }
      ],
      coherenceFlip: 0.8,
      rateCurveFlip: 0.6
    },
    energyWeights: {
      phrase: 0.4,
      journey: 0.25,
      feedback: 0.2,
      pulse: 0.15
    },
    flicker: {
      depthScale: 1.0,
      crossModWeight: 0.5
    },
    climaxBoost: {
      playScale: 1.1,
      stutterScale: 1.2
    },
    crossMod: {
      rangeScale: 1.0,        // multiplier on crossMod active/inactive rf() ranges
      penaltyScale: 1.0,      // multiplier on penalty/reward thresholds
      textureBoostScale: 1.0  // multiplier on texture-reactive crossMod inflation
    },
    fxMix: {
      reverbScale: 1.0,       // multiplier on reverb CC91/92/93 ranges
      filterOpenness: 1.0,    // multiplier on CC74 filter cutoff range above baseline
      delayScale: 1.0,        // multiplier on CC94 delay send ranges
      textureBoostScale: 1.0  // multiplier on texture-reactive FX boost amounts
    }
  },

  // ── Restrained: narrow dynamics, heavy smoothing, journey-led ──────
  restrained: {
    label: 'Restrained',
    density: {
      floor: 0.3,
      ceiling: 0.65,
      range: [0.4, 0.6],
      smoothing: 0.92
    },
    phaseMultipliers: {
      intro: 0.85,
      opening: 0.85,
      exposition: 0.95,
      development: 1.0,
      climax: 1.1,
      resolution: 0.8,
      conclusion: 0.8,
      coda: 0.75
    },
    stutter: {
      rateTiers: [
        { threshold: 0, rate: 4 },
        { threshold: 0.6, rate: 8 },
        { threshold: 0.9, rate: 16 }
      ],
      coherenceFlip: 0.9,
      rateCurveFlip: 0.75
    },
    energyWeights: {
      phrase: 0.3,
      journey: 0.4,
      feedback: 0.15,
      pulse: 0.15
    },
    flicker: {
      depthScale: 0.5,
      crossModWeight: 0.3
    },
    climaxBoost: {
      playScale: 1.05,
      stutterScale: 1.05
    },
    crossMod: {
      rangeScale: 0.6,        // tighter coupling — narrower crossMod swings
      penaltyScale: 0.7,      // lower thresholds to penalize density earlier
      textureBoostScale: 0.5  // muted texture feedback
    },
    fxMix: {
      reverbScale: 0.6,       // intimate, dry mix
      filterOpenness: 0.7,    // darker, more filtered
      delayScale: 0.4,        // very little delay
      textureBoostScale: 0.4  // subtle texture FX
    }
  },

  // ── Explosive: wide dynamics, light smoothing, feedback-heavy ──────
  explosive: {
    label: 'Explosive',
    density: {
      floor: 0.1,
      ceiling: 0.98,
      range: [0.15, 0.95],
      smoothing: 0.5
    },
    phaseMultipliers: {
      intro: 0.6,
      opening: 0.7,
      exposition: 1.0,
      development: 1.15,
      climax: 1.5,
      resolution: 0.55,
      conclusion: 0.5,
      coda: 0.4
    },
    stutter: {
      rateTiers: [
        { threshold: 0, rate: 16 },
        { threshold: 0.4, rate: 32 },
        { threshold: 0.7, rate: 64 }
      ],
      coherenceFlip: 0.6,
      rateCurveFlip: 0.4
    },
    energyWeights: {
      phrase: 0.25,
      journey: 0.2,
      feedback: 0.35,
      pulse: 0.2
    },
    flicker: {
      depthScale: 1.8,
      crossModWeight: 0.8
    },
    climaxBoost: {
      playScale: 1.2,
      stutterScale: 1.4
    },
    crossMod: {
      rangeScale: 1.6,        // wide swings — chaotic density oscillation
      penaltyScale: 1.4,      // higher threshold before penalties kick in
      textureBoostScale: 1.8  // aggressive texture→crossMod amplification
    },
    fxMix: {
      reverbScale: 1.6,       // cavernous reverb
      filterOpenness: 1.4,    // bright, open filter
      delayScale: 1.8,        // heavy delay washes
      textureBoostScale: 2.0  // dramatic texture FX spikes
    }
  },

  // ── Atmospheric: low density, very slow smoothing, phrase-dominant ──
  atmospheric: {
    label: 'Atmospheric',
    density: {
      floor: 0.1,
      ceiling: 0.55,
      range: [0.2, 0.5],
      smoothing: 0.95
    },
    phaseMultipliers: {
      intro: 0.9,
      opening: 0.9,
      exposition: 1.0,
      development: 1.0,
      climax: 1.15,
      resolution: 0.85,
      conclusion: 0.85,
      coda: 0.8
    },
    stutter: {
      rateTiers: [
        { threshold: 0, rate: 4 },
        { threshold: 0.7, rate: 8 },
        { threshold: 0.95, rate: 16 }
      ],
      coherenceFlip: 0.95,
      rateCurveFlip: 0.85
    },
    energyWeights: {
      phrase: 0.55,
      journey: 0.2,
      feedback: 0.1,
      pulse: 0.15
    },
    flicker: {
      depthScale: 0.3,
      crossModWeight: 0.2
    },
    climaxBoost: {
      playScale: 1.05,
      stutterScale: 1.0
    },
    crossMod: {
      rangeScale: 0.8,        // moderate coupling
      penaltyScale: 0.8,      // slightly lower thresholds
      textureBoostScale: 0.6  // gentle texture feedback
    },
    fxMix: {
      reverbScale: 1.4,       // spacious reverb depth
      filterOpenness: 0.8,    // slightly darker — moody
      delayScale: 1.5,        // lush delay tails
      textureBoostScale: 1.2  // some texture breathing
    }
  },

  // ── Rhythmic Drive: pulse-heavy, steep stutter, dense floor ────────
  rhythmicDrive: {
    label: 'Rhythmic Drive',
    density: {
      floor: 0.35,
      ceiling: 0.9,
      range: [0.4, 0.85],
      smoothing: 0.65
    },
    phaseMultipliers: {
      intro: 0.75,
      opening: 0.85,
      exposition: 1.05,
      development: 1.1,
      climax: 1.35,
      resolution: 0.65,
      conclusion: 0.6,
      coda: 0.55
    },
    stutter: {
      rateTiers: [
        { threshold: 0, rate: 16 },
        { threshold: 0.35, rate: 32 },
        { threshold: 0.65, rate: 64 }
      ],
      coherenceFlip: 0.7,
      rateCurveFlip: 0.5
    },
    energyWeights: {
      phrase: 0.2,
      journey: 0.2,
      feedback: 0.25,
      pulse: 0.35
    },
    flicker: {
      depthScale: 1.4,
      crossModWeight: 0.7
    },
    climaxBoost: {
      playScale: 1.15,
      stutterScale: 1.3
    },
    crossMod: {
      rangeScale: 1.3,        // wide crossMod for rhythmic energy
      penaltyScale: 1.5,      // high tolerance — let density build
      textureBoostScale: 1.5  // strong texture→rhythm feedback
    },
    fxMix: {
      reverbScale: 0.8,       // tighter, punchier mix
      filterOpenness: 1.2,    // open and bright
      delayScale: 0.6,        // minimal delay — keep it tight
      textureBoostScale: 1.0  // normal texture FX
    }
  },

  // ── Minimal: ultra-narrow, no flicker, flat, suppressed stutter ────
  minimal: {
    label: 'Minimal',
    density: {
      floor: 0.25,
      ceiling: 0.5,
      range: [0.3, 0.45],
      smoothing: 0.96
    },
    phaseMultipliers: {
      intro: 0.95,
      opening: 0.95,
      exposition: 1.0,
      development: 1.0,
      climax: 1.05,
      resolution: 0.95,
      conclusion: 0.95,
      coda: 0.9
    },
    stutter: {
      rateTiers: [
        { threshold: 0, rate: 4 },
        { threshold: 0.8, rate: 8 },
        { threshold: 0.95, rate: 12 }
      ],
      coherenceFlip: 0.98,
      rateCurveFlip: 0.95
    },
    energyWeights: {
      phrase: 0.5,
      journey: 0.25,
      feedback: 0.1,
      pulse: 0.15
    },
    flicker: {
      depthScale: 0.0,
      crossModWeight: 0.0
    },
    climaxBoost: {
      playScale: 1.02,
      stutterScale: 1.0
    },
    crossMod: {
      rangeScale: 0.4,        // very tight — almost static density
      penaltyScale: 0.5,      // aggressive penalties to suppress build-up
      textureBoostScale: 0.2  // near-zero texture inflation
    },
    fxMix: {
      reverbScale: 0.5,       // bone-dry
      filterOpenness: 0.6,    // muted, dark
      delayScale: 0.3,        // barely any delay
      textureBoostScale: 0.2  // nearly silent texture FX
    }
  }
};
