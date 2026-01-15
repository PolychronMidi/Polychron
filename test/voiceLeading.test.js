// test/voiceLeading.test.js
require('../src/sheet');       // Defines constants and configuration objects
require('../src/venue');       // Defines tonal (t), allScales, allNotes, allChords, allModes
require('../src/writer');      // Defines writer functions (CSVBuffer, p, etc.)
require('../src/backstage');   // Defines helper functions like rf, ri, clamp, etc.
require('../src/composers');   // Defines composer classes and composers array
require('../src/voiceLeading'); // Defines VoiceLeadingScore class

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Voice Leading Tests
 * Tests VoiceLeadingScore class with cost function optimization,
 * voice leading rules, and composer integration.
 */

describe('VoiceLeadingScore', () => {
  let scorer;

  beforeEach(() => {
    scorer = new VoiceLeadingScore();
  });

  afterEach(() => {
    scorer.reset();
  });

  describe('Core Cost Calculation', () => {
    it('should exist as a global class', () => {
      expect(globalThis.VoiceLeadingScore).toBeDefined();
      expect(typeof VoiceLeadingScore).toBe('function');
    });

    it('should initialize with default weights', () => {
      expect(scorer.weights).toBeDefined();
      expect(scorer.weights.smoothMotion).toBe(1.0);
      expect(scorer.weights.voiceRange).toBe(0.8);
      expect(scorer.weights.leapRecovery).toBe(0.6);
    });

    it('should accept custom weights in constructor', () => {
      const custom = new VoiceLeadingScore({
        smoothMotionWeight: 2.0,
        voiceRangeWeight: 1.5,
      });
      expect(custom.weights.smoothMotion).toBe(2.0);
      expect(custom.weights.voiceRange).toBe(1.5);
      expect(custom.weights.leapRecovery).toBe(0.6); // default
    });

    it('should define standard voice registers', () => {
      expect(scorer.registers).toBeDefined();
      expect(scorer.registers.soprano).toEqual([60, 84]);
      expect(scorer.registers.alto).toEqual([48, 72]);
      expect(scorer.registers.tenor).toEqual([36, 60]);
      expect(scorer.registers.bass).toEqual([24, 48]);
    });
  });

  describe('Voice Motion Scoring', () => {
    it('should score unison (interval 0) as 0 cost', () => {
      const cost = scorer._scoreVoiceMotion(0, 60, 60);
      expect(cost).toBe(0);
    });

    it('should score stepwise motion (1-2 semitones) as 1 cost', () => {
      const cost1 = scorer._scoreVoiceMotion(1, 60, 61);
      const cost2 = scorer._scoreVoiceMotion(2, 60, 62);
      expect(cost1).toBe(1);
      expect(cost2).toBe(1);
    });

    it('should score small leaps (3-5 semitones) as 3 cost', () => {
      const cost3 = scorer._scoreVoiceMotion(3, 60, 63);
      const cost5 = scorer._scoreVoiceMotion(5, 60, 65);
      expect(cost3).toBe(3);
      expect(cost5).toBe(3);
    });

    it('should score tritone/sixth (6-7 semitones) as 5 cost', () => {
      const cost6 = scorer._scoreVoiceMotion(6, 60, 66);
      const cost7 = scorer._scoreVoiceMotion(7, 60, 67);
      expect(cost6).toBe(5);
      expect(cost7).toBe(5);
    });

    it('should score large leaps (>7 semitones) as 10 cost', () => {
      const cost10 = scorer._scoreVoiceMotion(10, 60, 70);
      const cost12 = scorer._scoreVoiceMotion(12, 60, 72);
      expect(cost10).toBe(10);
      expect(cost12).toBe(10);
    });
  });

  describe('Voice Range Scoring', () => {
    it('should score notes in ideal zone (middle half) as 0 cost', () => {
      const range = [48, 72]; // 24 semitone range
      const ideal = 60; // Middle of ideal zone
      const cost = scorer._scoreVoiceRange(ideal, range);
      expect(cost).toBe(0);
    });

    it('should score notes in acceptable zone (within range) as 2 cost', () => {
      const range = [60, 84];
      const cost = scorer._scoreVoiceRange(55, range);
      expect(cost).toBeGreaterThan(0); // Outside range
    });

    it('should score notes below range with increasing penalty', () => {
      const range = [60, 84];
      const cost1 = scorer._scoreVoiceRange(50, range);
      const cost5 = scorer._scoreVoiceRange(45, range);
      expect(cost5).toBeGreaterThan(cost1); // Further below = higher cost
    });

    it('should score notes above range with increasing penalty', () => {
      const range = [60, 84];
      const cost1 = scorer._scoreVoiceRange(90, range);
      const cost5 = scorer._scoreVoiceRange(100, range);
      expect(cost5).toBeGreaterThan(cost1); // Further above = higher cost
    });
  });

  describe('Leap Recovery Scoring', () => {
    it('should not penalize leap recovery when previous motion was stepwise', () => {
      const cost = scorer._scoreLeapRecovery(2, 1, [60, 59]); // Step after step
      expect(cost).toBe(0);
    });

    it('should penalize large leap not followed by step', () => {
      const cost = scorer._scoreLeapRecovery(5, 7, [72, 65]); // Leap after leap
      expect(cost).toBe(5);
    });

    it('should accept step after leap', () => {
      const cost = scorer._scoreLeapRecovery(2, 7, [72, 65]); // Step after leap
      expect(cost).toBeLessThan(5);
    });

    it('should prefer leap recovery in opposite direction', () => {
      const cost = scorer._scoreLeapRecovery(2, 7, [65, 72, 60]); // Opposite direction
      expect(cost).toBe(0);
    });
  });

  describe('Voice Crossing Detection', () => {
    it('should not detect crossing when soprano is above alto', () => {
      const cost = scorer._scoreVoiceCrossing(72, [72, 60]); // Soprano >= Alto
      expect(cost).toBe(0);
    });

    it('should detect crossing when soprano falls below alto', () => {
      const cost = scorer._scoreVoiceCrossing(55, [55, 60]); // Soprano < Alto
      expect(cost).toBeGreaterThan(0);
    });

    it('should score full voice crossing in 4-voice context', () => {
      const lastNotes = [72, 60, 48, 36]; // S A T B
      const cost = scorer._scoreVoiceCrossing(50, lastNotes);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('Parallel Motion Detection', () => {
    it('should score same-direction parallel motion', () => {
      const cost = scorer._scoreParallelMotion(5, 3); // Both up
      expect(cost).toBeGreaterThan(0);
    });

    it('should not score opposite-direction motion as parallel', () => {
      const cost = scorer._scoreParallelMotion(5, -3); // Up then down
      expect(cost).toBe(0);
    });
  });

  describe('Note Selection', () => {
    it('should select from available notes', () => {
      const candidates = [60, 62, 64, 65, 67];
      const selected = scorer.selectNextNote([60], candidates);
      expect(candidates).toContain(selected);
    });

    it('should return fallback when no candidates available', () => {
      const selected = scorer.selectNextNote([60], []);
      expect(selected).toBe(60);
    });

    it('should prefer stepwise motion over leaps', () => {
      const candidates = [58, 59, 60, 61, 62, 72]; // Step options + one leap
      const selected = scorer.selectNextNote([60], candidates);
      expect([58, 59, 60, 61, 62]).toContain(selected); // Should prefer steps/unison over leap to 72
    });

    it('should respect voice register constraints', () => {
      const candidates = [24, 36, 48, 60, 72, 84];
      const selected = scorer.selectNextNote([60], candidates, { register: 'soprano' });
      expect(selected).toBeGreaterThanOrEqual(60);
      expect(selected).toBeLessThanOrEqual(84);
    });

    it('should apply hard constraint: avoidsStrident', () => {
      const scorer2 = new VoiceLeadingScore({ smoothMotionWeight: 0.1 }); // Lower smooth weight
      const candidates = [48, 60, 72]; // One small leap, rest large
      const selected = scorer2.selectNextNote([60], candidates, { constraints: ['avoidsStrident'] });
      expect(selected).toBe(60); // Unison preferred over large leaps
    });

    it('should apply hard constraint: stepsOnly', () => {
      const candidates = [58, 59, 61, 62, 72]; // Most are steps
      const selected = scorer.selectNextNote([60], candidates, { constraints: ['stepsOnly'] });
      expect([58, 59, 61, 62]).toContain(selected); // Should avoid leap
    });

    it('should track selection history', () => {
      const candidates1 = [60, 62, 64];
      const candidates2 = [61, 63, 65];
      scorer.selectNextNote([60], candidates1);
      scorer.selectNextNote([60], candidates2);
      expect(scorer.history.length).toBeGreaterThan(0);
    });

    it('should limit history depth to maxHistoryDepth', () => {
      for (let i = 0; i < 10; i++) {
        scorer.selectNextNote([60], [60, 62, 64]);
      }
      expect(scorer.history.length).toBeLessThanOrEqual(scorer.maxHistoryDepth);
    });
  });

  describe('Quality Analysis', () => {
    it('should analyze smoothness of a note sequence', () => {
      const sequence = [60, 61, 62, 61, 60]; // Smooth stepwise motion
      const quality = scorer.analyzeQuality(sequence);
      expect(quality.smoothness).toBeDefined();
      expect(quality.smoothness).toBeLessThan(2); // Should be smooth
    });

    it('should detect leaps in analysis', () => {
      const sequence = [60, 72, 60, 72]; // Large leaps
      const quality = scorer.analyzeQuality(sequence);
      expect(quality.smoothness).toBeGreaterThan(5); // High cost = poor smoothness
    });

    it('should track leap recovery rate', () => {
      const goodRecovery = [60, 72, 71, 70]; // Leap followed by steps
      const poorRecovery = [60, 72, 84]; // Leap not recovered
      const quality1 = scorer.analyzeQuality(goodRecovery);
      const quality2 = scorer.analyzeQuality(poorRecovery);
      expect(quality1.leapRecoveries).toBeGreaterThan(0);
    });

    it('should calculate average range', () => {
      const sequence = [48, 60, 72];
      const quality = scorer.analyzeQuality(sequence);
      expect(quality.avgRange).toBe(60); // Average of 48, 60, 72
    });
  });

  describe('State Management', () => {
    it('should reset history', () => {
      scorer.selectNextNote([60], [60, 62, 64]);
      expect(scorer.history.length).toBeGreaterThan(0);
      scorer.reset();
      expect(scorer.history.length).toBe(0);
    });
  });
});

/**
 * Composer Integration Tests
 * Tests voice leading integration with MeasureComposer and subclasses
 */
describe('Composer Voice Leading Integration', () => {
  let composer;
  let scorer;

  beforeEach(() => {
    composer = new MeasureComposer();
    scorer = new VoiceLeadingScore();
  });

  describe('Voice Leading Enablement', () => {
    it('should enable voice leading on composer', () => {
      composer.enableVoiceLeading(scorer);
      expect(composer.voiceLeading).toBeDefined();
      expect(composer.voiceLeading).toBe(scorer);
    });

    it('should create default scorer if none provided', () => {
      composer.enableVoiceLeading();
      expect(composer.voiceLeading).toBeDefined();
      expect(composer.voiceLeading instanceof VoiceLeadingScore).toBe(true);
    });

    it('should disable voice leading', () => {
      composer.enableVoiceLeading(scorer);
      composer.disableVoiceLeading();
      expect(composer.voiceLeading).toBeNull();
    });

    it('should initialize voice history as empty', () => {
      composer.enableVoiceLeading(scorer);
      expect(composer.voiceHistory).toEqual([]);
    });
  });

  describe('Note Selection with Voice Leading', () => {
    beforeEach(() => {
      composer.enableVoiceLeading(scorer);
    });

    it('should select note from available candidates', () => {
      const candidates = [60, 62, 64, 65, 67];
      const selected = composer.selectNoteWithLeading(candidates);
      expect(candidates).toContain(selected);
    });

    it('should return random selection when voice leading disabled', () => {
      composer.disableVoiceLeading();
      const candidates = [60, 62, 64];
      const selected = composer.selectNoteWithLeading(candidates);
      expect(candidates).toContain(selected);
    });

    it('should prefer stepwise motion when voice leading enabled', () => {
      // Select a starting note
      composer.selectNoteWithLeading([60]);
      // Now provide candidates with steps and a large leap
      const candidates = [58, 59, 61, 62, 84];
      const selected = composer.selectNoteWithLeading(candidates);
      expect([58, 59, 61, 62]).toContain(selected);
    });

    it('should build voice history with selections', () => {
      composer.selectNoteWithLeading([60]);
      composer.selectNoteWithLeading([61]);
      composer.selectNoteWithLeading([62]);
      expect(composer.voiceHistory.length).toBe(3);
      expect(composer.voiceHistory).toEqual([60, 61, 62]);
    });

    it('should limit voice history depth', () => {
      for (let i = 0; i < 10; i++) {
        composer.selectNoteWithLeading([60 + i]);
      }
      expect(composer.voiceHistory.length).toBeLessThanOrEqual(4);
    });
  });

  describe('Voice Leading Reset', () => {
    it('should reset voice history', () => {
      composer.enableVoiceLeading(scorer);
      composer.selectNoteWithLeading([60]);
      composer.selectNoteWithLeading([62]);
      expect(composer.voiceHistory.length).toBeGreaterThan(0);
      composer.resetVoiceLeading();
      expect(composer.voiceHistory.length).toBe(0);
    });

    it('should reset internal scorer state', () => {
      composer.enableVoiceLeading(scorer);
      composer.selectNoteWithLeading([60]);
      composer.resetVoiceLeading();
      expect(composer.voiceLeading.history.length).toBe(0);
    });
  });

  describe('Scale Composer Integration', () => {
    it('should inherit voice leading from MeasureComposer', () => {
      const scaleComposer = new ScaleComposer('major', 'C');
      expect(scaleComposer.enableVoiceLeading).toBeDefined();
      expect(scaleComposer.selectNoteWithLeading).toBeDefined();
      expect(scaleComposer.resetVoiceLeading).toBeDefined();
    });

    it('should work with scale notes for voice leading', () => {
      const scaleComposer = new ScaleComposer('major', 'C');
      scaleComposer.enableVoiceLeading();
      const scaleNotes = [0, 2, 4, 5, 7, 9, 11]; // C major intervals
      scaleNotes.forEach((note) => {
        const selected = scaleComposer.selectNoteWithLeading([note, note + 12]);
        expect([note, note + 12]).toContain(selected);
      });
    });
  });

  describe('Chord Composer Integration', () => {
    it('should inherit voice leading from MeasureComposer', () => {
      const chordComposer = new ChordComposer(['C', 'F', 'G']);
      expect(chordComposer.enableVoiceLeading).toBeDefined();
      expect(chordComposer.selectNoteWithLeading).toBeDefined();
    });
  });
});
