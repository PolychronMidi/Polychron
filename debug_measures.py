import sys
import re

lines = sys.stdin.read().strip().split('\n')
prev_tick = None

for i, line in enumerate(lines):
    parts = line.split(',')
    tick = int(parts[1])

    # Extract tpSec
    tpsec_match = re.search(r'tpSec: (\d+)', line)
    if tpsec_match:
        tpsec = int(tpsec_match.group(1))
    else:
        continue

    # Extract logged length
    length_match = re.search(r'Length: ([\d:.]+)', line)
    if length_match:
        length_str = length_match.group(1)
        minutes, seconds = length_str.split(':')
        logged_length = float(minutes) * 60 + float(seconds)
    else:
        logged_length = 0

    print(f'Measure {i+1}: tick={tick}, tpsec={tpsec}, logged_length={logged_length:.4f}')

    if prev_tick is not None:
        diff = tick - prev_tick
        calc_length = diff / tpsec
        print(f'  Calculated from ticks: {calc_length:.4f} seconds')
        print(f'  Difference: {abs(calc_length - logged_length):.4f} seconds')
        if abs(calc_length - logged_length) > 0.0001:
            print(f'  MISMATCH!')

    prev_tick = tick