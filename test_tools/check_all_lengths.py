#!/usr/bin/env python3
"""
Universal length verification tool for audio and MIDI files.
Supports: MIDI (.mid), MP3, WAV, OGG, FLAC, and other audio formats.

Usage:
    python check_all_lengths.py file1.mid file2.wav file3.mp3 [...]
    
Returns:
    Exit code 0 if all files have matching lengths (within tolerance)
    Exit code 1 if lengths differ or errors occur
"""

import sys
import os
from pathlib import Path

def get_midi_length(filepath):
    """Get MIDI file length in seconds using mido library."""
    try:
        import mido
        midi = mido.MidiFile(filepath)
        return midi.length
    except ImportError:
        print("ERROR: mido library not installed. Install with: pip install mido")
        return None
    except Exception as e:
        print(f"ERROR reading MIDI file {filepath}: {e}")
        return None

def get_audio_length_pydub(filepath):
    """Get audio file length using pydub (most reliable method)."""
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(filepath)
        return len(audio) / 1000.0  # Convert milliseconds to seconds
    except ImportError:
        return None  # Fall back to other methods
    except Exception as e:
        print(f"ERROR reading audio file {filepath} with pydub: {e}")
        return None

def get_audio_length_mutagen(filepath):
    """Get audio file length using mutagen library."""
    try:
        from mutagen import File
        audio = File(filepath)
        if audio is None:
            return None
        return audio.info.length
    except ImportError:
        print("ERROR: mutagen library not installed. Install with: pip install mutagen")
        return None
    except Exception as e:
        print(f"ERROR reading audio file {filepath} with mutagen: {e}")
        return None

def get_audio_length_wave(filepath):
    """Get WAV file length using standard wave library."""
    try:
        import wave
        with wave.open(filepath, 'r') as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            return frames / float(rate)
    except Exception as e:
        print(f"ERROR reading WAV file {filepath}: {e}")
        return None

def get_file_length(filepath):
    """
    Get file length in seconds, automatically detecting format.
    Returns (length_in_seconds, method_used) or (None, error_message).
    """
    ext = Path(filepath).suffix.lower()
    
    if ext == '.mid' or ext == '.midi':
        length = get_midi_length(filepath)
        return (length, 'mido') if length is not None else (None, 'mido failed')
    
    # Try pydub first (most reliable for all audio formats)
    length = get_audio_length_pydub(filepath)
    if length is not None:
        return (length, 'pydub')
    
    # Fall back to format-specific methods
    if ext == '.wav':
        length = get_audio_length_wave(filepath)
        if length is not None:
            return (length, 'wave')
    
    # Try mutagen as last resort
    length = get_audio_length_mutagen(filepath)
    if length is not None:
        return (length, 'mutagen')
    
    return (None, f'no suitable library for {ext}')

def format_time(seconds):
    """Format seconds as MM:SS.mmm"""
    if seconds is None:
        return "N/A"
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes:02d}:{secs:06.3f}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python check_all_lengths.py <file1> <file2> [file3 ...]")
        print("\nSupported formats: MIDI (.mid), MP3, WAV, OGG, FLAC")
        print("\nExample:")
        print("  python check_all_lengths.py output/output1.mid output/output1.wav output/output2.mid")
        sys.exit(1)
    
    files = sys.argv[1:]
    results = []
    
    print("=" * 80)
    print("FILE LENGTH VERIFICATION")
    print("=" * 80)
    
    # Get lengths for all files
    for filepath in files:
        if not os.path.exists(filepath):
            print(f"ERROR: File not found: {filepath}")
            results.append((filepath, None, None, "file not found"))
            continue
        
        length, method = get_file_length(filepath)
        results.append((filepath, length, method, None))
        
        if length is not None:
            print(f"{filepath:40s} {format_time(length)}  [{method}]")
        else:
            print(f"{filepath:40s} ERROR: {method}")
    
    print("=" * 80)
    
    # Check if any files failed to load
    failed = [r for r in results if r[1] is None]
    if failed:
        print("\nERROR: Could not read the following files:")
        for filepath, _, _, error in failed:
            print(f"  - {filepath}: {error}")
        sys.exit(1)
    
    # Compare all lengths
    lengths = [r[1] for r in results]
    min_length = min(lengths)
    max_length = max(lengths)
    difference = max_length - min_length
    
    # Tolerance: 0.01 seconds (10ms) for rounding/precision differences
    tolerance = 0.01
    
    print(f"\nLength Range:")
    print(f"  Shortest: {format_time(min_length)}")
    print(f"  Longest:  {format_time(max_length)}")
    print(f"  Difference: {difference:.6f} seconds ({difference*1000:.3f} ms)")
    
    if difference <= tolerance:
        print(f"\n✓ SUCCESS: All files match within tolerance ({tolerance}s)")
        print("=" * 80)
        sys.exit(0)
    else:
        print(f"\n✗ FAILURE: Files differ by {difference:.6f}s (tolerance: {tolerance}s)")
        print("\nLength discrepancies detected:")
        for filepath, length, method, _ in results:
            diff = length - min_length
            if diff > tolerance:
                print(f"  {filepath}: +{diff:.6f}s longer than shortest")
        print("=" * 80)
        sys.exit(1)

if __name__ == "__main__":
    main()
