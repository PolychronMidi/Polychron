from csv_maestro import py_midicsv as x

with open("output.mid", "wb") as midi:
    x.FileWriter(midi).write(x.csv_to_midi("output.csv"))

print("output.csv converted to output.mid")
