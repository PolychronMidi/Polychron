#!/usr/bin/env python3
"""Convert CSV (csv_maestro) files to .mid - accepts filenames as arguments.

Usage:
  python c2m.py                 # converts output/output1.csv and output/output2.csv (legacy behavior)
  python c2m.py outputSHRED     # converts output/outputSHRED.csv -> output/outputSHRED.mid
  python c2m.py output/outputSHRED.csv
  python c2m.py file1.csv file2 # convert multiple files
"""

from csv_maestro import py_midicsv as x
import os
import sys
import argparse


def convert_csv_to_midi(csv_path):
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"c2m.py: input CSV not found: {csv_path}")
    midi_path = os.path.splitext(csv_path)[0] + '.mid'
    with open(midi_path, 'wb') as midi:
        x.FileWriter(midi).write(x.csv_to_midi(csv_path))
    print(f"{csv_path} converted to {midi_path}")


def resolve_input_path(raw):
    # Accept bare names without extension and try sensible fallbacks
    candidate = raw
    base, ext = os.path.splitext(candidate)
    if ext == '':
        # try with .csv
        if os.path.exists(candidate + '.csv'):
            return candidate + '.csv'
        if os.path.exists(os.path.join('output', candidate + '.csv')):
            return os.path.join('output', candidate + '.csv')
    else:
        if os.path.exists(candidate):
            return candidate
        # try output/ basename fallback
        if os.path.exists(os.path.join('output', os.path.basename(candidate))):
            return os.path.join('output', os.path.basename(candidate))
    # final attempt: if provided string looks like a basename, try output/<basename>.csv
    if not os.path.isabs(candidate) and os.path.exists(os.path.join('output', candidate)):
        return os.path.join('output', candidate)
    return None


def main(argv=None):
    p = argparse.ArgumentParser(description='Convert csv_maestro CSV -> .mid')
    p.add_argument('csvfile', nargs='*', help='CSV file(s) to convert (basename or path).')
    args = p.parse_args(argv)

    targets = args.csvfile if args.csvfile and len(args.csvfile) > 0 else ['output/output1.csv', 'output/output2.csv']

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
