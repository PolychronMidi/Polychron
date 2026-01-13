@echo off
echo Polychron Complete Verification System
echo ======================================
echo.

echo Checking WAV file lengths:
echo --------------------------
echo output1.wav:
python check_audio_length.py output1.wav | tail -2
echo output2.wav:
python check_audio_length.py output2.wav | tail -2

echo.
echo Checking file sizes:
echo -------------------
dir output*.wav | findstr "output"

echo.
echo Checking measure timing accuracy:
echo ---------------------------------
echo Total measures and mismatches:
grep "marker_t" output1.csv | grep "Measure" | python debug_measures.py | grep -E "(Measure|MISMATCH)" | tail -5

echo.
echo Checking polyrhythm alignment:
echo ------------------------------
echo Primary layer measures per phrase:
grep "measuresPerPhrase1" time.js
echo Poly layer measures per phrase:
grep "measuresPerPhrase2" time.js

echo.
echo ABSOLUTE TIME ACCURACY STATUS:
echo ===============================
python check_wav_length.py output1.wav > temp1.txt
python check_wav_length.py output2.wav > temp2.txt
set /p LEN1=<temp1.txt
set /p LEN2=<temp2.txt
if "%LEN1%"=="%LEN2%" (
    echo  TRACK LENGTHS EQUAL - Absolute time accuracy achieved!
) else (
    echo L TRACK LENGTHS DIFFER - Time accuracy not achieved
)
del temp1.txt temp2.txt 2>nul

echo.
echo Verification complete.