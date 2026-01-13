import sys
import re

prev_time = None
for line in sys.stdin:
    line = line.strip()
    parts = line.split(',')
    time = int(parts[1])
    tpsec_match = re.search(r'tpSec: (\d+)', line)
    if tpsec_match:
        tpsec = int(tpsec_match.group(1))
    else:
        continue
    length_match = re.search(r'Length: ([\d:.]+)', line)
    if length_match:
        length_str = length_match.group(1)
        minutes, seconds = length_str.split(':')
        length_sec = float(minutes) * 60 + float(seconds)
    else:
        continue
    if prev_time is not None:
        diff = time - prev_time
        sp_calc = diff / tpsec
        print(f"Time {prev_time}: diff={diff} tpsec={tpsec} calc_sp={sp_calc:.4f} logged_sp={length_sec:.4f}")
        if abs(sp_calc - length_sec) > 0.0001:
            print("Mismatch")
    prev_time = time