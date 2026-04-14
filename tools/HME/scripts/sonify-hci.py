#!/usr/bin/env python3
"""H11: HCI Sonification — render the current HCI as a MIDI file.

Maps the HME Coherence Index to an audible representation:
  - HCI 100 → A4 (440 Hz, 1 note, major-key context, velocity 100)
  - HCI 80  → F4 (349 Hz, fifth interval, velocity 85)
  - HCI 50  → C3 (131 Hz, tritone, velocity 60)
  - HCI 0   → A1 (55 Hz, minor second cluster, velocity 40)

The pitch drops as health degrades — when HME is healthy, it sings; when
it's struggling, it sags into a drone. Also encodes per-category health
as additional voices: each category gets its own note in the chord, so a
6-part chord is audible, with the worst-scoring category becoming the
lowest voice.

Output: metrics/hme-coherence-drone.mid — a single MIDI file with a
sustained chord that represents current HME health. Can be rendered
via the Polychron render-lite pipeline or any MIDI player.

The goal is not just cute: over time, playing these back in sequence
creates a time series of HME health you can listen to. Healthy systems
sound like sustained major chords; drifting systems become dissonant.

Usage:
    python3 tools/HME/scripts/sonify-hci.py
    python3 tools/HME/scripts/sonify-hci.py --from-holograph PATH
"""
import json
import os
import struct
import sys

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_OUTPUT = os.path.join(_PROJECT, "metrics", "hme-coherence-drone.mid")

# MIDI utilities — pure Python, no deps. Format 0 single-track MIDI.
def _var_len(n: int) -> bytes:
    """MIDI variable-length quantity encoding."""
    buffer = n & 0x7F
    out = bytearray()
    n >>= 7
    while n:
        buffer |= 0x80
        out.append(n & 0x7F)
        n >>= 7
    out.append(buffer)
    return bytes(reversed(out))


def _midi_note_on(delta: int, channel: int, note: int, velocity: int) -> bytes:
    return _var_len(delta) + bytes([0x90 | channel, note, velocity])


def _midi_note_off(delta: int, channel: int, note: int) -> bytes:
    return _var_len(delta) + bytes([0x80 | channel, note, 0])


def _midi_meta_tempo(delta: int, bpm: int) -> bytes:
    mpqn = 60_000_000 // bpm
    return _var_len(delta) + b'\xff\x51\x03' + struct.pack('>I', mpqn)[1:]


def _midi_end_of_track(delta: int) -> bytes:
    return _var_len(delta) + b'\xff\x2f\x00'


def hci_to_pitch(hci: float) -> int:
    """Map HCI 0-100 to MIDI note 21-81 (piano A0 to A5).
    Higher HCI = higher pitch. A4 = 69, A3 = 57.
    """
    hci = max(0, min(100, hci))
    # HCI 0 → A1 (33); HCI 100 → A5 (81)
    return int(33 + (hci / 100.0) * 48)


def hci_to_velocity(hci: float) -> int:
    """HCI 100 = velocity 110 (loud), HCI 0 = velocity 35 (quiet)."""
    hci = max(0, min(100, hci))
    return int(35 + (hci / 100.0) * 75)


def category_offset(cat_score: float) -> int:
    """Category score 0-1 → chord-tone offset (semitones from root).
    Healthy (1.0) → +12 (octave up), degraded (0.0) → -1 (minor second).
    """
    return int(-1 + cat_score * 13)


def build_midi(hci: float, categories: dict) -> bytes:
    # MIDI header: format 0, 1 track, 480 ticks per quarter
    header = b'MThd' + struct.pack('>IHHH', 6, 0, 1, 480)

    # Track events
    events = bytearray()
    events += _midi_meta_tempo(0, 120)

    root_note = hci_to_pitch(hci)
    velocity = hci_to_velocity(hci)

    # Primary voice — the HCI itself
    events += _midi_note_on(0, 0, root_note, velocity)

    # Additional voices — one per category, offset by health score
    for i, (cat_name, cat_info) in enumerate(sorted(categories.items())):
        if i >= 5:  # cap 5 additional voices
            break
        offset = category_offset(cat_info.get("score", 1.0))
        note = max(21, min(108, root_note + offset))
        cat_vel = int(velocity * 0.7)
        events += _midi_note_on(0, 1 + (i % 15), note, cat_vel)

    # Sustain for 4 beats = 4 × 480 ticks
    sustain_ticks = 480 * 4

    # Note-offs — root first, categories after
    events += _midi_note_off(sustain_ticks, 0, root_note)
    for i, (cat_name, cat_info) in enumerate(sorted(categories.items())):
        if i >= 5:
            break
        offset = category_offset(cat_info.get("score", 1.0))
        note = max(21, min(108, root_note + offset))
        events += _midi_note_off(0, 1 + (i % 15), note)

    events += _midi_end_of_track(0)

    track_header = b'MTrk' + struct.pack('>I', len(events))
    return header + track_header + bytes(events)


def _get_current_hci() -> dict:
    """Run verify-coherence.py --json to get the current state."""
    import subprocess
    script = os.path.join(_PROJECT, "tools", "HME", "scripts", "verify-coherence.py")
    try:
        rc = subprocess.run(
            ["python3", script, "--json"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "PROJECT_ROOT": _PROJECT},
        )
        return json.loads(rc.stdout)
    except Exception as e:
        sys.stderr.write(f"could not fetch HCI: {e}\n")
        return {"hci": 100, "categories": {}}


def _from_holograph(path: str) -> dict:
    with open(path) as f:
        snap = json.load(f)
    return snap.get("hci", {})


def main(argv: list) -> int:
    if "--from-holograph" in argv:
        idx = argv.index("--from-holograph")
        hci_data = _from_holograph(argv[idx + 1])
    else:
        hci_data = _get_current_hci()

    hci_score = hci_data.get("hci", 100)
    categories = hci_data.get("categories", {})
    midi_bytes = build_midi(hci_score, categories)
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "wb") as f:
        f.write(midi_bytes)
    print(f"HCI drone written: {_OUTPUT}")
    print(f"  HCI score: {hci_score}")
    print(f"  root note: {hci_to_pitch(hci_score)} (MIDI), velocity {hci_to_velocity(hci_score)}")
    print(f"  voices: 1 primary + {min(5, len(categories))} category voices")
    print(f"  file size: {len(midi_bytes)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
