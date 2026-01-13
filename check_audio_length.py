#!/usr/bin/env python3
"""
Check audio file length using multiple methods.
Usage: python check_audio_length.py file.wav/mp3
"""

import sys
import wave
import mutagen
from mutagen.mp3 import MP3
from mutagen.wave import WAVE

def get_wav_length_wave(filename):
    """Get WAV length using wave module."""
    try:
        with wave.open(filename, 'rb') as wav_file:
            frames = wav_file.getnframes()
            rate = wav_file.getframerate()
            return frames / rate
    except Exception as e:
        return None

def get_audio_length_mutagen(filename):
    """Get audio length using mutagen."""
    try:
        if filename.lower().endswith('.mp3'):
            audio = MP3(filename)
        elif filename.lower().endswith('.wav'):
            audio = WAVE(filename)
        else:
            return None
        return audio.info.length
    except Exception as e:
        return None

def format_time(seconds):
    """Format seconds as MM:SS.sss"""
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes:02d}:{secs:05.2f}"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python check_audio_length.py file.wav/mp3")
        sys.exit(1)

    filename = sys.argv[1]

    # Try wave module first
    wave_length = get_wav_length_wave(filename)

    # Try mutagen
    mutagen_length = get_audio_length_mutagen(filename)

    print(f"File: {filename}")
    if wave_length is not None:
        print(f"Wave method: {wave_length:.3f}")
    if mutagen_length is not None:
        print(f"Mutagen method: {mutagen_length:.3f}")

    if wave_length is not None and mutagen_length is not None:
        diff = abs(wave_length - mutagen_length)
        if diff > 0.001:
            print(f"Methods differ by: {diff:.3f} seconds")
        else:
            print("Lengths match!")

    # Print file size for reference
    import os
    size = os.path.getsize(filename)
    print(f"File size: {size:,}")

    # Use the more reliable method
    final_length = mutagen_length if mutagen_length is not None else wave_length
    if final_length is not None:
        print(f"Final length: {final_length:.3f}")
        # Also print in minutes:seconds format
        print(format_time(final_length))