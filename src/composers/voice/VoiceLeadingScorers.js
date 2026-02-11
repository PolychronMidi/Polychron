// VoiceLeadingScorers.js - helper scoring functions extracted from VoiceLeadingScore

/**
 * Pure scoring helpers used by VoiceLeadingScore. These functions are intentionally
 * stateless and accept dynamic parameters (or the scorer instance) so we avoid
 * relying on `this` in the helpers.
 */
VoiceLeadingScorers = {
  scoreVoiceMotion(interval, fromNote, toNote) {
    if (interval === 0) return 0;
    if (interval <= 2) return 1;
    if (interval <= 5) return 3;
    if (interval <= 7) return 5;
    return 10;
  },

  scoreVoiceRange(note, range) {
    const [min, max] = range;
    const mid = (min + max) / 2;
    const width = max - min;
    if (note >= min + width / 4 && note <= max - width / 4) {
      return 0;
    }
    if (note >= min && note <= max) {
      return 2;
    }
    const distance = note < min ? min - note : note - max;
    return Math.min(8, 2 + distance * 0.5);
  },

  scoreLeapRecovery(scorer, currentInterval, prevInterval, lastNotes, candidate) {
    if (prevInterval <= 2) return 0;
    const leapScale = Math.min(2.5, prevInterval / 5.0);
    const dynamismReduction = (scorer && typeof scorer.dynamism === 'number') ? (scorer.dynamism * 0.4) : 0.0;
    if (currentInterval > 2) {
      return Math.max(0, (5 * leapScale) - dynamismReduction);
    }
    if (lastNotes && lastNotes.length >= 2) {
      const prevDirection = lastNotes[0] - lastNotes[1];
      const currentDirection = candidate - lastNotes[0];
      const sameDirection = (prevDirection > 0 && currentDirection > 0) || (prevDirection < 0 && currentDirection < 0);
      if (sameDirection) {
        const cmp = (scorer && typeof scorer.contraryMotionPreference === 'number') ? scorer.contraryMotionPreference : 0.4;
        const basePenalty = 2 * cmp * leapScale;
        return Math.max(0, basePenalty - dynamismReduction);
      }
    }
    return 0;
  },

  scoreVoiceCrossing(candidate, lastNotes) {
    if (!lastNotes || lastNotes.length < 2) return 0;
    const alto = (typeof lastNotes[1] === 'number') ? lastNotes[1] : 60;
    if (candidate < alto) return 6;
    if (lastNotes.length >= 4) {
      const tenor = lastNotes[2];
      const bass = lastNotes[3];
      if ((candidate < alto && alto < tenor) || (tenor < alto && alto < candidate)) return 4;
    }
    return 0;
  },

  scoreParallelMotion(currentMotion, lastMotion) {
    if ((currentMotion > 0 && lastMotion > 0) || (currentMotion < 0 && lastMotion < 0)) return 3;
    return 0;
  },

  scoreIntervalQuality(interval, fromNote, toNote, dynamism = 0) {
    if (interval <= 2) return 0;
    const intervalClass = interval % 12;
    const dynamismBonus = dynamism * 2;
    if ([3, 4, 5, 7, 9].includes(intervalClass)) return Math.max(0, 1 - dynamismBonus * 0.5);
    if ([2, 10].includes(intervalClass)) return Math.max(0, 3 - dynamismBonus);
    if ([1, 6, 11].includes(intervalClass)) return Math.max(0, 5 - dynamismBonus * 1.5);
    return Math.max(0, 4 - dynamismBonus);
  },

  scoreConsecutiveLeaps(currentInterval, lastNotes, dynamism = 0) {
    if (currentInterval <= 2) return 0;
    let consecutiveLeaps = 1;
    for (let i = 0; i < Math.min(lastNotes.length - 1, 3); i++) {
      const histInterval = Math.abs(lastNotes[i] - lastNotes[i + 1]);
      if (histInterval > 2) consecutiveLeaps++; else break;
    }
    const dynamismReduction = dynamism * 3;
    if (consecutiveLeaps === 2) return Math.max(0, 3 - dynamismReduction * 0.6);
    if (consecutiveLeaps === 3) return Math.max(0, 6 - dynamismReduction);
    if (consecutiveLeaps >= 4) return Math.max(0, 8 - dynamismReduction);
    return 0;
  },

  scoreDirectionalBias(candidate, lastNote, register) {
    const direction = candidate - lastNote;
    if (direction === 0) return 0;
    const ascending = direction > 0;
    switch (register) {
      case 'soprano': return ascending ? 0 : 0.5;
      case 'bass': return ascending ? 0.5 : 0;
      case 'alto':
      case 'tenor':
      default: return 0;
    }
  },

  scoreMaxLeap(interval, register, maxLeapSize = {}, dynamism = 0) {
    const maxLeap = (maxLeapSize && typeof maxLeapSize[register] === 'number') ? maxLeapSize[register] : 12;
    if (interval <= maxLeap) return 0;
    const excess = interval - maxLeap;
    const dynamismReduction = dynamism * 4;
    return Math.max(0, Math.min(10, excess * 1.5) - dynamismReduction);
  }
};
