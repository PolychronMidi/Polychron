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
    },
    texture: {
      burstBaseScale: 1.0,    // multiplier on per-unit chord burst base probability
      flurryBaseScale: 1.0,   // multiplier on per-unit flurry base probability
      burstCap: 0.18,         // absolute max chord burst probability
      flurryCap: 0.15         // absolute max flurry probability
    },
    attenuation: {
      subsubdivRange: [1.5, 3],  // rf() range for subsubdiv multiplier cap
      subdivRange: [2, 4],       // rf() range for subdiv multiplier cap
      divRange: [2, 5]           // rf() range for div/beat multiplier cap
    },
    voiceSpread: {
      spread: 0.15,              // base voice-position divergence
      chordBurstInnerBoost: 1.0, // inner-voice accent multiplier in chord bursts
      flurryDecayRate: 1.8,      // decrescendo steepness for flurry mode
      jitterAmount: 0.1          // random humanization ±range
    },
    familyWeights: {
      diatonicCore: 1.0,
      harmonicMotion: 1.0,
      development: 1.0,
      tonalExploration: 1.0,
      rhythmicDrive: 1.0
    },
    journeyBoldness: 1.0,        // 0-2 scalar shifting move pool composition
    emission: {
      noiseProfile: 'subtle',          // noise profile name for velocity shaping
      sourceNoiseInfluence: 0.12,      // noise influence factor for source channels
      reflectionNoiseInfluence: 0.10,  // noise influence factor for reflection channels
      bassNoiseInfluence: 0.08,        // noise influence factor for bass channels
      voiceConfigBlend: 0.3            // blend factor for voiceConfig velocity
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
    },
    texture: {
      burstBaseScale: 0.5,
      flurryBaseScale: 0.4,
      burstCap: 0.10,
      flurryCap: 0.08
    },
    attenuation: {
      subsubdivRange: [1, 2],
      subdivRange: [1.5, 3],
      divRange: [1.5, 3.5]
    },
    voiceSpread: {
      spread: 0.08,
      chordBurstInnerBoost: 0.6,
      flurryDecayRate: 1.2,
      jitterAmount: 0.05
    },
    familyWeights: {
      diatonicCore: 1.3,
      harmonicMotion: 1.0,
      development: 0.6,
      tonalExploration: 1.2,
      rhythmicDrive: 0.5
    },
    journeyBoldness: 0.4,
    emission: {
      noiseProfile: 'subtle',
      sourceNoiseInfluence: 0.06,
      reflectionNoiseInfluence: 0.05,
      bassNoiseInfluence: 0.04,
      voiceConfigBlend: 0.4
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
    },
    texture: {
      burstBaseScale: 1.8,
      flurryBaseScale: 1.6,
      burstCap: 0.28,
      flurryCap: 0.25
    },
    attenuation: {
      subsubdivRange: [2, 4],
      subdivRange: [3, 6],
      divRange: [3, 7]
    },
    voiceSpread: {
      spread: 0.25,
      chordBurstInnerBoost: 1.6,
      flurryDecayRate: 2.5,
      jitterAmount: 0.18
    },
    familyWeights: {
      diatonicCore: 0.7,
      harmonicMotion: 1.3,
      development: 1.5,
      tonalExploration: 0.8,
      rhythmicDrive: 1.6
    },
    journeyBoldness: 1.8,
    emission: {
      noiseProfile: 'dramatic',
      sourceNoiseInfluence: 0.20,
      reflectionNoiseInfluence: 0.16,
      bassNoiseInfluence: 0.14,
      voiceConfigBlend: 0.2
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
    },
    texture: {
      burstBaseScale: 0.6,
      flurryBaseScale: 1.2,
      burstCap: 0.12,
      flurryCap: 0.18
    },
    attenuation: {
      subsubdivRange: [1.2, 2.5],
      subdivRange: [1.5, 3],
      divRange: [2, 4]
    },
    voiceSpread: {
      spread: 0.12,
      chordBurstInnerBoost: 0.8,
      flurryDecayRate: 1.5,
      jitterAmount: 0.08
    },
    familyWeights: {
      diatonicCore: 1.2,
      harmonicMotion: 0.8,
      development: 0.7,
      tonalExploration: 1.5,
      rhythmicDrive: 0.4
    },
    journeyBoldness: 0.6,
    emission: {
      noiseProfile: 'micro',
      sourceNoiseInfluence: 0.14,
      reflectionNoiseInfluence: 0.12,
      bassNoiseInfluence: 0.10,
      voiceConfigBlend: 0.35
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
    },
    texture: {
      burstBaseScale: 1.4,
      flurryBaseScale: 0.8,
      burstCap: 0.22,
      flurryCap: 0.10
    },
    attenuation: {
      subsubdivRange: [2, 3.5],
      subdivRange: [2.5, 5],
      divRange: [2.5, 6]
    },
    voiceSpread: {
      spread: 0.20,
      chordBurstInnerBoost: 1.3,
      flurryDecayRate: 2.0,
      jitterAmount: 0.14
    },
    familyWeights: {
      diatonicCore: 0.8,
      harmonicMotion: 1.2,
      development: 1.0,
      tonalExploration: 0.6,
      rhythmicDrive: 1.8
    },
    journeyBoldness: 1.3,
    emission: {
      noiseProfile: 'subtle',
      sourceNoiseInfluence: 0.16,
      reflectionNoiseInfluence: 0.12,
      bassNoiseInfluence: 0.10,
      voiceConfigBlend: 0.25
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
    },
    texture: {
      burstBaseScale: 0.3,
      flurryBaseScale: 0.2,
      burstCap: 0.06,
      flurryCap: 0.05
    },
    attenuation: {
      subsubdivRange: [1, 1.8],
      subdivRange: [1, 2.5],
      divRange: [1.5, 3]
    },
    voiceSpread: {
      spread: 0.06,
      chordBurstInnerBoost: 0.4,
      flurryDecayRate: 1.0,
      jitterAmount: 0.04
    },
    familyWeights: {
      diatonicCore: 1.6,
      harmonicMotion: 0.7,
      development: 0.5,
      tonalExploration: 0.8,
      rhythmicDrive: 0.4
    },
    journeyBoldness: 0.2,
    emission: {
      noiseProfile: 'micro',
      sourceNoiseInfluence: 0.04,
      reflectionNoiseInfluence: 0.03,
      bassNoiseInfluence: 0.02,
      voiceConfigBlend: 0.5
    }
  }
};
