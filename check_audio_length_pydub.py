#!/usr/bin/env python3
"""
Check audio file length using pydub (most reliable method).
Usage: python check_audio_length_pydub.py file.wav
"""

import sys
from pydub import AudioSegment
import os

def get_audio_length_pydub(filename):
    """Get audio length using pydub."""
    try:
        audio = AudioSegment.from_file(filename)
        length_seconds = len(audio) / 1000.0  # pydub returns milliseconds
        return length_seconds
    except Exception as e:
        print(f"Error reading {filename}: {e}")
        return None

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python check_audio_length_pydub.py file.wav/mp3")
        sys.exit(1)

    filename = sys.argv[1]

    if not os.path.exists(filename):
        print(f"File {filename} does not exist")
        sys.exit(1)

    length = get_audio_length_pydub(filename)

    if length is not None:
        print(".3f")
        # Also print in minutes:seconds format
        minutes = int(length // 60)
        seconds = length % 60
        print("02d")
    else:
        sys.exit(1)