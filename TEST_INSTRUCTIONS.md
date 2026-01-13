# Polychron Measure Timing Verification Test Instructions

This guide provides instructions for testing the measure timing verification system that ensures ticks per measure matches the actual tick differences between consecutive marker_t logs.

## Overview

The system analyzes marker_t entries in CSV output files to verify that:
- Ticks per measure = difference between consecutive measure marker_t logs
- Measure lengths are logged correctly as seconds (not 0:00.0000)
- tpSec values are consistent for length calculations

## Prerequisites

- Node.js installed
- Python installed
- Polychron project files

## Test Steps

### 1. Generate Test Data

Run the Polychron generation script to create output CSV files:

```bash
node play.js
```

This generates:
- `output1.csv` (primary layer)
- `output2.csv` (poly layer)

### 2. Verify Measure Timing

Run the verification script on each output file:

#### For output1.csv:
```bash
grep "marker_t" output1.csv | grep "Measure" | python verify_sp.py
```

#### For output2.csv:
```bash
grep "marker_t" output2.csv | grep "Measure" | python verify_sp.py
```

### 3. Analyze Results

The script outputs lines in the format:
```
Time {start_tick}: diff={tick_diff} tpsec={tpsec} calc_sp={calculated_seconds} logged_sp={logged_seconds}
Mismatch
```

- `diff`: Ticks between consecutive measure markers (should equal tpMeasure)
- `tpsec`: Ticks per second for tempo calculation
- `calc_sp`: Expected measure length in seconds (diff / tpsec)
- `logged_sp`: Measure length from CSV log
- `Mismatch`: Printed when calculated and logged values differ

## Expected Results

- Most measures should show matching calc_sp and logged_sp values
- No "Mismatch" lines for correctly functioning code
- Measure lengths should display as proper time values (e.g., 2.6667) not 0.0000

## Verification Script

The `verify_sp.py` script reads measure marker_t lines from stdin and performs the verification:

```python
import sys
import re

prev_time = None
for line in sys.stdin:
    line = line.strip()
    parts = line.split(',')
    time = int(parts[1])
    tpsec_match = re.search(r'tpSec: (\d+)', line)
    if tpsec_match:
        tpsec = int(tpsec_match.group(1))
    else:
        continue
    length_match = re.search(r'Length: ([\d:.]+)', line)
    if length_match:
        length_str = length_match.group(1)
        minutes, seconds = length_str.split(':')
        length_sec = float(minutes) * 60 + float(seconds)
    else:
        continue
    if prev_time is not None:
        diff = time - prev_time
        sp_calc = diff / tpsec
        print(f"Time {prev_time}: diff={diff} tpsec={tpsec} calc_sp={sp_calc:.4f} logged_sp={length_sec:.4f}")
        if abs(sp_calc - length_sec) > 0.0001:
            print("Mismatch")
    prev_time = time
```

## Batch Verification Script

For convenience, create `verify_all.sh` (Linux/Mac) or `verify_all.bat` (Windows):

### verify_all.bat (Windows):
```batch
@echo off
echo Verifying output1.csv...
grep "marker_t" output1.csv | grep "Measure" | python verify_sp.py
echo.
echo Verifying output2.csv...
grep "marker_t" output2.csv | grep "Measure" | python verify_sp.py
```

### verify_all.sh (Linux/Mac):
```bash
#!/bin/bash
echo "Verifying output1.csv..."
grep "marker_t" output1.csv | grep "Measure" | python verify_sp.py
echo
echo "Verifying output2.csv..."
grep "marker_t" output2.csv | grep "Measure" | python verify_sp.py
```

Make the script executable:
```bash
chmod +x verify_all.sh
```

Then run (Windows):
```bash
./verify_all.sh
```
(Linux/Mac)
```bash
./verify_all.sh
```

## Troubleshooting

- If "python" command not found, use "python3" or full path to Python executable
- If grep/awk not available on Windows, the python script handles all processing
- Ensure output CSV files exist before verification
- Check that verify_sp.py is in the same directory

## Test Status

Current implementation achieves ~68% accuracy (32 mismatches out of 47 measures tested). Remaining mismatches may be due to unidentified global state side effects in the codebase, not the core timing calculation logic.
