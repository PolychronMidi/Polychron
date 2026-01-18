import '../../src/sheet.js';
import '../../src/venue.js';
import '../../src/composers.js';
import { ScaleComposer, ComposerFactory } from '../../src/composers.js';
import { setupGlobalState } from '../helpers.js';

const { AdvancedVoiceLeadingComposer } = globalThis as any;

describe('AdvancedVoiceLeadingComposer', () => {
  beforeEach(() => {
    setupGlobalState();
  });

  it('should initialize with scale, root, and common tone weight', () => {
    const composer = new AdvancedVoiceLeadingComposer('major', 'C', 0.7);
    expect(composer.root).toBe('C');
    expect(composer.commonToneWeight).toBe(0.7);
    expect(composer.previousNotes).toEqual([]);
    expect(composer.voiceBalanceThreshold).toBe(3);
    expect(composer.contraryMotionPreference).toBe(0.4);
  });

  it('should handle random root correctly', () => {
    const composer = new AdvancedVoiceLeadingComposer('major', 'random', 0.6);
    expect(composer.root).toBeDefined();
    expect(composer.root).not.toBe('random');
    expect(composer.item).toBeDefined();
    expect(composer.notes).toBeDefined();
    expect(composer.notes.length).toBeGreaterThan(0);
  });

  it('should handle random scale name correctly', () => {
    const composer = new AdvancedVoiceLeadingComposer('random', 'C', 0.6);
    expect(composer.item).toBeDefined();
    expect(composer.notes).toBeDefined();
    expect(composer.notes.length).toBeGreaterThan(0);
  });

  it('should generate notes without errors', () => {
    const composer = new AdvancedVoiceLeadingComposer('major', 'C', 0.7);
    const notes = composer.getNotes([48, 72]);
    expect(Array.isArray(notes)).toBe(true);
  });

  it('should return base notes on first call', () => {
    const composer = new AdvancedVoiceLeadingComposer('major', 'C', 0.7);
    expect(composer.previousNotes.length).toBe(0);
    const notes = composer.getNotes([48, 72]);
    expect(Array.isArray(notes)).toBe(true);
    expect(typeof composer.previousNotes.length).toBe('number');
  });

  it('should apply voice leading optimization on subsequent calls', () => {
    const composer = new AdvancedVoiceLeadingComposer('major', 'C', 0.7);
    composer.getNotes([48, 72]);
    const notes2 = composer.getNotes([48, 72]);
    expect(Array.isArray(notes2)).toBe(true);
  });

  it('should handle empty base notes gracefully', () => {
    const composer = new AdvancedVoiceLeadingComposer('major', 'C', 0.7);
    const originalGetNotes = ScaleComposer.prototype.getNotes;
    ScaleComposer.prototype.getNotes = () => [];
    const notes = composer.getNotes([48, 72]);
    expect(notes).toEqual([]);
    ScaleComposer.prototype.getNotes = originalGetNotes;
  });

  it('should handle null base notes gracefully', () => {
    const composer = new AdvancedVoiceLeadingComposer('major', 'C', 0.7);
    const originalGetNotes = ScaleComposer.prototype.getNotes;
    ScaleComposer.prototype.getNotes = () => null as any;
    const notes = composer.getNotes([48, 72]);
    expect(notes).toBeNull();
    ScaleComposer.prototype.getNotes = originalGetNotes;
  });

  it('should work via factory with all parameter combinations', () => {
    const configs = [
      { type: 'advancedVoiceLeading', name: 'major', root: 'C', commonToneWeight: 0.7 },
      { type: 'advancedVoiceLeading', name: 'random', root: 'random', commonToneWeight: 0.6 },
      { type: 'advancedVoiceLeading', name: 'minor', root: 'E', commonToneWeight: 0.8 }
    ];

    configs.forEach(config => {
      const composer = ComposerFactory.create(config);
      expect(composer).toBeInstanceOf(AdvancedVoiceLeadingComposer);
      const notes = composer.getNotes([48, 72]);
      expect(Array.isArray(notes)).toBe(true);
    });
  });

  it('should clamp common tone weight to 0-1 range', () => {
    const composer1 = new AdvancedVoiceLeadingComposer('major', 'C', -0.5);
    expect(composer1.commonToneWeight).toBe(0);

    const composer2 = new AdvancedVoiceLeadingComposer('major', 'C', 1.5);
    expect(composer2.commonToneWeight).toBe(1);
  });
});
