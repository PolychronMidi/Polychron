// Logger - Simple logging utility
export class Logger {
  constructor(config = {}) {
    this.config = {
      level: 'section,phrase,measure',
      enabled: true,
      ...config
    };
  }

  info(message, ...args) {
    if (this.config.enabled) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  warn(message, ...args) {
    if (this.config.enabled) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message, ...args) {
    if (this.config.enabled) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  debug(message, ...args) {
    if (this.config.enabled) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  logUnit(type, state, csvWriter) {
    let shouldLog = false;
    type = type.toLowerCase();
    
    if (this.config.level === 'none') shouldLog = false;
    else if (this.config.level === 'all') shouldLog = true;
    else {
      const logList = this.config.level.split(',').map(item => item.trim());
      shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
    }
    
    if (!shouldLog || !this.config.enabled) return null;

    const logData = this.buildLogData(type, state);
    
    if (csvWriter && logData) {
      csvWriter.addMarker(logData.startTick, logData.message);
    }
  }

  buildLogData(type, state) {
    let unit, unitsPerParent, startTick, endTick, startTime, endTime;
    let meterInfo = '';
    let composerDetails = '';

    switch (type) {
      case 'section':
        unit = (state.get('sectionIndex') || 0) + 1;
        unitsPerParent = state.get('totalSections') || 1;
        startTick = state.get('sectionStart') || 0;
        startTime = state.get('sectionStartTime') || 0;
        endTime = startTime + (state.get('spSection') || 0);
        composerDetails = this.getComposerDetails(state.get('composer'));
        break;

      case 'phrase':
        unit = (state.get('phraseIndex') || 0) + 1;
        unitsPerParent = state.get('phrasesPerSection') || 1;
        startTick = state.get('phraseStart') || 0;
        startTime = state.get('phraseStartTime') || 0;
        endTime = startTime + (state.get('spPhrase') || 0);
        break;

      case 'measure':
        unit = (state.get('measureIndex') || 0) + 1;
        unitsPerParent = state.get('measuresPerPhrase') || 1;
        startTick = state.get('measureStart') || 0;
        startTime = state.get('measureStartTime') || 0;
        endTime = startTime + (state.get('spMeasure') || 0);
        composerDetails = this.getComposerDetails(state.get('composer'));
        
        const actualMeter = [state.get('numerator'), state.get('denominator')];
        const midiMeter = state.get('midiMeter') || actualMeter;
        
        meterInfo = midiMeter[1] === actualMeter[1] 
          ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails}`
          : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails}`;
        break;

      case 'beat':
        unit = (state.get('beatIndex') || 0) + 1;
        unitsPerParent = state.get('numerator') || 4;
        startTick = state.get('beatStart') || 0;
        startTime = state.get('beatStartTime') || 0;
        endTime = startTime + (state.get('spBeat') || 0);
        break;

      case 'division':
        unit = (state.get('divIndex') || 0) + 1;
        unitsPerParent = state.get('divsPerBeat') || 1;
        startTick = state.get('divStart') || 0;
        startTime = state.get('divStartTime') || 0;
        endTime = startTime + (state.get('spDiv') || 0);
        break;

      case 'subdivision':
        unit = (state.get('subdivIndex') || 0) + 1;
        unitsPerParent = state.get('subdivsPerDiv') || 1;
        startTick = state.get('subdivStart') || 0;
        startTime = state.get('subdivStartTime') || 0;
        endTime = startTime + (state.get('spSubdiv') || 0);
        break;

      case 'subsubdivision':
        unit = (state.get('subsubdivIndex') || 0) + 1;
        unitsPerParent = state.get('subsubdivsPerSubdiv') || 1;
        startTick = state.get('subsubdivStart') || 0;
        startTime = state.get('subsubdivStartTime') || 0;
        endTime = startTime + (state.get('spSubsubdiv') || 0);
        break;

      default:
        return null;
    }

    const message = `${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${this.formatTime(endTime - startTime)} (${this.formatTime(startTime)} - ${this.formatTime(endTime)}) ${meterInfo ? meterInfo : ''}`;

    return {
      startTick,
      endTick,
      startTime,
      endTime,
      message
    };
  }

  getComposerDetails(composer) {
    if (!composer) return '';
    
    let details = composer.constructor.name + ' ';
    
    if (composer.scale && composer.scale.name) {
      details += `${composer.root} ${composer.scale.name}`;
    } else if (composer.progression) {
      const progressionSymbols = composer.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      details += progressionSymbols;
    } else if (composer.mode && composer.mode.name) {
      details += `${composer.root} ${composer.mode.name}`;
    }
    
    return details;
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(4).padStart(7, '0');
    return `${minutes}:${secs}`;
  }
}