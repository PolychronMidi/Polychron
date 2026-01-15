# writer.js - MIDI Output and File Generation

> **Source**: `src/writer.js`
> **Status**: Core Module - Output & File I/O
> **Dependencies**: time.js ([code](../src/time.js)) ([doc](time.md)), backstage.js ([code](../src/backstage.js)) ([doc](backstage.md)), fs (Node.js)

## Overview

**writer.js** handles all MIDI file output - CSV buffer management, timing marker logging, and final file generation. It encapsulates the "writing to disk" functionality that transforms in-memory MIDI events into playable MIDI files.

**Core Responsibilities:**
- **Buffer management** - CSVBuffer class for layer-specific event storage
- **Event pushing** - Universal `p()` function for adding MIDI events
- **Timing markers** - Logging support for debugging and analysis
- **File generation** - Multi-layer CSV/MIDI output via `grandFinale()`
- **Error handling** - Filesystem operations with logging

## Architecture Role

**writer.js** is the **output layer**:
- **play.js** ([code](../src/play.js)) ([doc](play.md)) - Calls grandFinale() at composition end
- **All modules** - Generate events via `p(c, event)` 
- **time.js** ([code](../src/time.js)) ([doc](time.md)) - Timing markers use time.md logUnit()
- **Layer-aware** - Automatically routes events to active layer's buffer

---

## CSVBuffer Class: Event Encapsulation

Wraps MIDI event arrays with metadata while preserving minimalist syntax:

```javascript
CSVBuffer = class CSVBuffer {
  constructor(name) {
    this.name = name;    // Layer identifier ('primary', 'poly', etc.)
    this.rows = [];      // MIDI events array
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

Controlled by global `LOG` variable (set in sheet.js):
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
