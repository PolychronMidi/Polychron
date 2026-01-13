#!/usr/bin/env python3
"""
Check MIDI file length by reading the last event timestamp.
Usage: python check_midi_length.py file.mid
"""

import sys
import mido

def get_midi_length(filename):
    """Get MIDI file length in seconds by finding the last event timestamp."""
    try:
        mid = mido.MidiFile(filename)

        # MIDI files store time in ticks, need to convert to seconds
        # Use the tempo and time division from the file
        tempo = 500000  # default tempo (120 BPM) in microseconds per quarter note
        ticks_per_beat = mid.ticks_per_beat

        total_ticks = 0

        for track in mid.tracks:
            track_ticks = 0
            for msg in track:
                track_ticks += msg.time
            total_ticks = max(total_ticks, track_ticks)

        # Convert ticks to seconds
        # tempo is in microseconds per quarter note
        # ticks_per_beat is ticks per quarter note
        seconds_per_tick = (tempo / 1000000.0) / ticks_per_beat
        length_seconds = total_ticks * seconds_per_tick

        return length_seconds

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
        print("Usage: python check_midi_length.py file.mid")
        sys.exit(1)

    filename = sys.argv[1]
    length = get_midi_length(filename)

    if length is not None:
        print(".3f")
    else:
        sys.exit(1)