const config = require('./config');
const fs = require('fs');
const neutralPitchBend = 8192; // Middle of the 14-bit range
const semitone = neutralPitchBend / 2; // One semitone
// Calculate cents from initial frequency (standard tuning, A4 = 440 Hz), to target frequency
const initialFrequency = 440;
const targetFrequency = config.TUNING.FREQUENCY; // Set this in config.js
const centsToTarget = 1200 * Math.log2(targetFrequency / initialFrequency);
// Convert cents to pitch bend value
const pitchBend = Math.round(neutralPitchBend + (semitone * (centsToTarget / 100)));
// Verify target frequency with pitch bend applied
const newFrequency = initialFrequency * Math.pow(2, centsToTarget / 1200);
console.log(`centsToTarget: ${centsToTarget}, pitchBend: ${pitchBend}, Effective targetFrequency: ${newFrequency} Hz`);
// Update the PITCH_BEND in the loaded config
config.updatePitchBend(pitchBend);
// Read the file content
fs.readFile('./config.js', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading file:', err);
        return;
    }
    // Replace the old PITCH_BEND value with the new one
    const newData = data.replace(/PITCH_BEND: \d+/g, `PITCH_BEND: ${pitchBend}`);
    // Write the changes back to the file
    fs.writeFile('./config.js', newData, (err) => {
        if (err) {
            console.error('Error writing file:', err);
        } else {
            console.log('PITCH_BEND value in config updated successfully');
        }
    });
});
