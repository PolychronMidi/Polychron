import py_midicsv

# Convert the CSV file to a MIDI file
midi_object = py_midicsv.csv_to_midi("output.csv")

# Save the MIDI file
with open("output.mid", "wb") as output_file:
    midi_writer = py_midicsv.FileWriter(output_file)
    midi_writer.write(midi_object)
