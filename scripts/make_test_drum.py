# Generates a small CSV with a single drum hit and converts to MIDI (output/test_drum.mid)
from csv_maestro import py_midicsv as x
csv_path = 'output/test_drum.csv'
mid_path = 'output/test_drum.mid'
# Minimal CSV: PPQ 96, one track with a single note_on (channel 9 -> drum channel), then end_track
csv_content = """0,0,header,1,1,96
1,0,start_track
1,0,note_on_c,9,36,100
1,0,end_track
"""
with open(csv_path, 'w', newline='') as f:
    f.write(csv_content)
# Convert to MIDI
with open(mid_path, 'wb') as midi:
    x.FileWriter(midi).write(x.csv_to_midi(csv_path))
print(f'Wrote {csv_path} and {mid_path}')
