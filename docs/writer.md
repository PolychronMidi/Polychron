# writer.js - MIDI Output and File Generation

> **Source**: `src/writer.js`
> **Status**: Core Module - Output & File I/O
> **Dependencies**: time.js ([code](../src/time.js)) ([doc](time.md)), backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)), fs (Node.js)

## Project Overview

**writer.js** handles all **MIDI file output operations** for the Polychron system, including CSV buffer management, timing markers, and final file generation. This module encapsulates the "writing to disk" functionality that transforms in-memory MIDI events into playable files.

## File Purpose

This module provides **output infrastructure** including:
- **CSV Buffer management** - CSVBuffer class for layer-specific event collection
- **Push operations** - Universal `p()` function for adding MIDI events
- **Timing markers** - `logUnit()` for debugging and analysis
- **File generation** - `grandFinale()` for multi-layer CSV/MIDI output
- **Filesystem operations** - Node.js fs integration with error handling

## Architecture Role

**writer.js** operates as the **output layer** for the composition system:
- **Imported by stage.js** ([code](../src/stage.js)) ([doc](stage.md)) - Establishes output infrastructure
- **Used by all modules** - Every module generates events via `p(c, ...)`
- **Layer-aware** - Automatically routes events to active layer's buffer
- **File generation** - Final step in composition pipeline, triggered by play.js ([code](../src/play.js)) ([doc](play.md))

## Code Style Philosophy

Maintains the project's **"clean minimal"** philosophy:
- **Simple interfaces** - `p(c, event)` syntax unchanged from array days
- **Encapsulated complexity** - CSVBuffer wraps array with metadata
- **Direct file I/O** - Efficient CSV generation without abstractions
- **Error handling** - Wrapped fs operations with centralized logging

---

## CSVBuffer Class - MIDI Event Encapsulation

### Purpose
Encapsulates MIDI event collection with layer context metadata while preserving the minimalist `p(c)` syntax.

### Implementation
```javascript
CSVBuffer = class CSVBuffer {
  constructor(name) {
    this.name = name;    // Layer identifier
    this.rows = [];      // MIDI event array
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
```

### Usage Pattern
```javascript
c1 = new CSVBuffer('primary');
c2 = new CSVBuffer('poly');
c = c1;  // Active buffer reference

p(c, {tick: 0, type: 'on', vals: [0, 60, 99]});  // Exact same syntax as before
```

### Architecture Benefits
- **Layer identification** - Each buffer knows its layer name
- **Backward compatible** - `p(c)` calls work identically
- **Metadata attached** - Layer context travels with buffer
- **Array interop** - `.rows` provides array access when needed

### Properties

#### `name` (string)
- Layer identifier ('primary', 'poly', or custom name)
- Used by `grandFinale()` to determine output filename
- Embedded in log messages for debugging

#### `rows` (array)
- Array of MIDI event objects
- Each object: `{tick: number, type: string, vals: array}`
- Directly accessible for array operations when needed

#### `length` (getter)
- Returns `rows.length`
- Allows buffer to act like array: `if (c.length > 0)`
- Read-only computed property

---

## Push Operations

### `p = pushMultiple(buffer, ...items)`

**Purpose:** Universal function for adding MIDI events to any buffer

**Signature:**
```javascript
p = pushMultiple = (buffer, ...items) => {
  buffer.push(...items);
};
```

**Usage:**
```javascript
// Single event
p(c, {tick: 0, type: 'on', vals: [0, 60, 99]});

// Multiple events
p(c,
  {tick: 0, type: 'on', vals: [0, 60, 99]},
  {tick: 100, type: 'on', vals: [0, 64, 99]}
);

// Works with arrays too (backward compatibility)
p([], {a: 1}, {b: 2});
```

**Design Philosophy:**
- **Minimal syntax** - Short function name `p()` for frequent use
- **Flexible target** - Works with CSVBuffer or plain arrays
- **Spread operator** - Handles any number of items efficiently
- **Zero overhead** - Direct delegation to buffer's push method

---

## Timing Markers

### `logUnit(type)`

**Purpose:** Logs timing boundary markers for debugging and analysis

**Signature:**
```javascript
logUnit = (type) => { /* ... */ }
```

**Parameters:**
- `type` (string) - Unit type: 'section', 'phrase', 'measure', 'beat', 'division', 'subdivision', 'subsubdivision'

**Configuration:**
- Controlled by global `LOG` variable (set in sheet.js)
- `LOG = 'none'` - No markers
- `LOG = 'all'` - All markers
- `LOG = 'phrase,measure'` - Specific types (comma-separated)

**Marker Format:**
```
Phrase 2/4 Length: 2.000s (4.000s - 6.000s) endTick: 3840 Meter: 7/8 Composer: ScaleComposer E harmonic minor tpSec: 960
```

**Output:**
- Written to active buffer `c` (c1 or c2)
- Type: `marker_t` (MIDI text marker)
- Includes: unit number, timing, meter info, composer details

**Implementation Details:**
```javascript
// Section markers
if (type === 'section') {
  unit = sectionIndex + 1;
  unitsPerParent = totalSections;
  startTick = sectionStart;
  endTick = startTick + tpSection;
  startTime = sectionStartTime;
  endTime = startTime + (tpSection / tpSec);
}

// Phrase markers (with meter info)
else if (type === 'phrase') {
  // ... timing calculations ...
  actualMeter = [numerator, denominator];
  meterInfo = midiMeter[1] === actualMeter[1]
    ? `Meter: ${actualMeter.join('/')}`
    : `Actual Meter: ${actualMeter.join('/')} MIDI Meter: ${midiMeter.join('/')}`;
  meterInfo += ` Composer: ${composerDetails} tpSec: ${tpSec}`;
}

// Beat, division, subdivision, subsubdivision markers
// ... similar pattern for each level ...
```

**Use Cases:**
- **Development** - Verify timing calculations during composition
- **Debugging** - Trace timing issues in complex polyrhythms
- **Analysis** - Understand structure of generated compositions
- **Performance tuning** - Identify bottlenecks in generation

---

## File Generation

### `grandFinale()`

**Purpose:** Outputs separate MIDI CSV files for each registered layer

**Architecture:**
```
1. Collect all layer data from LM.layers
2. For each layer:
   a. Clean up (allNotesOff, muteAll)
   b. Filter null entries
   c. Fix invalid ticks
   d. Sort by tick
   e. Generate CSV string
   f. Write to file
3. Log completion
```

**Implementation:**
```javascript
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
        tick: isNaN(i.tick) || i.tick < 0
          ? Math.abs(i.tick || 0) * rf(.1, .3)
          : i.tick
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

    composition += `1,${finalTick + (SILENT_OUTRO_SECONDS * tpSec)},end_track`;

    // Determine output filename
    let outputFilename;
    if (name === 'primary') {
      outputFilename = 'output1.csv';
    } else if (name === 'poly') {
      outputFilename = 'output2.csv';
    } else {
      outputFilename = `output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    }

    fs.writeFileSync(outputFilename, composition);
    console.log(`${outputFilename} created (${name} layer).`);
  });
};
```

**Output Files:**
- **output1.csv** - Primary layer
- **output2.csv** - Poly layer
- **outputCustom.csv** - Additional layers (name-based)

**CSV Format:**
```csv
0,0,header,1,1,480
1,0,start_track
1,0,note_on_c,0,60,100
1,480,note_off_c,0,60,0
1,960,end_track
```

**Multi-Layer Synchronization:**
- Each layer has independent tick counts (different tempos)
- Phrase boundaries align perfectly in absolute time (seconds)
- `spPhrase` (seconds per phrase) identical across layers
- `tpPhrase` (ticks per phrase) differs based on meter

**Example:**
```javascript
// Primary layer (4/4): tpPhrase = 7680 ticks, spPhrase = 8.0 seconds
// Poly layer (7/8):    tpPhrase = 6720 ticks, spPhrase = 8.0 seconds
// Result: Both layers' phrases end at same absolute time
```

---

## Filesystem Operations

### `fs` - Node.js Filesystem Module

**Purpose:** File I/O with centralized error handling

**Implementation:**
```javascript
fs = require('fs');

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
```

**Error Handling Benefits:**
- **Centralized logging** - All file write errors logged consistently
- **Filename context** - Know which file failed to write
- **Stack trace** - Original error preserved and re-thrown
- **Graceful degradation** - Wrapping failure doesn't break fs operations

---

## Integration with Other Modules

### Buffer Initialization
```javascript
// writer.js creates buffers
c1 = new CSVBuffer('primary');
c2 = new CSVBuffer('poly');
c = c1;  // Default active buffer

// play.js registers them with LM
const { state: primary } = LM.register('primary', c1, {}, setup1);
const { state: poly } = LM.register('poly', c2, {}, setup2);
```

### Layer Switching
```javascript
// time.js or play.js activates layers
LM.activate('primary');  // Sets c = c1
// ... generate events with p(c, ...) ...

LM.activate('poly');     // Sets c = c2
// ... generate events with p(c, ...) ...
```

### Event Generation
```javascript
// All modules use p(c, ...) identically
// stage.js
p(c, {tick: beatStart, type: 'on', vals: [ch, note, vel]});

// rhythm.js
p(c, {tick: tick, type: 'on', vals: [drumCH, drumNote, vel]});

// composers.js (via stage functions)
// Indirectly calls p(c, ...) through stage.js functions
```

### File Output
```javascript
// play.js calls at end of composition
grandFinale();  // Writes output1.csv, output2.csv, etc.
```

---

## Performance Characteristics

### Memory Efficiency
- **CSVBuffer overhead** - Minimal (one string property per buffer)
- **Array storage** - Standard JavaScript array for events
- **No duplication** - Events stored once in appropriate layer buffer

### Timing Performance
- **logUnit()** - Only active when LOG !== 'none'
- **String concatenation** - Efficient for CSV generation
- **Single file pass** - Each layer written once, no re-reads

### Scalability
- **Layer count** - Unlimited layers supported
- **Event density** - Handles extreme note counts efficiently
- **File size** - CSV format compact, scales linearly with events

---

## Revolutionary Aspects

### Clean Buffer Abstraction
- **Preserves syntax** - `p(c)` unchanged from original array implementation
- **Adds metadata** - Layer name travels with buffer automatically
- **Zero overhead** - Direct delegation, no performance cost

### Multi-Layer Output
- **Automatic routing** - Each layer gets separate file
- **Synchronized timing** - Absolute time alignment preserved
- **Independent processing** - Each layer's buffer processed in isolation

### Flexible Logging
- **Configurable granularity** - From none to all timing levels
- **Layer-aware** - Markers go to correct buffer automatically
- **Analysis friendly** - Markers include full timing/meter context

### Error Resilience
- **Wrapped fs operations** - Consistent error handling
- **Null filtering** - Invalid events removed before output
- **Tick validation** - NaN and negative ticks fixed automatically
- **Sorted output** - Events guaranteed in chronological order
