# Polychron Verification System Summary

## Changes Implemented

### 1. File Organization (/output folder)

**Updated Files:**
- `writer.js` - `grandFinale()` now writes to `/output` directory
- `m2c.py` - Updated to read/write from `/output` folder
- `c2m.py` - Updated to read/write from `/output` folder

**Benefits:**
- Cleaner project root directory
- Organized output management
- Consistent file paths across tools

### 2. Unified Length Verification System

**New Tool:** `test_tools/check_all_lengths.py`

**Features:**
- Universal format support: MIDI (.mid), MP3, WAV, OGG, FLAC
- Multiple library backends: mido (MIDI), pydub (audio), mutagen (fallback)
- Automatic format detection
- Precise difference reporting (seconds and milliseconds)
- Color-coded success/failure output
- Exit codes for CI/CD integration

**Usage:**
```bash
python test_tools/check_all_lengths.py output/output1.mid output/output2.mid
python test_tools/check_all_lengths.py output/*.wav
python test_tools/check_all_lengths.py output/*.mid output/*.wav output/*.mp3
```

**Exit Codes:**
- `0` - All files match (within 10ms tolerance)
- `1` - Length discrepancies detected or errors occurred

### 3. Comprehensive Documentation

**Updated:** `test_tools/TEST_INSTRUCTIONS.md`

**New Sections:**
1. **Complete Length Verification** - Primary testing workflow
2. **Installation Requirements** - Library dependencies and setup
3. **Example Output** - Success and failure scenarios
4. **Troubleshooting** - Diagnostic procedures for length discrepancies
5. **Debug Commands** - Quick reference for common verification tasks
6. **Format-Specific Gotchas** - Known issues with different file formats

**Table of Contents:**
- Complete Length Verification (new primary focus)
- Measure Timing Verification (existing content preserved)
- Troubleshooting (comprehensive diagnostic guide)

## Current Status

### ✓ Completed
- [x] Output folder structure implemented
- [x] Python scripts updated for new paths
- [x] Unified length verification tool created
- [x] Documentation comprehensively updated
- [x] Multi-format support (MIDI, MP3, WAV, OGG, FLAC)
- [x] Tolerance-based comparison (10ms default)
- [x] Exit code support for automation

### ⚠ Known Issues

**Length Mismatch Detected:**
```
output/output1.wav: 04:33.165 (273.165s)
output/output2.wav: 04:31.453 (271.453s)
Difference: 1.712 seconds
```

**Status:** Unresolved - requires debugging of timing calculations

**Possible Causes:**
1. `LM.advance()` not properly syncing state to globals
2. Polyrhythm calculation errors in `getPolyrhythm()`
3. Phrase boundary alignment issues
4. Section advancement discrepancies

**Next Steps:**
1. Add debug logging to `LM.advance()` to verify `restoreTo()` is called
2. Log phraseStart, measureStart, beatStart before/after advancement
3. Compare timing state between primary and poly layers
4. Check if polyrhythm calculations produce identical phrase durations

## Installation Requirements

### Python Dependencies

```bash
# MIDI support (required for .mid files)
pip install mido

# Audio support - choose one or both:
pip install pydub          # Most reliable, all formats
pip install mutagen        # Lightweight alternative

# For MP3 support with pydub:
# Windows: Download ffmpeg from ffmpeg.org, add to PATH
# Linux: sudo apt-get install ffmpeg
# Mac: brew install ffmpeg
```

### Verification Tools

**Primary Tool:**
```bash
python test_tools/check_all_lengths.py <files...>
```

**Batch Scripts:**
- `test_tools/verify_all.bat` (Windows)
- `test_tools/verify_all.sh` (Linux/Mac)

**Measure Timing:**
```bash
grep "marker_t" output/output1.csv | grep "Measure" | python test_tools/verify_sp.py
```

## Quick Reference

### Generate Output
```bash
node play.js
```

### Convert CSV to MIDI
```bash
python c2m.py
```

### Verify All Lengths
```bash
python test_tools/check_all_lengths.py output/output1.mid output/output2.mid output/output1.wav output/output2.wav
```

### Run Full Test Suite
```bash
npm test
```

### Measure Timing Verification
```bash
grep "marker_t" output/output1.csv | grep "Measure" | python test_tools/verify_sp.py
```

## File Structure

```
polychron/
├── output/                          # Output files (CSV, MIDI, audio)
│   ├── output1.csv                  # Primary layer CSV
│   ├── output1.mid                  # Primary layer MIDI
│   ├── output1.wav                  # Primary layer audio
│   ├── output2.csv                  # Poly layer CSV
│   ├── output2.mid                  # Poly layer MIDI
│   └── output2.wav                  # Poly layer audio
├── test_tools/                      # Verification scripts
│   ├── check_all_lengths.py         # ★ NEW: Universal length checker
│   ├── check_midi_length.py         # Legacy MIDI checker
│   ├── check_audio_length.py        # Legacy audio checker
│   ├── check_audio_length_pydub.py  # Legacy pydub checker
│   ├── verify_sp.py                 # Measure timing verifier
│   ├── verify_all.bat               # Windows batch verification
│   ├── verify_all.sh                # Linux/Mac batch verification
│   ├── TEST_INSTRUCTIONS.md         # ★ UPDATED: Complete guide
│   └── VERIFICATION_SUMMARY.md      # This file
├── c2m.py                           # ★ UPDATED: CSV→MIDI converter
├── m2c.py                           # ★ UPDATED: MIDI→CSV converter
├── writer.js                        # ★ UPDATED: Output to /output folder
└── ... (other source files)
```

## Troubleshooting Quick Guide

### Issue: Files have different lengths

**Diagnostic:**
```bash
python test_tools/check_all_lengths.py output/output1.wav output/output2.wav
```

**If MIDI files differ:** Timing bug in JavaScript
**If only audio differs:** Audio conversion issue

**Fix Steps:**
1. Check `LM.advance()` has `layer.state.restoreTo(globalThis)`
2. Verify `setUnitTiming()` uses globals (not layer.state)
3. Check polyrhythm calculations use MIDI ratios
4. Verify module loading order (writer before backstage)

### Issue: "mido library not installed"

```bash
pip install mido
```

### Issue: "pydub cannot find ffmpeg"

Download ffmpeg and add to system PATH, or use mutagen:
```bash
pip install mutagen
```

### Issue: Output files in wrong location

Update paths in:
- `writer.js` line ~200 (grandFinale function)
- `m2c.py` and `c2m.py` (file paths)

## Integration with CI/CD

The `check_all_lengths.py` script is designed for automated testing:

```yaml
# Example GitHub Actions workflow
- name: Generate audio
  run: node play.js

- name: Convert to MIDI
  run: python c2m.py

- name: Verify lengths
  run: python test_tools/check_all_lengths.py output/output1.mid output/output2.mid
```

Exit code `0` = success, `1` = failure

## Future Enhancements

### Potential Improvements:
- [ ] JSON output format for programmatic consumption
- [ ] Configurable tolerance levels
- [ ] Automatic repair suggestions
- [ ] Real-time monitoring during generation
- [ ] Integrated waveform comparison
- [ ] Absolute time column in CSV output
- [ ] Layer-by-layer timing validation

### Requested Features:
- [ ] Support for additional audio formats (AIFF, AU)
- [ ] Visual diff tool for timing discrepancies
- [ ] Automatic bisection for bug localization
- [ ] Integration with measure timing verification

## Resources

**Documentation:**
- [TEST_INSTRUCTIONS.md](TEST_INSTRUCTIONS.md) - Complete testing guide
- [../README.md](../README.md) - Project overview

**Tools:**
- [mido documentation](https://mido.readthedocs.io/)
- [pydub documentation](https://github.com/jiaaro/pydub)
- [mutagen documentation](https://mutagen.readthedocs.io/)

**Debugging:**
- Enable verbose logging: Add `console.log()` statements in `LM.advance()` and `setUnitTiming()`
- Use `grep` to filter specific events from CSV files
- Compare marker_t entries between output1.csv and output2.csv
