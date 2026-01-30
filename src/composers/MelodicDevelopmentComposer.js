const ScaleComposer = require('./ScaleComposer').ScaleComposer || require('./ScaleComposer');

class MelodicDevelopmentComposer extends ScaleComposer {
  constructor(name = 'major', root = 'C', intensity = 0.5) {
    const resolvedRoot = root === 'random' ? allNotes[ri(allNotes.length - 1)] : root;
    const resolvedName = name === 'random' ? allScales[ri(allScales.length - 1)] : name;
    super(resolvedName, resolvedRoot);
    this.intensity = clamp(intensity, 0, 1);
    this.motifPhase = 0;
    this.measureCount = 0;
    this.responseMode = false;
    this.transpositionOffset = 0;
  }

  getNotes(octaveRange) {
    const baseNotes = super.getNotes(octaveRange);
    if (baseNotes.length === 0) return baseNotes;
    this.measureCount++;
    const phase = m.floor((this.measureCount - 1) / 2) % 4;
    let developedNotes = [...baseNotes];
    const intensity = this.intensity;
    switch (phase) {
      case 0:
        this.transpositionOffset = intensity > 0.5 ? ri(-2, 2) : 0;
        developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
        break;
      case 1:
        this.transpositionOffset = m.round(intensity * 7);
        developedNotes = baseNotes.map(n => ({ ...n, note: clamp(n.note + this.transpositionOffset, 0, 127) }));
        break;
      case 2:
        if (intensity > 0.3) {
          const pivot = baseNotes[0]?.note || 60;
          developedNotes = baseNotes.map((n, i) => ({ ...n, note: clamp(2 * pivot - n.note, 0, 127) }));
        }
        break;
      case 3:
        if (intensity > 0.5) developedNotes = [...baseNotes].reverse();
        break;
    }
    if (rf() < 0.3) {
      this.responseMode = !this.responseMode;
      if (this.responseMode) {
        developedNotes = developedNotes.map((n, i) => ({ ...n, duration: (n.duration || 480) * (intensity + 0.5) }));
      }
    }
    return developedNotes;
  }

  setintensity(intensity) {
    this.intensity = clamp(intensity, 0, 1);
  }

  resetMotifPhase() {
    this.motifPhase = 0;
    this.measureCount = 0;
    this.responseMode = false;
    this.transpositionOffset = 0;
  }
}

try { module.exports = MelodicDevelopmentComposer; } catch (e) { /* swallow */ }
