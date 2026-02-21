// harmonicJourneyHelpers.js - shared theory helpers for HarmonicJourney

harmonicJourneyHelpers = (() => {
  const CLOSE_MOVES = [
    (key, mode) => ({ key: t.Note.transpose(key, 'P5'), mode, move: 'fifth-up' }),
    (key, mode) => ({ key: t.Note.transpose(key, 'P4'), mode, move: 'fourth-up' }),
    (key, mode) => {
      if (mode === 'major' || mode === 'ionian') {
        return { key: t.Note.transpose(key, 'm3').replace(/\d+$/, ''), mode: 'minor', move: 'relative-minor' };
      }
      return { key: t.Note.transpose(key, 'M3').replace(/\d+$/, ''), mode: 'major', move: 'relative-major' };
    },
  ];

  const MODERATE_MOVES = [
    (key, mode) => {
      const parallelModes = {
        major: ['dorian', 'mixolydian', 'lydian'],
        minor: ['dorian', 'phrygian', 'aeolian'],
        dorian: ['major', 'minor', 'mixolydian'],
        mixolydian: ['major', 'dorian', 'lydian'],
        lydian: ['major', 'mixolydian', 'ionian'],
        phrygian: ['minor', 'dorian', 'aeolian'],
        aeolian: ['minor', 'dorian', 'phrygian'],
        locrian: ['minor', 'phrygian', 'aeolian'],
        ionian: ['dorian', 'mixolydian', 'lydian'],
      };
      const options = parallelModes[mode] || ['major', 'minor'];
      const newMode = options[ri(options.length - 1)];
      return { key, mode: newMode, move: `parallel-${newMode}` };
    },
    (key, mode) => ({ key: t.Note.transpose(key, 'M2'), mode, move: 'step-up' }),
    (key, mode) => ({ key: t.Note.transpose(key, 'M2').replace(/\d+$/, ''), mode, move: 'step-down' }),
  ];

  const BOLD_MOVES = [
    (key, mode) => ({ key: t.Note.transpose(key, 'M3'), mode, move: 'chromatic-mediant-up' }),
    (key, mode) => ({ key: t.Note.transpose(key, 'm3'), mode, move: 'chromatic-mediant-down' }),
    (key, mode) => ({ key: t.Note.transpose(key, 'A4'), mode, move: 'tritone-sub' }),
    (key, mode) => {
      const flipped = (mode === 'major' || mode === 'ionian' || mode === 'lydian' || mode === 'mixolydian') ? 'minor' : 'major';
      return { key: t.Note.transpose(key, 'm3'), mode: flipped, move: 'mediant-flip' };
    },
  ];

  const L2_RELATIONSHIPS = [
    (key, mode) => ({ key, mode, relationship: 'unison' }),
    (key, mode) => {
      const alt = (mode === 'major' || mode === 'ionian') ? 'minor' : 'major';
      return { key, mode: alt, relationship: 'parallel' };
    },
    (key, mode) => {
      if (mode === 'major' || mode === 'ionian') {
        return { key: t.Note.transpose(key, 'm3'), mode: 'minor', relationship: 'relative' };
      }
      return { key: t.Note.transpose(key, 'M3'), mode: 'major', relationship: 'relative' };
    },
    (key, mode) => ({ key: t.Note.transpose(key, 'P5'), mode, relationship: 'dominant' }),
    (key, mode) => ({ key: t.Note.transpose(key, 'P4'), mode, relationship: 'subdominant' }),
  ];

  const modeToQuality = {
    major: 'major', ionian: 'major', lydian: 'major', mixolydian: 'major',
    minor: 'minor', aeolian: 'minor', dorian: 'minor', phrygian: 'minor', locrian: 'minor'
  };

  const harmonicDistance = (from, to) => {
    const noteA = t.Note.get(from);
    const noteB = t.Note.get(to);
    if (noteA.empty || noteB.empty || !noteA.coord || !noteB.coord) return 0;
    const diff = Math.abs(noteA.coord[0] - noteB.coord[0]);
    const circleDist = diff % 12;
    return Math.min(circleDist, 12 - circleDist);
  };

  const getSectionPhase = (totalSections) => {
    if (totalSections <= 0) return 'development';
    const pos = TimeStream.normalizedProgress('section');
    if (pos < 0.2) return 'opening';
    if (pos < 0.55) return 'development';
    if (pos < 0.8) return 'climax';
    return 'resolution';
  };

  const getMovePoolForPhase = (phase) => {
    // Conductor profile boldness shifts move pool composition:
    // < 1 = more conservative (suppress bold moves), > 1 = more adventurous (inject bold moves)
    const boldness = (ConductorConfig && typeof ConductorConfig.getJourneyBoldness === 'function')
      ? ConductorConfig.getJourneyBoldness()
      : 1.0;

    let pool;
    switch (phase) {
      case 'opening':    pool = [...CLOSE_MOVES]; break;
      case 'resolution': pool = [...CLOSE_MOVES, ...MODERATE_MOVES.slice(0, 1)]; break;
      case 'development': pool = [...CLOSE_MOVES, ...MODERATE_MOVES]; break;
      case 'climax':     pool = [...MODERATE_MOVES, ...BOLD_MOVES]; break;
      default:           pool = [...CLOSE_MOVES]; break;
    }

    // Boldness > 1: inject bold moves into any phase proportional to excess
    if (boldness > 1) {
      const extraBoldCount = m.round((boldness - 1) * BOLD_MOVES.length);
      for (let i = 0; i < extraBoldCount && i < BOLD_MOVES.length; i++) {
        pool.push(BOLD_MOVES[i]);
      }
    }
    // Boldness < 1: strip bold moves and moderate moves proportionally
    if (boldness < 1) {
      const keepRatio = m.max(0, boldness);
      // Remove bold moves beyond the keep ratio
      const boldInPool = pool.filter(fn => BOLD_MOVES.includes(fn));
      const boldToRemove = m.round(boldInPool.length * (1 - keepRatio));
      let removed = 0;
      for (let i = pool.length - 1; i >= 0 && removed < boldToRemove; i--) {
        if (BOLD_MOVES.includes(pool[i])) {
          pool.splice(i, 1);
          removed++;
        }
      }
    }

    return pool;
  };

  const resolveScaleAndQuality = (key, mode) => {
    const scaleName = `${key} ${mode}`;
    const scaleData = t.Scale.get(scaleName);
    const scaleNotes = (scaleData && Array.isArray(scaleData.notes) && scaleData.notes.length > 0)
      ? scaleData.notes
      : t.Scale.get(`${key} major`).notes;
    return {
      scaleNotes,
      quality: modeToQuality[mode] || 'major'
    };
  };

  const api = {
    harmonicDistance,
    getSectionPhase,
    getMovePoolForPhase,
    getL2Relationships: () => L2_RELATIONSHIPS,
    resolveScaleAndQuality
  };

  return function harmonicJourneyHelpers() {
    return api;
  };
})();
