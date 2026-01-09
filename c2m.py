from csv_maestro import py_midicsv as x

with open("output1.mid", "wb") as midi:
    x.FileWriter(midi).write(x.csv_to_midi("output1.csv"))

print("output1.csv converted to output1.mid")

with open("output2.mid", "wb") as midi:
    x.FileWriter(midi).write(x.csv_to_midi("output2.csv"))

print("output2.csv converted to output2.mid")
