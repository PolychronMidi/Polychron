# time.js - Timing Engine and Temporal Management System

## Project Overview

**time.js** is the **temporal brain** of the Polychron system, responsible for all timing calculations, meter management, and the revolutionary "meter spoofing" technology that enables any time signature to work within MIDI constraints. This file handles the complex mathematics of polyrhythmic relationships and maintains precise timing coordination across all musical hierarchical levels.

## File Purpose

This module provides **advanced timing capabilities** including:
- **Meter spoofing** - Converts any time signature (even 420/69) to MIDI-compatible equivalents
- **Polyrhythm calculation** - Finds mathematical relationships between different meters
- **Hierarchical timing** - Precise timing for sections, phrases, measures, beats, divisions, subdivisions, and subsubdivisions
- **MIDI timing conversion** - Converts musical time to MIDI tick values
- **Tempo scaling** - Dynamic BPM adjustments and ratio calculations
- **Timing transitions** - Smooth temporal evolution between musical sections

## Architecture Role

**time.js** operates as the **timing coordinator**, bridging musical concepts with MIDI technical requirements. It receives timing requests from **play.js** and provides precise temporal data to all other modules. The file integrates closely with:
- **play.js** - Receives timing advancement requests and provides structural timing data
- **composers.js** - Validates time signatures and provides meter compatibility checking
- **stage.js** - Supplies exact tick timing for MIDI event generation
- **backstage.js** - Uses utility functions for mathematical calculations

## Revolutionary Meter Spoofing System

### `getMidiMeter()` - The Core Innovation
```javascript
getMidiMeter = () => {
  meterRatio = numerator / denominator;
  isPowerOf2 = (n) => { return (n & (n - 1)) === 0; }
  if (isPowerOf2(denominator)) { 
    midiMeter = [numerator, denominator]; 
  } else {
    const high = 2 ** m.ceil(m.log2(denominator)); 
    const highRatio = numerator / high;
    const low = 2 ** m.floor(m.log2(denominator)); 
    const lowRatio = numerator / low;
    midiMeter = m.abs(meterRatio - highRatio) < m.abs(meterRatio - lowRatio) ? 
      [numerator, high] : [numerator, low];
  }
  midiMeterRatio = midiMeter[0] / midiMeter[1];
  syncFactor = midiMeterRatio / meterRatio;
  midiBPM = BPM * syncFactor;
  tpSec = midiBPM * PPQ / 60;
  tpMeasure = PPQ * 4 * midiMeterRatio;
  setMidiTiming(); 
};
```

**Revolutionary Capability**: Enables **ANY** time signature to work in MIDI:
- **7/11 time** - Converts to nearest power-of-2 denominator (7/8 or 7/16)
- **420/69 time** - Finds mathematically optimal MIDI representation
- **Prime denominators** - Handles 7, 11, 13, 17, 19, 23, etc.

#### Algorithm Steps:
1. **Calculate actual meter ratio** (numerator ÷ denominator)
2. **Check if denominator is power of 2** - If yes, use directly (MIDI native)
3. **If not power of 2**:
   - Find **next higher** power of 2 (2^ceil(log₂(denominator)))
   - Find **next lower** power of 2 (2^floor(log₂(denominator)))
   - Calculate **ratio differences** for both options
   - **Choose closest match** to preserve musical feel
4. **Calculate sync factor** - Ratio between MIDI meter and actual meter
5. **Adjust BPM** - Scales tempo to maintain proper note durations
6. **Set MIDI timing** - Writes tempo and meter changes to CSV

### `getPolyrhythm()` - Mathematical Polyrhythm Discovery
```javascript
getPolyrhythm = () => { 
  while (true) {
    [polyNumerator, polyDenominator] = composer.getMeter(true, true);
    polyMeterRatio = polyNumerator / polyDenominator;
    let allMatches = []; 
    let bestMatch = {
      originalMeasures: Infinity,
      polyMeasures: Infinity,
      totalMeasures: Infinity
    };
    
    for (let originalMeasures = 1; originalMeasures < 6; originalMeasures++) {
      for (let polyMeasures = 1; polyMeasures < 6; polyMeasures++) {
        if (m.abs(originalMeasures * meterRatio - polyMeasures * polyMeterRatio) < .00000001) {
          let currentMatch = {
            originalMeasures: originalMeasures,
            polyMeasures: polyMeasures,
            totalMeasures: originalMeasures + polyMeasures
          };
          if (currentMatch.totalMeasures < bestMatch.totalMeasures) {
            bestMatch = currentMatch;
          }
        }
      }
    }
  }
};
```

**Finds mathematically perfect polyrhythmic relationships**:
- **Precise mathematical matching** - Uses floating-point epsilon for equality (0.00000001)
- **Duration equivalence** - Ensures both meters complete at same time point
- **Optimal solution finding** - Chooses shortest total duration for musical practicality

## Hierarchical Timing Functions

### `setBeatTiming()` - Beat-Level Processing
```javascript
setBeatTiming = () => { 
  tpBeat = tpMeasure / numerator;
  spBeat = tpBeat / tpSec;
  trueBPM = 60 / spBeat; 
  bpmRatio = BPM / trueBPM; 
  bpmRatio2 = trueBPM / BPM;
  trueBPM2 = numerator * (numerator / denominator) / 4; 
  bpmRatio3 = 1/trueBPM2;
  beatStart = phraseStart + measureIndex * tpMeasure + beatIndex * tpBeat; 
  beatStartTime = measureStartTime + beatIndex * spBeat;
  divsPerBeat = composer.getDivisions(); 
};
```

- **Beat subdivision** - Divides measure time by beat count (numerator)
- **Multiple BPM ratios** for different musical decisions
- **Absolute beat positioning** - Precise tick timing for each beat

### `logUnit(type)` - Comprehensive Timing Documentation
```javascript
logUnit = (type) => { 
  let shouldLog = false;
  type = type.toLowerCase();
  if (LOG === 'none') shouldLog = false;
  else if (LOG === 'all') shouldLog = true;
  else { 
    const logList = LOG.split(',').map(item => item.trim());
    shouldLog = logList.includes(type); 
  }
  if (!shouldLog) return null;
  
  return (() => { c.push({
    tick: startTick,
    type: 'marker_t',
    vals: [`${type.charAt(0).toUpperCase() + type.slice(1)} ${unit}/${unitsPerParent} Length: ${formatTime(endTime - startTime)} (${formatTime(startTime)} - ${formatTime(endTime)}) ${meterInfo ? meterInfo : ''}`]
  }); })();
};
```

**Creates detailed timing documentation**:
- **Configurable logging** - LOG setting controls detail level
- **CSV marker generation** - Creates MIDI text events for real-time tracking
- **Human-readable time display** - Minutes:seconds format with high precision

## Performance Characteristics

- **Mathematical precision** - High-precision floating-point calculations
- **Efficient algorithms** - Optimized for real-time calculation
- **MIDI-optimized** - All output directly compatible with MIDI timing requirements
- **Scalable complexity** - Handles simple 4/4 time through complex polyrhythmic structures