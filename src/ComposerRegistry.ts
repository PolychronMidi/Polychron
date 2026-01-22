// ComposerRegistry.ts - Centralized typed registry for composer creation

import * as Composers from './composers.js';
import { allScales, allNotes, allChords, allModes } from './venue.js';
import { ri } from './utils.js';
import { getPolychronContext } from './PolychronInit.js';

/**
 * Configuration object passed to composer constructors
 */
const poly = getPolychronContext();

export interface ComposerConfig {
  type: string;
  [key: string]: any;
}

/**
 * Constructor signature for composer classes
 */
export interface ComposerClass {
  new(...args: any[]): any;
}

/**
 * Factory function signature for creating composers
 */
export type ComposerFactory = (config: any) => any;

/**
 * Centralized registry for composer classes and factory functions.
 * Replaces the previous untyped ComposerFactory static class with a
 * type-safe singleton that supports both class constructors and factory functions.
 *
 * Usage:
 *   const registry = ComposerRegistry.getInstance();
 *   registry.register('scale', ScaleComposer);
 *   const composer = registry.create({ type: 'scale', name: 'major', root: 'C' });
 */
export class ComposerRegistry {
  private static instance: ComposerRegistry;
  private composers = new Map<string, ComposerFactory>();

  /**
   * Private constructor prevents direct instantiation
   */
  private constructor() {
    // Private to enforce singleton pattern
  }

  /**
   * Get the singleton instance, initializing with defaults if needed
   */
  static getInstance(): ComposerRegistry {
    if (!this.instance) {
      this.instance = new ComposerRegistry();
      this.instance.registerDefaults();
    }
    return this.instance;
  }

  /**
   * Register a composer factory function by type string
   * @param type - The composer type identifier (e.g., 'scale', 'chord')
   * @param factory - Factory function that creates a composer instance
   */
  register(type: string, factory: ComposerFactory): void {
    this.composers.set(type, factory);
  }

  /**
   * Create a composer instance from a config object
   * @param config - Config with 'type' property and type-specific options
   * @returns Composer instance
   * @throws Error if composer type is not registered
   */
  create(config: ComposerConfig): any {
    const type = config.type || 'scale';
    const factory = this.composers.get(type);

    if (!factory) {
      console.warn(`Unknown composer type: ${type}. Falling back to random scale.`);
      const scaleFactory = this.composers.get('scale');
      if (scaleFactory) {
        return scaleFactory({ name: 'random', root: 'random' });
      }
      throw new Error(`ComposerRegistry: No factory registered for type '${type}' and no fallback available`);
    }

    return factory(config);
  }

  /**
   * Check if a composer type is registered
   */
  has(type: string): boolean {
    return this.composers.has(type);
  }

  /**
   * Get all registered composer types
   */
  getTypes(): string[] {
    return Array.from(this.composers.keys());
  }

  /**
   * Clear all registered composers (useful for testing)
   */
  clear(): void {
    this.composers.clear();
  }

  /**
   * Register default composers from the composers module.
   * This method is called automatically on first getInstance().
   * It registers factory functions for all built-in composer types.
   */
  private registerDefaults(): void {
    // Use DI sources for composer constructors and data arrays
    // Import composers and venue data synchronously (safe despite circular imports)
    // This avoids relying on legacy runtime global fallbacks
    const ScaleComposer = Composers.ScaleComposer;
    const ChordComposer = Composers.ChordComposer;
    const ModeComposer = Composers.ModeComposer;
    const PentatonicComposer = Composers.PentatonicComposer;
    const MeasureComposer = Composers.MeasureComposer;
    const TensionReleaseComposer = Composers.TensionReleaseComposer;
    const ModalInterchangeComposer = Composers.ModalInterchangeComposer;
    const HarmonicRhythmComposer = Composers.HarmonicRhythmComposer;
    const MelodicDevelopmentComposer = Composers.MelodicDevelopmentComposer;
    const AdvancedVoiceLeadingComposer = Composers.AdvancedVoiceLeadingComposer;

    // Register measure composer (ensure instance indicates type for tests)
    this.register('measure', () => {
      const inst = new MeasureComposer();
      (inst as any).type = 'measure';
      return inst;
    });

    // Register scale composer with random support
    this.register('scale', ({ name = 'major', root = 'C' } = {}) => {
      const n = name === 'random' ? (allScales && allScales.length ? allScales[Math.max(0, ri(allScales.length - 1))] : 'major') : name;
      const r = root === 'random' ? (allNotes && allNotes.length ? allNotes[Math.max(0, ri(allNotes.length - 1))] : 'C') : root;
      return new ScaleComposer(n, r);
    });

    // Register chord composer with progression support
    this.register('chords', ({ progression = ['C'] } = {}) => {
      let p = Array.isArray(progression) ? progression : ['C'];
      if (typeof progression === 'string' && progression === 'random') {
        const len = typeof ri === 'function' ? ri(2, 5) : 3;
        p = [];
        for (let i = 0; i < len; i++) {
          p.push(allChords && allChords.length ? allChords[Math.max(0, ri(allChords.length - 1))] : 'C');
        }
      }
      return new ChordComposer(p);
    });

    // Register mode composer with random support
    this.register('mode', ({ name = 'ionian', root = 'C' } = {}) => {
      const n = name === 'random' ? (allModes && allModes.length ? allModes[Math.max(0, ri(allModes.length - 1))] : 'ionian') : name;
      const r = root === 'random' ? (allNotes && allNotes.length ? allNotes[Math.max(0, ri(allNotes.length - 1))] : 'C') : root;
      return new ModeComposer(n, r);
    });

    // Register pentatonic composer
    this.register('pentatonic', ({ root = 'C', scaleType = 'major' } = {}) => {
      const r = root === 'random' ? allNotes && allNotes.length ? allNotes[ri(allNotes.length - 1)] : root : root;
      const t = scaleType === 'random' ? (['major', 'minor'])[ri(2)] : scaleType;
      const inst = new PentatonicComposer(r, t);
      // Registry-level type indicates 'pentatonic' to satisfy callers expecting top-level type
      (inst as any).type = 'pentatonic';
      (inst as any).scaleType = t;
      return inst;
    });

    // Register advanced composers (if they exist)
    if (typeof TensionReleaseComposer === 'function') {
      this.register('tensionRelease', ({ key = allNotes && allNotes.length ? allNotes[ri(allNotes.length - 1)] : 'C', quality = 'major', tensionCurve = 0.5 } = {}) =>
        new TensionReleaseComposer(key, quality, tensionCurve)
      );
    }

    if (typeof ModalInterchangeComposer === 'function') {
      this.register('modalInterchange', ({ key = allNotes && allNotes.length ? allNotes[ri(allNotes.length - 1)] : 'C', primaryMode = 'major', borrowProbability = 0.25 } = {}) =>
        new ModalInterchangeComposer(key, primaryMode, borrowProbability)
      );
    }

    if (typeof HarmonicRhythmComposer === 'function') {
      this.register('harmonicRhythm', ({ progression = ['I','IV','V','I'], key = 'C', measuresPerChord = 2, quality = 'major' } = {}) =>
        new HarmonicRhythmComposer(progression, key, measuresPerChord, quality)
      );
    }

    if (typeof MelodicDevelopmentComposer === 'function') {
      this.register('melodicDevelopment', ({ name = 'major', root = 'C', developmentIntensity = 0.5 } = {}) =>
        new MelodicDevelopmentComposer(name, root, developmentIntensity)
      );
    }

    if (typeof AdvancedVoiceLeadingComposer === 'function') {
      this.register('advancedVoiceLeading', ({ name = 'major', root = 'C', commonToneWeight = 0.7 } = {}) =>
        new AdvancedVoiceLeadingComposer(name, root, commonToneWeight)
      );
    }
  }
}


// Expose on PolychronContext.test for legacy compatibility (do NOT write to the real global object)
poly.test = poly.test || {};
poly.test.ComposerRegistry = ComposerRegistry;

export default ComposerRegistry;
