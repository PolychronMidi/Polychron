from csv_maestro import py_midicsv as x

with open("output.mid", "rb") as midi, open("output.csv", "w") as csv:
    csv.write('\n'.join([','.join(field.strip().strip('"') for field in line.split(',')) for line in x.midi_to_csv(midi)]))

print("output.mid converted to output.csv")
