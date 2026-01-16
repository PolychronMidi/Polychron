// @ts-check
// MeasureComposer - Base class for all composers
// Handles meter composition, note generation, and optional voice leading

/**
 * Composes meter-related values with randomization.
 * @class
 */
class MeasureComposer {
  lastMeter: number[] | null;
  recursionDepth: number;
  MAX_RECURSION: number;
  voiceLeading: any;
  voiceHistory: number[];
  notes: string[];

  constructor() {
    this.lastMeter = null;
    this.recursionDepth = 0;
    this.MAX_RECURSION = 5;
    this.voiceLeading = null;
    this.voiceHistory = [];
    this.notes = [];
  }

  getNumerator(): number {
    const { min, max, weights } = NUMERATOR;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getDenominator(): number {
    const { min, max, weights } = DENOMINATOR;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getDivisions(): number {
    const { min, max, weights } = DIVISIONS;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getSubdivisions(): number {
    const { min, max, weights } = SUBDIVISIONS;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getSubsubdivs(): number {
    const { min, max, weights } = SUBSUBDIVS;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getVoices(): number {
    const { min, max, weights } = VOICES;
    return m.floor(rw(min, max, weights) * (rf() > 0.5 ? bpmRatio : 1));
  }

  getOctaveRange(): number[] {
    const { min, max, weights } = OCTAVE;
    let [o1, o2] = [rw(min, max, weights), rw(min, max, weights)];
    while (m.abs(o1 - o2) < ri(2, 3)) {
      o2 = modClamp(o2 + ri(-3, 3), min, max);
    }
    return [o1, o2];
  }

  getMeter(ignoreRatioCheck = false, polyMeter = false, maxIterations = 200, timeLimitMs = 100): number[] {
    const METER_RATIO_MIN = 0.25;
    const METER_RATIO_MAX = 4;
    const MIN_LOG_STEPS = 0.5;
    const FALLBACK_METER = [4, 4];

    let iterations = 0;
    const maxLogSteps = polyMeter ? 4 : 2;
    const startTs = Date.now();

    while (++iterations <= maxIterations && (Date.now() - startTs) <= timeLimitMs) {
      let newNumerator = this.getNumerator();
      let newDenominator = this.getDenominator();

      if (!Number.isInteger(newNumerator) || !Number.isInteger(newDenominator) || newNumerator <= 0 || newDenominator <= 0) {
        continue;
      }

      let newMeterRatio = newNumerator / newDenominator;
      const ratioValid = ignoreRatioCheck || (newMeterRatio >= METER_RATIO_MIN && newMeterRatio <= METER_RATIO_MAX);

      if (ratioValid) {
        if (this.lastMeter) {
          let lastMeterRatio = this.lastMeter[0] / this.lastMeter[1];
          let logSteps = m.abs(m.log(newMeterRatio / lastMeterRatio) / m.LN2);
          if (logSteps >= MIN_LOG_STEPS && logSteps <= maxLogSteps) {
            this.lastMeter = [newNumerator, newDenominator];
            return this.lastMeter;
          }
        } else {
          this.lastMeter = [newNumerator, newDenominator];
          return this.lastMeter;
        }
      }
    }

    console.warn(
      `getMeter() failed after ${iterations} iterations or ${Date.now() - startTs}ms. ` +
      `Ratio bounds: [${METER_RATIO_MIN}, ${METER_RATIO_MAX}]. ` +
      `LogSteps range: [${MIN_LOG_STEPS}, ${maxLogSteps}]. ` +
      `Returning fallback: [${FALLBACK_METER[0]}, ${FALLBACK_METER[1]}]`
    );
    this.lastMeter = FALLBACK_METER;
    return this.lastMeter;
  }

  getNotes(octaveRange: number[] | null = null): { note: number }[] {
    if (++this.recursionDepth > this.MAX_RECURSION) {
      console.warn('getNotes recursion limit exceeded; returning fallback note 0');
      this.recursionDepth = 0;
      return [{ note: 0 }];
    }

    const uniqueNotes = new Set();
    const voices = this.getVoices();
    const [minOctave, maxOctave] = octaveRange || this.getOctaveRange();
    const rootNote = this.notes[ri(this.notes.length - 1)];
    let intervals: number[] = [];
    let fallback = false;

    try {
      const shift = ri();
      switch (ri(2)) {
        case 0:
          intervals = [0, 2, 3 + shift, 6 - shift].map((interval: number) =>
            clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)
          );
          break;
        case 1:
          intervals = [0, 1, 3 + shift, 5 + shift].map((interval: number) =>
            clamp(interval * m.round(this.notes.length / 7), 0, this.notes.length - 1)
          );
          break;
        default:
          intervals = Array.from({ length: this.notes.length }, (_, i) => i);
          fallback = true;
      }

      intervals = intervals.map((interval: number) => {
        const validatedInterval = clamp(interval, 0, this.notes.length - 1);
        const rootIndex = this.notes.indexOf(rootNote);
        const noteIndex = (rootIndex + validatedInterval) % this.notes.length;
        return validatedInterval;
      });

      return intervals.slice(0, voices).map((interval: number) => {
        const noteIndex = (this.notes.indexOf(rootNote) + interval) % this.notes.length;
        let octave = ri(minOctave, maxOctave);
        let note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
        let attempts = 0;
        while (uniqueNotes.has(note) && attempts < 10) {
          octave =
            octave < maxOctave
              ? octave++
              : octave > minOctave
                ? octave--
                : octave < OCTAVE.max
                  ? octave++
                  : octave > OCTAVE.min
                    ? octave--
                    : (false as any);
          if (octave === false) break;
          note = t.Note.chroma(this.notes[noteIndex]) + 12 * octave;
          attempts++;
        }
        uniqueNotes.add(note);
        return { note };
      }).filter((noteObj, index, self) =>
        index === self.findIndex(n => n.note === noteObj.note)
      );
    } catch (e) {
      const error = e as any;
      if (!fallback) {
        this.recursionDepth--;
        return this.getNotes(octaveRange);
      } else {
        console.warn(error.message);
        this.recursionDepth--;
        return this.getNotes(octaveRange);
      }
    } finally {
      this.recursionDepth--;
    }
  }

  enableVoiceLeading(scorer?: any): void {
    this.voiceLeading = scorer || new VoiceLeadingScore();
    this.voiceHistory = [];
  }

  disableVoiceLeading(): void {
    this.voiceLeading = null;
    this.voiceHistory = [];
  }

  selectNoteWithLeading(availableNotes: number[], config: { register?: string; constraints?: string[] } = {}): number {
    if (!this.voiceLeading || !availableNotes || availableNotes.length === 0) {
      return (availableNotes as any)?.[ri(availableNotes.length - 1)] ?? 60;
    }

    const selectedNote = this.voiceLeading.selectNextNote(this.voiceHistory, availableNotes, config);
    this.voiceHistory.push(selectedNote);

    if (this.voiceHistory.length > 4) {
      this.voiceHistory.shift();
    }

    return selectedNote;
  }

  resetVoiceLeading(): void {
    this.voiceHistory = [];
    if (this.voiceLeading) {
      this.voiceLeading.reset();
    }
  }
}


// Export to global scope
globalThis.MeasureComposer = MeasureComposer;
export { MeasureComposer };
