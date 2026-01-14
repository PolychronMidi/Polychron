from csv_maestro import py_midicsv as x

with open("output/output1.mid", "wb") as midi:
    x.FileWriter(midi).write(x.csv_to_midi("output/output1.csv"))

print("output/output1.csv converted to output/output1.mid")

with open("output/output2.mid", "wb") as midi:
    x.FileWriter(midi).write(x.csv_to_midi("output/output2.csv"))

print("output/output2.csv converted to output/output2.mid")
