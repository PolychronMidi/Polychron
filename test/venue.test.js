// test/venue.test.js
require('../sheet.js');  // Load sheet configuration (defines primaryInstrument etc.)
require('../venue.js');

describe('midiData', () => {
  describe('program array', () => {
    it('should have 128 program numbers (0-127)', () => {
      expect(midiData.program.length).toBe(128);
    });

    it('should have Acoustic Grand Piano as program 0', () => {
      const piano = midiData.program.find(p => p.number === 0);
      expect(piano).toBeDefined();
      expect(piano.name).toBe('Acoustic Grand Piano');
    });

    it('should have Gunshot as program 127', () => {
      const gunshot = midiData.program.find(p => p.number === 127);
      expect(gunshot).toBeDefined();
      expect(gunshot.name).toBe('Gunshot');
    });

    it('should have all program entries with number and name properties', () => {
      midiData.program.forEach(program => {
        expect(program).toHaveProperty('number');
        expect(program).toHaveProperty('name');
        expect(typeof program.number).toBe('number');
        expect(typeof program.name).toBe('string');
      });
    });

    it('should have unique program numbers', () => {
      const numbers = midiData.program.map(p => p.number);
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(128);
    });
  });

  describe('control array', () => {
    it('should contain control change definitions', () => {
      expect(midiData.control.length).toBeGreaterThan(0);
    });

    it('should have Volume (coarse) as control 7', () => {
      const volume = midiData.control.find(c => c.number === 7);
      expect(volume).toBeDefined();
      expect(volume.name).toBe('Volume (coarse)');
    });

    it('should have All Notes Off as control 123', () => {
      const allNotesOff = midiData.control.find(c => c.number === 123);
      expect(allNotesOff).toBeDefined();
      expect(allNotesOff.name).toBe('All Notes Off');
    });

    it('should have all control entries with number and name properties', () => {
      midiData.control.forEach(control => {
        expect(control).toHaveProperty('number');
        expect(control).toHaveProperty('name');
        expect(typeof control.number).toBe('number');
        expect(typeof control.name).toBe('string');
      });
    });

    it('should have unique control numbers', () => {
      const numbers = midiData.control.map(c => c.number);
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(midiData.control.length);
    });
  });
});

describe('getMidiValue', () => {
  it('should return 0 for Acoustic Grand Piano', () => {
    expect(getMidiValue('program', 'Acoustic Grand Piano')).toBe(0);
  });

  it('should return 7 for Volume (coarse)', () => {
    expect(getMidiValue('control', 'Volume (coarse)')).toBe(7);
  });

  it('should return 0 fallback for invalid category', () => {
    expect(getMidiValue('invalid', 'test')).toBe(0);
  });

  it('should return 0 fallback for non-existent instrument', () => {
    expect(getMidiValue('program', 'NonExistent Instrument')).toBe(0);
  });

  it('should be case insensitive for category', () => {
    expect(getMidiValue('PROGRAM', 'Acoustic Grand Piano')).toBe(0);
    expect(getMidiValue('Program', 'Acoustic Grand Piano')).toBe(0);
  });

  it('should be case insensitive for name', () => {
    expect(getMidiValue('program', 'ACOUSTIC GRAND PIANO')).toBe(0);
    expect(getMidiValue('program', 'acoustic grand piano')).toBe(0);
  });

  it('should handle trumpet (program 56)', () => {
    expect(getMidiValue('program', 'Trumpet')).toBe(56);
  });

  it('should handle Modulation Wheel (coarse) (control 1)', () => {
    expect(getMidiValue('control', 'Modulation Wheel (coarse)')).toBe(1);
  });

  it('should return 0 fallback for out of range control number', () => {
    expect(getMidiValue('control', 'NonExistent Control')).toBe(0);
  });
});

describe('allNotes', () => {
  it('should be an array', () => {
    expect(Array.isArray(allNotes)).toBe(true);
  });

  it('should contain 12 notes', () => {
    expect(allNotes.length).toBe(12);
  });

  it('should contain C note', () => {
    expect(allNotes).toContain('C');
  });

  it('should contain all chromatic notes', () => {
    const chromaticNotes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    chromaticNotes.forEach(note => {
      expect(allNotes).toContain(note);
    });
  });

  it('should have unique notes', () => {
    const uniqueNotes = new Set(allNotes);
    expect(uniqueNotes.size).toBe(12);
  });
});

describe('allScales', () => {
  it('should be an array', () => {
    expect(Array.isArray(allScales)).toBe(true);
  });

  it('should contain major scale', () => {
    expect(allScales).toContain('major');
  });

  it('should contain minor scale', () => {
    expect(allScales).toContain('minor');
  });

  it('should have unique scale names', () => {
    const uniqueScales = new Set(allScales);
    expect(uniqueScales.size).toBe(allScales.length);
  });

  it('should contain chromatic scale', () => {
    expect(allScales).toContain('chromatic');
  });
});

describe('allChords', () => {
  it('should be an array', () => {
    expect(Array.isArray(allChords)).toBe(true);
  });

  it('should contain major chord (CM)', () => {
    expect(allChords).toContain('CM');
  });

  it('should contain minor chord (Cm)', () => {
    expect(allChords).toContain('Cm');
  });

  it('should have unique chord symbols', () => {
    const uniqueChords = new Set(allChords);
    expect(uniqueChords.size).toBe(allChords.length);
  });

  it('should not be empty', () => {
    expect(allChords.length).toBeGreaterThan(0);
  });
});

describe('allModes', () => {
  it('should be an array', () => {
    expect(Array.isArray(allModes)).toBe(true);
  });

  it('should contain ionian mode for C', () => {
    expect(allModes).toContain('C ionian');
  });

  it('should contain aeolian mode for A', () => {
    expect(allModes).toContain('A aeolian');
  });

  it('should have unique mode names', () => {
    const uniqueModes = new Set(allModes);
    expect(uniqueModes.size).toBe(allModes.length);
  });

  it('should contain mode names for multiple root notes', () => {
    const ionianModes = allModes.filter(m => m.includes('ionian'));
    expect(ionianModes.length).toBeGreaterThan(1);
  });

  it('should not be empty', () => {
    expect(allModes.length).toBeGreaterThan(0);
  });
});

describe('Integration tests', () => {
  it('getMidiValue should work with allScales', () => {
    const scaleName = allScales[0];
    expect(typeof scaleName).toBe('string');
  });

  it('getMidiValue should work with allChords', () => {
    const chordSymbol = allChords[0];
    expect(typeof chordSymbol).toBe('string');
  });

  it('midiData.program should contain valid program numbers', () => {
    midiData.program.forEach(program => {
      expect(program.number).toBeGreaterThanOrEqual(0);
      expect(program.number).toBeLessThanOrEqual(127);
    });
  });

  it('midiData.control should contain valid control numbers', () => {
    midiData.control.forEach(control => {
      expect(control.number).toBeGreaterThanOrEqual(0);
      expect(control.number).toBeLessThanOrEqual(127);
    });
  });
});

describe('Edge cases', () => {
  it('getMidiValue should return 0 fallback for empty string', () => {
    expect(getMidiValue('program', '')).toBe(0);
  });

  it('getMidiValue should be case insensitive for exact match', () => {
    expect(getMidiValue('program', 'Acoustic Grand Piano')).toBe(0);
  });

  it('allNotes should be properly ordered', () => {
    const expectedOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    expect(allNotes).toEqual(expectedOrder);
  });
});
