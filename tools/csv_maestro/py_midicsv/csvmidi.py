### System ###
import csv

from .events import csv_to_midi_map
from .midi.containers import *

### Local ###
from .midi.events import *
from .midi_spoofing import seconds_to_ticks, adjust_time_signature, ticks_per_second

COMMENT_DELIMITERS = ("#", ";", "|", "//")


def parse(file, strict=True):
    """Parses a CSV file into MIDI format.

    Args:
        file: A string giving the path to a file on disk or
              an open file-like object.

    Returns:
        A Pattern() object containing the byte-representations as parsed from the input file.
    """

    if isinstance(file, str):
        with open(file) as f:
            return parse(f)

    pattern = Pattern(tick_relative=False)

    # Read all rows first so we can examine simultaneous events (same track/time)
    rows = []
    for raw in csv.reader(file, skipinitialspace=True):
        if not raw:
            continue
        if raw[0].startswith(COMMENT_DELIMITERS):
            continue
        # Normalize time field by trimming trailing inline comments
        field = raw[1] or ""
        min_idx = None
        for delim in COMMENT_DELIMITERS:
            idx = field.find(delim)
            if idx != -1 and (min_idx is None or idx < min_idx):
                min_idx = idx
        if min_idx is not None:
            field = field[:min_idx]
        raw[1] = field.strip()
        rows.append(raw)

    # Parser state held locally
    current_bpm = 120.0
    current_numer = 4
    current_denom = 4
    suppressed_rows = set()  # indices of tempo rows to suppress
    appended_tempo_by_row = {}  # idx -> (track_obj, event) mapping for tempo events
    track_map = {}  # track_number (int) -> Track object
    track = None

    # Per-track state & history: used to compute 't' times relative to last tempo/meter change
    track_states = {}
    rows_info = {}

    def _ensure_track_state(tr):
        if tr in track_states:
            return track_states[tr]
        bpm = current_bpm
        numer = current_numer
        denom = current_denom
        tps = ticks_per_second(pattern.resolution, bpm, numer, denom)
        st = {
            'current_bpm': bpm,
            'current_numer': numer,
            'current_denom': denom,
            'history': [
                {'sec': 0.0, 'tick': 0, 'bpm': bpm, 'numer': numer, 'denom': denom, 'tps': tps}
            ]
        }
        track_states[tr] = st
        return st

    def find_last_change_by_sec(st, sec):
        for ch in reversed(st['history']):
            if ch['sec'] <= sec + 1e-12:
                return ch
        return st['history'][0]

    def find_last_change_by_tick(st, tick):
        for ch in reversed(st['history']):
            if ch['tick'] <= tick:
                return ch
        return st['history'][0]

    def parse_tempo_from_fields(fields):
        if not fields or fields[0] == "":
            return None
        try:
            v = float(fields[0])
            if round(v) > 1000:  # mpqn
                return float(6e7 / int(round(v)))
            return float(v)
        except Exception:
            return None

    def find_tempo_row_at_same_time(idx, tr_str, tf, secs=None):
        # Exact raw time-string match first (covers both earlier & later rows)
        for j, r in enumerate(rows):
            if j == idx: continue
            if r[0] != tr_str: continue
            idr = r[2].strip().lower()
            if idr not in ("tempo", "bpm"): continue
            if r[1] == tf:
                return j
        # Fallback 1: match by computed seconds if available
        if secs is not None:
            for j, r in enumerate(rows):
                if j == idx: continue
                if r[0] != tr_str: continue
                idr = r[2].strip().lower()
                if idr not in ("tempo", "bpm"): continue
                info = rows_info.get(j)
                if info and abs(info['secs'] - secs) < 1e-9:
                    return j
        # Fallback 2: match by numeric tick computed under current context
        try:
            if tf and tf.lower().endswith('s'):
                sec = float(tf[:-1].strip())
                cur_tick = seconds_to_ticks(sec, pattern.resolution, current_bpm, current_numer, current_denom)
            else:
                cur_tick = round(float(tf))
        except Exception:
            cur_tick = None
        if cur_tick is None:
            return None
        for j, r in enumerate(rows):
            if j == idx or r[0] != tr_str:
                continue
            idr = r[2].strip().lower()
            if idr not in ("tempo", "bpm"):
                continue
            try:
                rtf = r[1]
                if rtf and rtf.lower().endswith('s'):
                    sec = float(rtf[:-1].strip())
                    r_tick = seconds_to_ticks(sec, pattern.resolution, current_bpm, current_numer, current_denom)
                else:
                    r_tick = round(float(rtf))
            except Exception:
                r_tick = None
            if r_tick == cur_tick:
                return j
        return None

    # Process sanitized rows with index so we can suppress later tempo rows if needed
    for idx, line in enumerate(rows):
        tr = int(line[0])
        tf = line[1]
        identifier = line[2].strip().lower()

        # Ensure there's a per-track state (so we can compute 't' times relative to the last tempo/meter change)
        _ensure_track_state(tr)
        st = track_states[tr]

        # Compute absolute seconds and MIDI tick relative to the most recent change
        if tf and tf.lower().endswith('s'):
            try:
                secs = float(tf[:-1].strip())
            except Exception:
                secs = float(tf)
            last = find_last_change_by_sec(st, secs)
            tick = last['tick'] + round((secs - last['sec']) * last['tps'])
        else:
            tick = round(float(tf))
            last = find_last_change_by_tick(st, tick)
            secs = last['sec'] + (tick - last['tick']) / last['tps']

        rows_info[idx] = { 'secs': secs, 'tick': tick }

        if identifier == "header":
            pattern.format = int(line[3])
            resolution = int(line[5])
            if resolution > 30000:
                print("Warning: Maximum resolution (PPQ) is 30,000. Using 30,000.")
                resolution = 30000
            pattern.resolution = resolution

        elif identifier == "end_of_file":
            continue  # unused but left for backward compatability

        elif identifier == "start_track":
            track = Track(tick_relative=False)
            pattern.append(track)
            track_map[tr] = track

        elif identifier in ("time_signature", "meter", "metre"):
            event_fields = list(line[3:])
            try:
                numer = int(event_fields[0]) if len(event_fields) >= 1 and event_fields[0] != "" else 4
            except Exception:
                numer = 4
            try:
                denom = int(event_fields[1]) if len(event_fields) >= 2 and event_fields[1] != "" else 4
            except Exception:
                denom = 4

            midi_numer, midi_denom, sync_factor, changed = adjust_time_signature(numer, denom)

            # If there is a tempo at the same track/time use its value as base BPM
            tempo_row_idx = find_tempo_row_at_same_time(idx, line[0], tf, secs)
            base_bpm = None
            if tempo_row_idx is not None:
                base_bpm = parse_tempo_from_fields(rows[tempo_row_idx][3:]) or st['current_bpm']
            else:
                base_bpm = st['current_bpm']

            if changed:
                scaled_bpm = base_bpm * sync_factor
                tempo_event = csv_to_midi_map['bpm'](tr, tick, 'bpm', [str(scaled_bpm)])
                tgt_track = track_map.get(tr, track)
                if tgt_track is None:
                    tgt_track = Track(tick_relative=False)
                    pattern.append(tgt_track)
                    track_map[tr] = tgt_track
                tgt_track.append(tempo_event)
                appended_tempo_by_row[idx] = (tgt_track, tempo_event)

                # Update track-state: spoofed tempo + meter change becomes the new 'last change'
                st['current_bpm'] = scaled_bpm
                st['current_numer'] = midi_numer
                st['current_denom'] = midi_denom
                new_tps = ticks_per_second(pattern.resolution, scaled_bpm, midi_numer, midi_denom)
                new_change = { 'sec': secs, 'tick': tick, 'bpm': scaled_bpm, 'numer': midi_numer, 'denom': midi_denom, 'tps': new_tps }
                st['history'].append(new_change)
                # Propagate to parser-wide fallbacks
                current_bpm = scaled_bpm
                current_numer = midi_numer
                current_denom = midi_denom

                # suppress original tempo event if it exists at the same time
                if tempo_row_idx is not None:
                    suppressed_rows.add(tempo_row_idx)
                    if tempo_row_idx in appended_tempo_by_row:
                        t_obj, appended_ev = appended_tempo_by_row.pop(tempo_row_idx)
                        try:
                            t_obj.remove(appended_ev)
                        except ValueError:
                            pass

                # Ensure the emitted time_signature uses a MIDI-friendly denom
                if len(event_fields) < 2:
                    while len(event_fields) < 2:
                        event_fields.append('')
                event_fields[1] = str(midi_denom)
            else:
                # Meter changed but denominator was MIDI-compatible; still treat as meter change
                st['current_numer'] = midi_numer
                st['current_denom'] = midi_denom
                new_tps = ticks_per_second(pattern.resolution, st['current_bpm'], midi_numer, midi_denom)
                new_change = { 'sec': secs, 'tick': tick, 'bpm': st['current_bpm'], 'numer': midi_numer, 'denom': midi_denom, 'tps': new_tps }
                st['history'].append(new_change)
                current_numer = midi_numer
                current_denom = midi_denom

            event = csv_to_midi_map[identifier](tr, tick, identifier, event_fields)
            tgt_track = track_map.get(tr, track)
            if tgt_track is None:
                tgt_track = Track(tick_relative=False)
                pattern.append(tgt_track)
                track_map[tr] = tgt_track
            tgt_track.append(event)

        else:
            if identifier not in csv_to_midi_map:
                # if strict:
                #     raise ValueError(f"Unknown event type identifier: '{identifier}'")
                # else:
                print(f"Warning: Unknown event type identifier: '{identifier}'. Setting default note_off_c event.")
                identifier = "note_off_c"

            # Skip tempo rows that were suppressed in favor of spoofed tempo
            if identifier in ("tempo", "bpm") and idx in suppressed_rows:
                continue

            event = csv_to_midi_map[identifier](tr, tick, identifier, line[3:])
            tgt_track = track_map.get(tr, track)
            if tgt_track is None:
                tgt_track = Track(tick_relative=False)
                pattern.append(tgt_track)
                track_map[tr] = tgt_track
            tgt_track.append(event)

            # Track tempo changes so subsequent 't' time conversions use the updated BPM
            if identifier in ("tempo", "bpm"):
                appended_tempo_by_row[idx] = (tgt_track, event)
                try:
                    new_bpm = float(event.bpm)
                except Exception:
                    new_bpm = st['current_bpm']
                st['current_bpm'] = new_bpm
                new_tps = ticks_per_second(pattern.resolution, new_bpm, st['current_numer'], st['current_denom'])
                new_change = { 'sec': secs, 'tick': tick, 'bpm': new_bpm, 'numer': st['current_numer'], 'denom': st['current_denom'], 'tps': new_tps }
                st['history'].append(new_change)
                current_bpm = new_bpm

    pattern.make_ticks_rel()
    return pattern
