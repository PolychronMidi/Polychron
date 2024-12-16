Polychron is an innovative MIDI composition system that breaks free from traditional MIDI limitations, particularly in the realm of time signatures. The core innovation of Polychron lies in its ability to work with any time signature through a process called "meter spoofing." The key to Polychron's unconventional time signature support is the spoofMeter function:

This function allows for the representation of any time signature (yes, even 420/69) within the constraints of MIDI. Here's how it works:

If the denominator is a power of 2 (standard MIDI meter), it returns the original meter with no changes.
For non-standard denominators, it calculates the nearest power of 2 (either ceiling or floor).
It then determines a tempo factor to compensate for the difference between the actual and spoofed meter.

This approach allows Polychron to represent and work with any time signature while maintaining compatibility with standard MIDI playback systems. The result is a composition system that can explore previously inaccessible rhythmic territories within the MIDI framework.
