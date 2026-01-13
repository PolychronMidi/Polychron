import csv

# Configuration
min_val = 1
max_val = 20
default_bpm = 60  # You can change this in the CSV later

filename = "meter_matrix.csv"

with open(filename, mode='w', newline='') as file:
    writer = csv.writer(file)

    # Write Header
    writer.writerow([
        "Numerator (Top)",
        "Denominator (Bottom)",
        "BPM (Quarter Note Ref)",
        "Seconds Per Measure (Formula)",
        "Meter Ratio"
    ])

    row_index = 2 # Start at 2 because row 1 is header

    # Loop through Numerators 1-20
    for num in range(min_val, max_val + 1):
        # Loop through Denominators 1-20
        for denom in range(min_val, max_val + 1):

            # The Spreadsheet Formula
            # Formula: =(60 / BPM_Cell) * (Num_Cell / Denom_Cell) * 4
            formula = f"=(60/C{row_index})*(A{row_index}/B{row_index})*4"

            # Meter Ratio for quick reference (Decimal)
            ratio = num / denom

            writer.writerow([num, denom, default_bpm, formula, ratio])
            row_index += 1

print(f"Successfully created '{filename}' with {row_index-2} combinations.")
