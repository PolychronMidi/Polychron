#!/usr/bin/env python3
"""Convert MIDI (.mid) files to csv_maestro CSV.

Usage:
  python m2c.py                      # converts output/output.mid -> output/output.csv
  python m2c.py somefile            # converts somefile.mid or somefile -> somefile.csv
  python m2c.py file1.mid file2     # convert multiple files
  python m2c.py --outdir csvs/ file1.mid file2

The behaviour mirrors :mod:`c2m` except that mid -> csv is performed.
"""

import os
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from csv_maestro import py_midicsv as x


def convert_midi_to_csv(midi_path, outdir=None):
    midi_path = os.path.abspath(os.path.expanduser(midi_path))
    if not os.path.exists(midi_path):
        raise FileNotFoundError(f"m2c.py: input MIDI not found: {midi_path}")
    midi = Path(midi_path)
    csvname = midi.stem + '.csv'
    if outdir:
        outdir = Path(os.path.expanduser(outdir))
        outdir.mkdir(parents=True, exist_ok=True)
        csv_path = str(outdir / csvname)
    else:
        csv_path = str(midi.with_suffix('.csv'))

    with open(midi_path, 'rb') as midif, open(csv_path, 'w') as csvf:
        csvf.write('\n'.join(
            [','.join(field.strip().strip('"') for field in line.split(','))
             for line in x.midi_to_csv(midif)]
        ))
    print(f"{midi_path} converted to {csv_path}")


def resolve_input_path(raw):
    raw = os.path.expanduser(raw)
    path = Path(raw)
    if path.is_file():
        return str(path)
    # try with .mid extension
    if not path.suffix:
        maybe = Path(str(path) + '.mid')
        if maybe.is_file():
            return str(maybe)
    # look in output/ directory
    outdir = Path('output')
    tentative = outdir / path.name
    if tentative.is_file():
        return str(tentative)
    if not path.suffix:
        tentative = outdir / (path.name + '.mid')
        if tentative.is_file():
            return str(tentative)
    return None


def main(argv=None):
    p = argparse.ArgumentParser(description='Convert .mid -> csv_maestro CSV')
    p.add_argument('midifile', nargs='*', help='MIDI file(s) to convert (basename or path).')
    p.add_argument('-o', '--outdir', help='Directory to write CSV outputs into.')
    args = p.parse_args(argv)

    targets = args.midifile if args.midifile and len(args.midifile) > 0 else ['output/output.mid']
    targets = [os.path.expanduser(t) for t in targets]

    for raw in targets:
        path = resolve_input_path(raw)
        if not path:
            sys.exit(f'm2c.py: could not resolve input file: {raw}')
        try:
            convert_midi_to_csv(path, outdir=args.outdir)
        except Exception as e:
            sys.exit(f'm2c.py: conversion failed for {path}: {e}')


if __name__ == '__main__':
    main()
