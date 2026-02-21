// profileAdaptation.js — Advisory hints for adaptive profile parameter blending.
// Reads signalReader each beat and computes a hint vector suggesting profile
// adjustments based on emergent musical content. Does NOT switch profiles —
// provides advisory signals that ConductorConfig can optionally blend.

profileAdaptation = (() => {
  const V = Validator.create('profileAdaptation');

  // Sustained-signal tracking: count consecutive beats meeting each threshold
  let lowDensityStreak = 0;
  let highTensionStreak = 0;
  let flatFlickerStreak = 0;

  const DENSITY_LOW_THRESHOLD = 0.55;
  const TENSION_HIGH_THRESHOLD = 1.4;
  const FLICKER_FLAT_THRESHOLD = 1.05;
  const STREAK_TRIGGER = 6; // beats before a hint activates

  /**
   * Update streaks and compute hints. Called each beat via registerRecorder.
   */
  function update() {
    const d = signalReader.density();
    const t = signalReader.tension();
    const f = signalReader.flicker();

    // Track sustained conditions
    lowDensityStreak = d < DENSITY_LOW_THRESHOLD ? lowDensityStreak + 1 : 0;
    highTensionStreak = t > TENSION_HIGH_THRESHOLD ? highTensionStreak + 1 : 0;
    flatFlickerStreak = m.abs(f - 1.0) < (FLICKER_FLAT_THRESHOLD - 1.0) ? flatFlickerStreak + 1 : 0;
  }

  /**
   * Get the current hint vector.
   * Each hint is 0 (inactive) to 1 (strong recommendation).
   * @returns {{ restrainedHint: number, explosiveHint: number, atmosphericHint: number }}
   */
  function getHints() {
    return {
      // Sustained low density → hint toward restrained energy weights
      restrainedHint: lowDensityStreak >= STREAK_TRIGGER
        ? clamp((lowDensityStreak - STREAK_TRIGGER) / 8, 0, 1)
        : 0,
      // Sustained high tension → hint toward explosive phase multipliers
      explosiveHint: highTensionStreak >= STREAK_TRIGGER
        ? clamp((highTensionStreak - STREAK_TRIGGER) / 8, 0, 1)
        : 0,
      // Collapsed flicker (no variation) → hint toward atmospheric noise profile
      atmosphericHint: flatFlickerStreak >= STREAK_TRIGGER
        ? clamp((flatFlickerStreak - STREAK_TRIGGER) / 8, 0, 1)
        : 0
    };
  }

  /** Reset tracking. */
  function reset() {
    lowDensityStreak = 0;
    highTensionStreak = 0;
    flatFlickerStreak = 0;
  }

  /** Subscribe to SECTION_BOUNDARY so streaks reset each section. */
  function initialize() {
    const EVENTS = V.getEventsOrThrow();
    EventBus.on(EVENTS.SECTION_BOUNDARY, reset);
  }

  // Self-register: recorder (runs each beat) + state provider (exposes hints)
  ConductorIntelligence.registerRecorder('profileAdaptation', update);
  ConductorIntelligence.registerStateProvider('profileAdaptation', () => {
    const h = getHints();
    return {
      profileHintRestrained: h.restrainedHint,
      profileHintExplosive: h.explosiveHint,
      profileHintAtmospheric: h.atmosphericHint
    };
  });

  return { update, getHints, reset, initialize };
})();
