#!/usr/bin/env python3
"""
Check WAV file length by reading the header and calculating duration.
Usage: python check_wav_length.py file.wav
"""

import sys
import wave
import struct

def get_wav_length(filename):
    """Get WAV file length in seconds."""
    try:
        with wave.open(filename, 'rb') as wav_file:
            # Get basic info
            nchannels = wav_file.getnchannels()
            sampwidth = wav_file.getsampwidth()
            framerate = wav_file.getframerate()
            nframes = wav_file.getnframes()

            # Calculate duration
            duration = nframes / framerate

            return duration

    except Exception as e:
        print(f"Error reading {filename}: {e}")
        return None

def format_time(seconds):
    """Format seconds as MM:SS.sss"""
    minutes = int(seconds // 60)
    secs = seconds % 60
    return "03d"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python check_wav_length.py file.wav")
        sys.exit(1)

    filename = sys.argv[1]
    length = get_wav_length(filename)

    if length is not None:
        print(".3f")
        # Also print in minutes:seconds format for clarity
        minutes = int(length // 60)
        seconds = length % 60
        print("02d")
    else:
        sys.exit(1)