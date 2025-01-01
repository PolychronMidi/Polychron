### System ###
import csv

from .events import csv_to_midi_map
from .midi.containers import *

### Local ###
from .midi.events import *

COMMENT_DELIMITERS = ("#", ";")


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
    for line in csv.reader(file, skipinitialspace=True):
        if not line:
            continue
        if line[0].startswith(COMMENT_DELIMITERS):
            continue
        tr = int(line[0])
        time = round(float(line[1]))
        identifier = line[2].strip().lower()
        if identifier == "header":
            pattern.format = int(line[3])
            resolution = int(line[5])
            if resolution > 30000:
                print("Warning: Maximum resolution (PPQ) is 30,000. Using 30,000.")
                resolution = 30000
            pattern.resolution = resolution
        elif identifier == "end_of_file":
            continue # unused but left for backward compatability
        elif identifier == "start_track":
            track = Track(tick_relative=False)
            pattern.append(track)
        else:
            event = csv_to_midi_map[identifier](tr, time, identifier, line[3:])
            track.append(event)
    pattern.make_ticks_rel()
    return pattern
