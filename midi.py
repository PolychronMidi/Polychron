import py_midicsv as x

with open("output.mid", "wb") as i:
    x.FileWriter(i).write(x.csv_to_midi("output.csv"))

print("output.mid created from output.csv")
