# **writer.js** ([code](../src/writer.js)) ([doc](writer.md)) - MIDI Output and File Generation

> **Source**: `src/writer.js`
> **Status**: Core Module - Output & File I/O
> **Dependencies**: **time.js** ([code](../src/time.js)) ([doc](time.md)) ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)), **backstage.js** ([code](../src/backstage.js)) ([doc](backstage.md)) ([code](../src/backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)))) ([doc](backstage.md)), fs (Node.js)

## Overview

****writer.js** ([code](../src/writer.js)) ([doc](writer.md))** ([code](../src/writer.js ([code](../src/writer.js)) ([doc](writer.md)))) ([doc](writer.md)) handles all MIDI file output - CSV buffer management, timing marker logging, and final file generation. It encapsulates the "writing to disk" functionality that transforms in-memory MIDI events into playable MIDI files.

**Core Responsibilities:**
- **Buffer management** - CSVBuffer class for layer-specific event storage
- **Event pushing** - Universal `p()` function for adding MIDI events
- **Timing markers** - Logging support for debugging and analysis
- **File generation** - Multi-layer CSV/MIDI output via `grandFinale()`
- **Error handling** - Filesystem operations with logging

## Architecture Role

****writer.js** ([code](../src/writer.js)) ([doc](writer.md))** ([code](../src/writer.js ([code](../src/writer.js)) ([doc](writer.md)))) ([doc](writer.md)) is the **output layer**:
- ****play.js** ([code](../src/play.js)) ([doc](play.md))** ([code](../src/play.js ([code](../src/play.js)) ([doc](play.md)))) ([doc](play.md)) - Calls grandFinale() at composition end
- **All modules** - Generate events via `p(c, event)`
- ****time.js** ([code](../src/time.js)) ([doc](time.md))** ([code](../src/time.js ([code](../src/time.js)) ([doc](time.md)))) ([doc](time.md)) - Timing markers use time.md logUnit()
- **Layer-aware** - Automatically routes events to active layer's buffer

---

## CSVBuffer Class: Event Encapsulation

Wraps MIDI event arrays with metadata while preserving minimalist syntax:

<!-- BEGIN: snippet:CSVBuffer -->

```javascript
/**
 * Layer-aware MIDI event buffer.
 * @class CSVBuffer
 * @param {string} name - Layer identifier ('primary', 'poly', etc.).
 * @property {string} name - Layer identifier.
 * @property {Array<object>} rows - MIDI event objects: {tick, type, vals}.
 * @property {number} length - Read-only count of events.
 */
CSVBuffer = class CSVBuffer {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  push(...items) {
    this.rows.push(...items);
  }
  get length() {
    return this.rows.length;
  }
  clear() {
    this.rows = [];
  }
};

/**
 * Push multiple items onto a buffer/array.
 * @param {CSVBuffer|Array} buffer - The target buffer to push onto.
 * @param {...*} items - Items to push onto the buffer.
 * @returns {void}
 */
p=pushMultiple=(buffer,...items)=>{  buffer.push(...items);  };

// Initialize buffers (c1/c2 created here, layers register them in play.js)
c1=new CSVBuffer('primary');
c2=new CSVBuffer('poly');
c=c1;  // Active buffer reference


/**
 * Logs timing markers with context awareness.
 * Writes to active buffer (c = c1 or c2) for proper file separation.
 *
 * @param {string} type - Unit type: 'section', 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'
 */
logUnit = (type) => {
  let shouldLog = false;
  type = type.toLowerCase();
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else {
    const logList = LOG.toLowerCase().split(',').map(item => item.trim());
    shouldLog = logList.length === 1 ? logList[0] === type : logList.includes(type);
  }
  if (!shouldLog) return null;
  let meterInfo = '';

  if (type === 'section') {
    unit = sectionIndex + 1;
    unitsPerParent = totalSections;
    startTick = sectionStart;
    spSection = tpSection / tpSec;
    endTick = startTick + tpSection;
    startTime = sectionStartTime;
    endTime = startTime + spSection;
  } else if (type === 'phrase') {
    unit = phraseIndex + 1;
    unitsPerParent = phrasesPerSection;
    startTick = phraseStart;
    endTick = startTick + tpPhrase;
    startTime = phraseStartTime;
    spPhrase = tpPhrase / tpSec;
    endTime = startTime + spPhrase;
    composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
    if (composer && composer.scale && composer.scale.name) {
      composerDetails += `${composer.root} ${composer.scale.name}`;
    } else if (composer && composer.progression) {
      progressionSymbols = composer.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    } else if (composer && composer.mode && composer.mode.name) {
      composerDetails += `${composer.root} ${composer.mode.name}`;
    }
    actualMeter = [numerator, denominator];
    meterInfo = midiMeter[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
  } else if (type === 'measure') {
    unit = measureIndex + 1;
    unitsPerParent = measuresPerPhrase;
    startTick = measureStart;
    endTick = measureStart + tpMeasure;
    startTime = measureStartTime;
    endTime = measureStartTime + spMeasure;
    composerDetails = composer ? `${composer.constructor.name} ` : 'Unknown Composer ';
    if (composer && composer.scale && composer.scale.name) {
      composerDetails += `${composer.root} ${composer.scale.name}`;
    } else if (composer && composer.progression) {
      progressionSymbols = composer.progression.map(chord => {
        return chord && chord.symbol ? chord.symbol : '[Unknown Symbol]';
      }).join(' ');
      composerDetails += `${progressionSymbols}`;
    } else if (composer && composer.mode && composer.mode.name) {
      composerDetails += `${composer.root} ${composer.mode.name}`;
    }
    actualMeter = [numerator, denominator];
    meterInfo = midiMeter[1] === actualMeter[1]
      ? `Meter: ${actualMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`
      : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')} Composer: ${composerDetails} tpSec: ${tpSec}`;
  } else if (type === 'beat') {
    unit = beatIndex + 1;
    unitsPerParent = numerator;
    startTick = beatStart;
    endTick = startTick + tpBeat;
    startTime = beatStartTime;
    endTime = startTime + spBeat;
  } else if (type === 'division') {
    unit = divIndex + 1;
    unitsPerParent = divsPerBeat;
    startTick = divStart;
    endTick = startTick + tpDiv;
    startTime = divStartTime;
    endTime = startTime + spDiv;
  } else if (type === 'subdivision') {
    unit = subdivIndex + 1;
    unitsPerParent = subdivsPerDiv;
    startTick = subdivStart;
    endTick = startTick + tpSubdiv;
    startTime = subdivStartTime;
    endTime = startTime + spSubdiv;
  } else if (type === 'subsubdivision') {
    unit = subsubdivIndex + 1;
    unitsPerParent = subsubsPerSub;
    startTick = subsubdivStart;
    endTick = startTick + tpSubsubdiv;
    startTime = subsubdivStartTime;
    endTime = startTime + spSubsubdiv;
  }

  return (() => {
    c.push({
      tick: startTick,
      type: 'marker_t',
      vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) endTick: ${endTick} ${meterInfo ? meterInfo : ''}`]
    });
  })();
};

/**
 * Outputs separate MIDI files for each layer with automatic synchronization.
 * @description
 * Architecture:
 * - output1.csv/mid: Primary layer with its syncFactor
 * - output2.csv/mid: Poly layer with independent syncFactor
 * - output3.csv/mid+: Additional layers (when added)
 * - Phrase boundaries align perfectly in absolute time (seconds)
 * - Tick counts differ due to different tempo adjustments
 * - Automatically handles any number of layers
 * @returns {void}
 */
grandFinale = () => {

  // Collect all layer data
  const layerData = Object.entries(LM.layers).map(([name, layer]) => {
    return {
      name,
      layer: layer.state,
      buffer: layer.buffer instanceof CSVBuffer ? layer.buffer.rows : layer.buffer
    };
  });

  // Process each layer's output
  layerData.forEach(({ name, layer: layerState, buffer }) => {
    c = buffer;
    // Cleanup
    allNotesOff((layerState.sectionEnd || layerState.sectionStart) + PPQ);
    muteAll((layerState.sectionEnd || layerState.sectionStart) + PPQ * 2);
    // Finalize buffer
    buffer = buffer.filter(i => i !== null)
      .map(i => ({
        ...i,
        tick: isNaN(i.tick) || i.tick < 0 ? Math.abs(i.tick || 0) * rf(.1, .3) : i.tick
      }))
      .sort((a, b) => a.tick - b.tick);

    // Generate CSV
    let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
    let finalTick = -Infinity;

    buffer.forEach(_ => {
      if (!isNaN(_.tick)) {
        let type = _.type === 'on' ? 'note_on_c' : (_.type || 'note_off_c');
        composition += `1,${_.tick || 0},${type},${_.vals.join(',')}\n`;
        finalTick = Math.max(finalTick, _.tick);

      }
    });

    composition += `1,${finalTick + (SILENT_OUTRO_SECONDS * layerState.tpSec)},end_track`;

    // Determine output filename based on layer name
    let outputFilename;
    if (name === 'primary') {
      outputFilename = 'output/output1.csv';
    } else if (name === 'poly') {
      outputFilename = 'output/output2.csv';
    } else {
      // For additional layers, use name-based numbering
      outputFilename = `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    }

    // Ensure output directory exists
    const path = require('path');
    const outputDir = path.dirname(outputFilename);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputFilename, composition);
    console.log(`${outputFilename} created (${name} layer).`);

  });

};

/**
 * Node.js filesystem module with wrapped writeFileSync for error logging.
 * @type {Object}
 */
fs=require('fs');
// Wrap writeFileSync to log errors centrally
try {
  const _origWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function(...args) {
    try {
      return _origWriteFileSync.apply(fs, args);
    } catch (err) {
      console.error('Failed to write', args[0] || '', err);
      throw err;
    }
  };
} catch (err) {
  console.error('Failed to wrap fs.writeFileSync:', err);
}

// Export to globalThis test namespace for clean test access
if (typeof globalThis !== 'undefined') {
  globalThis.__POLYCHRON_TEST__ = globalThis.__POLYCHRON_TEST__ || {};
  Object.assign(globalThis.__POLYCHRON_TEST__, { p });
}

```

<!-- END: snippet:CSVBuffer -->

### Usage Pattern

```javascript
c1 = new CSVBuffer('primary');
c2 = new CSVBuffer('poly');
c = c1;  // Active buffer reference

// Same syntax as array days - completely backward compatible
p(c, {tick: 0, type: 'on', vals: [0, 60, 99]});
p(c,
  {tick: 100, type: 'on', vals: [0, 64, 99]},
  {tick: 200, type: 'off', vals: [0, 64]}
);
```

### Properties

#### `name` (string)
- Layer identifier ('primary', 'poly', or custom)
- Used by `grandFinale()` to determine filenames
- Appears in log messages

#### `rows` (array)
- Array of MIDI event objects
- Each event: `{tick: number, type: string, vals: array}`
- Direct array access available when needed

#### `length` (getter)
- Returns `rows.length`
- Allows buffer to act like array: `if (c.length > 0)`
- Read-only computed property

---

## Push Operations: `p()`

Universal function for adding events to any buffer:

```javascript
p = pushMultiple = (buffer, ...items) => {
  buffer.push(...items);
};
```

### Usage Examples

**Single event:**
```javascript
p(c, {tick: 0, type: 'on', vals: [0, 60, 99]});
```

**Multiple events:**
```javascript
p(c,
  {tick: 0, type: 'on', vals: [0, 60, 99]},
  {tick: 100, type: 'on', vals: [0, 64, 99]},
  {tick: 200, type: 'off', vals: [0, 60]}
);
```

**Works with arrays (backward compatible):**
```javascript
const arr = [];
p(arr, {a: 1}, {b: 2});
```

### Design
## `grandFinale()` - Multi-Layer File Generation

Outputs separate CSV files per layer and logs creation.

<!-- BEGIN: snippet:Writer_grandFinale -->

```javascript
/**
 * Outputs separate MIDI files for each layer with automatic synchronization.
 * @description
 * Architecture:
 * - output1.csv/mid: Primary layer with its syncFactor
 * - output2.csv/mid: Poly layer with independent syncFactor
 * - output3.csv/mid+: Additional layers (when added)
 * - Phrase boundaries align perfectly in absolute time (seconds)
 * - Tick counts differ due to different tempo adjustments
 * - Automatically handles any number of layers
 * @returns {void}
 */
grandFinale = () => {

  // Collect all layer data
  const layerData = Object.entries(LM.layers).map(([name, layer]) => {
    return {
      name,
      layer: layer.state,
      buffer: layer.buffer instanceof CSVBuffer ? layer.buffer.rows : layer.buffer
    };
  });

  // Process each layer's output
  layerData.forEach(({ name, layer: layerState, buffer }) => {
    c = buffer;
    // Cleanup
    allNotesOff((layerState.sectionEnd || layerState.sectionStart) + PPQ);
    muteAll((layerState.sectionEnd || layerState.sectionStart) + PPQ * 2);
    // Finalize buffer
    buffer = buffer.filter(i => i !== null)
      .map(i => ({
        ...i,
        tick: isNaN(i.tick) || i.tick < 0 ? Math.abs(i.tick || 0) * rf(.1, .3) : i.tick
      }))
      .sort((a, b) => a.tick - b.tick);

    // Generate CSV
    let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
    let finalTick = -Infinity;

    buffer.forEach(_ => {
      if (!isNaN(_.tick)) {
        let type = _.type === 'on' ? 'note_on_c' : (_.type || 'note_off_c');
        composition += `1,${_.tick || 0},${type},${_.vals.join(',')}\n`;
        finalTick = Math.max(finalTick, _.tick);

      }
    });

    composition += `1,${finalTick + (SILENT_OUTRO_SECONDS * layerState.tpSec)},end_track`;

    // Determine output filename based on layer name
    let outputFilename;
    if (name === 'primary') {
      outputFilename = 'output/output1.csv';
    } else if (name === 'poly') {
      outputFilename = 'output/output2.csv';
    } else {
      // For additional layers, use name-based numbering
      outputFilename = `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    }

    // Ensure output directory exists
    const path = require('path');
    const outputDir = path.dirname(outputFilename);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputFilename, composition);
    console.log(`${outputFilename} created (${name} layer).`);

  });

};
```

<!-- END: snippet:Writer_grandFinale -->

- **Minimal syntax** - Short function name for frequent use
- **Flexible target** - Works with CSVBuffer or arrays
- **Spread operator** - Handles any number of items efficiently
- **Zero overhead** - Direct delegation

---

## Timing Markers: `logUnit()`

Logs timing boundary markers for debugging and composition analysis:

```javascript
logUnit = (type) => {
  // Controlled by LOG variable: 'none', 'all', or comma-separated types
  if (LOG === 'none') return null;

  let unit, unitsPerParent, startTick, endTick, startTime, endTime;

  if (type === 'section') {
    unit = sectionIndex + 1;
    unitsPerParent = totalSections;
    startTick = sectionStart;
    endTick = startTick + tpSection;
    startTime = sectionStartTime;
    endTime = startTime + (tpSection / tpSec);
  } else if (type === 'phrase') {
    unit = phraseIndex + 1;
    unitsPerParent = measuresPerPhrase;
    startTick = phraseStart;
    endTick = phraseStart + tpPhrase;
    startTime = phraseStartTime;
    endTime = phraseStartTime + spPhrase;
    meterInfo = `Meter: ${numerator}/${denominator}`;
  } else if (type === 'measure') {
    // ... similar pattern ...
  }
  // ... beat, division, subdivision, subsubdivision ...

  p(c, {
    tick: startTick,
    type: 'marker_t',
    vals: [`${type} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)}`]
  });
};
```

### Configuration

Controlled by global `LOG` variable (set in **sheet.js** ([code](../src/sheet.js)) ([doc](sheet.md))):
- **`LOG = 'none'`** - No markers
- **`LOG = 'all'`** - All markers
- **`LOG = 'phrase,measure'`** - Specific types (comma-separated)

### Output Format

Marker written to active buffer as MIDI text event:
```
Phrase 2/4 Length: 2.000s (4.000s - 6.000s) Meter: 7/8 tpSec: 960
```

Includes:
- Unit type and number (e.g., "Phrase 3/12")
- Duration in MM:SS.ssss format
- Start and end time
- Meter information for timing verification
- Composer details and timing constants

### Use Cases

**Development:**
- Verify timing calculations are correct
- Debug polyrhythmic alignment issues
- Check composition structure

**Analysis:**
- Understand generated composition layout
- Trace timing through complex polyrhythms
- Export timing data for external analysis

---

## File Generation: `grandFinale()`

Outputs separate CSV/MIDI files for each registered layer:

```javascript
grandFinale = () => {
  const outputDir = 'output';

  Object.values(LM.layers).forEach(layer => {
    const {buffer, state} = layer;
    const filename = `${outputDir}/${buffer.name}.csv`;

    // Convert CSVBuffer rows to CSV string
    const csvContent = buffer.rows.map(row => {
      // Convert event object to CSV row format
      return csvToString(row);
    }).join('\n');

    // Write to filesystem
    try {
      fs.writeFileSync(filename, csvContent, 'utf8');
      console.log(`Written: ${filename} (${buffer.length} events)`);
    } catch (e) {
      console.error(`Failed to write ${filename}:`, e.message);
    }
  });

  // Optionally convert CSV to MIDI binary format
  // (depends on external MIDI library integration)
};
```

### Process

1. **Iterate layers** - For each registered layer via LM.layers
2. **Extract events** - Get CSVBuffer rows for layer
3. **Convert to CSV** - Transform event objects to CSV string format
4. **Write files** - Create separate file per layer in output/ directory
5. **Log results** - Report file creation and event counts

### Output Structure

**Primary layer** → `output/primary.csv`
**Poly layer** → `output/poly.csv`
**Multiple layers** → One file per layer

Each file contains:
- MIDI tempo events (bpm)
- MIDI meter changes (meter)
- MIDI program changes (program_c)
- MIDI control changes (control_c)
- MIDI pitch bend events (pitch_bend_c)
- MIDI note on/off events (on/off)
- MIDI timing markers (marker_t)

---

## Event Format

MIDI events follow structure:
```javascript
{
  tick: number,           // MIDI tick position (0-based)
  type: 'on'|'off'|...,  // Event type
  vals: [channel, note, velocity]  // Type-specific parameters
}
```

### Event Types

| Type | vals | Purpose |
|------|------|---------|
| `on` | [ch, note, velocity] | Note on |
| `off` | [ch, note] | Note off |
| `program_c` | [ch, program] | Instrument change |
| `control_c` | [ch, cc, value] | Control change (pan, volume, effects) |
| `pitch_bend_c` | [ch, value] | Pitch bend |
| `bpm` | [tempo] | Tempo change |
| `meter` | [numerator, denominator] | Time signature |
| `marker_t` | [text] | Timing marker (for analysis) |

---

## Layer Integration

**Transparent layer handling:**
```javascript
// Writer doesn't care which layer is active
// p() automatically uses active buffer c
// LM.activate() changes which buffer c points to
// grandFinale() writes all layers

for (phrase...) {
  LM.activate('primary');
  setUnitTiming('phrase');
  playNotes();  // Events go to c1

  LM.activate('poly');
  setUnitTiming('phrase');
  playNotes();  // Events go to c2
}

grandFinale();  // Outputs both c1 and c2 to separate files
```

---

## Performance Characteristics

- **Efficient storage** - CSVBuffer stores objects directly (no conversion overhead)
- **O(1) push** - Adding events is constant time
- **Batch writing** - All events written at once via grandFinale()
- **Memory efficient** - No intermediate representations before file write

---

## Design Philosophy

**"Transparent Output"** - Enables multi-layer output without code changes:
- Same `p()` syntax as before (backward compatible)
- CSVBuffer metadata travels with events
- LM switching automatically routes output
- grandFinale() handles all layers uniformly
- No conditional logic in audio-generating code
