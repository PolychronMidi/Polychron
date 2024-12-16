import py_midicsv

midi_object = py_midicsv.csv_to_midi("output.csv")

with open("output.mid", "wb") as output_file:
    midi_writer = py_midicsv.FileWriter(output_file)
    midi_writer.write(midi_object)

print("output.mid created from output.csv")
