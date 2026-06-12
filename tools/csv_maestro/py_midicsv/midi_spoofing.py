"""
Helpers for converting human-friendly time values to MIDI ticks and for
silently normalizing non-power-of-two meters by applying a sync factor (as
used in Polychron's `midiTiming.js`). This module keeps conversion logic
contained inside the csv_maestro package so CSV authors can use simple
notations like '1.5s' for 1.5 seconds and csvmidi will convert to ticks.
"""

from __future__ import annotations

import math

DEFAULT_BPM = 120.0
DEFAULT_DENOM = 4


def _is_power_of_two(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def adjust_time_signature(numer: int, denom: int):
    """Return (numer, midi_denom, sync_factor, changed)

    If ``denom`` is not a power of two this computes the nearest power-of-two
    denominator (``midi_denom``) and returns a ``sync_factor`` to scale BPM
    so that MIDI-aligned playback matches the original rational meter.
    """
    try:
        n = int(numer)
    except Exception:
        n = 4
    try:
        d = int(denom)
    except Exception:
        d = DEFAULT_DENOM

    if d <= 0:
        d = DEFAULT_DENOM

    if _is_power_of_two(d):
        return n, d, 1.0, False

    # Choose nearest power-of-two denominator (ties resolved to the smaller)
    high_exp = math.ceil(math.log2(d))
    low_exp = math.floor(math.log2(d))
    high = 2 ** high_exp
    low = 2 ** low_exp

    meter_ratio = n / d
    high_ratio = n / high
    low_ratio = n / low

    midi_denom = high if abs(meter_ratio - high_ratio) < abs(meter_ratio - low_ratio) else low

    # sync_factor = (n / midi_denom) / (n / d) -> simplifies to d / midi_denom
    sync_factor = (n / midi_denom) / (n / d) if (n != 0 and d != 0) else 1.0

    if not math.isfinite(sync_factor) or sync_factor == 0:
        sync_factor = 1.0

    return n, midi_denom, sync_factor, True


def ticks_per_second(resolution: int, bpm: float, numer: int = 4, denom: int = 4) -> float:
    """Compute MIDI ticks-per-second given PPQ resolution, BPM and meter.

    Applies the same sync-factor normalization used in Polychron's
    `midiTiming.js` so non-power-of-two meters produce a sensible tick rate.
    """
    try:
        res = int(resolution)
        if res <= 0:
            res = 220
    except Exception:
        res = 220

    try:
        bpm_val = float(bpm) if (bpm is not None and float(bpm) > 0) else DEFAULT_BPM
    except Exception:
        bpm_val = DEFAULT_BPM

    _, _, sync_factor, _ = adjust_time_signature(numer, denom)
    effective_bpm = bpm_val * sync_factor
    return effective_bpm * res / 60.0


def seconds_to_ticks(seconds: float, resolution: int, bpm: float, numer: int = 4, denom: int = 4) -> int:
    """Convert absolute seconds into MIDI ticks using given context.

    This will apply meter-normalization sync factor and return an integer
    rounded tick value.
    """
    if seconds is None:
        return 0
    try:
        sec = float(seconds)
    except Exception:
        raise ValueError(f"Invalid seconds value: {seconds!r}")

    tps = ticks_per_second(resolution, bpm, numer, denom)
    return int(round(sec * tps))
