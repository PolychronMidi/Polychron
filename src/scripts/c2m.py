#!/usr/bin/env python3
"""Convert CSV (csv_maestro) files to .mid - accepts filenames as arguments.

Usage:
  python c2m.py                 # converts output/output1.csv and output/output2.csv (legacy behavior)
  python c2m.py outputSHRED     # converts output/outputSHRED.csv -> output/outputSHRED.mid
  python c2m.py output/outputSHRED.csv
  python c2m.py file1.csv file2 # convert multiple files
"""

import os
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from csv_maestro import py_midicsv as x


def convert_csv_to_midi(csv_path):
    """Convert a single CSV file to MIDI.

    The input path is normalized (user expansion and absolute) before
    being processed. The output MIDI file uses the same base name and
    the same directory as the CSV file, with a ``.mid`` suffix.
    """

    csv_path = os.path.abspath(os.path.expanduser(csv_path))
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"c2m.py: input CSV not found: {csv_path}")
    midi_path = str(Path(csv_path).with_suffix('.mid'))
    with open(midi_path, 'wb') as midi:
        x.FileWriter(midi).write(x.csv_to_midi(csv_path))
    print(f"{csv_path} converted to {midi_path}")


def resolve_input_path(raw):
    # Accept bare names without extension and try sensible fallbacks.  This
    # function expands ``~`` and returns an absolute path if a file exists.
    candidate = os.path.expanduser(raw)
    path = Path(candidate)

    # direct hit
    if path.is_file():
        return str(path)

    # add .csv extension if missing
    if not path.suffix:
        maybe = Path(str(path) + '.csv')
        if maybe.is_file():
            return str(maybe)

    # try in the ``output`` directory (mirrors legacy behaviour)
    outdir = Path('output')
    tentative = outdir / path.name
    if tentative.is_file():
        return str(tentative)
    if not path.suffix:
        tentative = outdir / (path.name + '.csv')
        if tentative.is_file():
            return str(tentative)

    return None


def main(argv=None):
    p = argparse.ArgumentParser(description='Convert csv_maestro CSV -> .mid')
    p.add_argument('csvfile', nargs='*', help='CSV file(s) to convert (basename or path).')
    args = p.parse_args(argv)

    targets = args.csvfile if args.csvfile and len(args.csvfile) > 0 else ['output/output1.csv', 'output/output2.csv']
    # expand user/home markers in CLI arguments because Windows and Linux
    # shells behave differently; this keeps behaviour consistent.
    targets = [os.path.expanduser(t) for t in targets]

    for raw in targets:
        path = resolve_input_path(raw)
        if not path:
            sys.exit(f'c2m.py: could not resolve input file: {raw}')
        try:
            convert_csv_to_midi(path)
        except Exception as e:
            sys.exit(f'c2m.py: conversion failed for {path}: {e}')


if __name__ == '__main__':
    main()
