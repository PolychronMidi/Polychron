# composers/profiles

Style profile definitions — one file per style family (blues, chords, chromatic, modal interchange, mode, pentatonic, quartal, scale, tension-release, melodic development, voice leading, harmonic rhythm, measure). All profile source files load before `profileUtils`, `validateProfiles`, and `runtimeProfileAdapter`.

`validateProfiles` runs at boot and will throw on unknown keys. When adding a parameter to a profile, the corresponding key must already exist in the capability surface (`composerCapabilities.js`) — otherwise the validator rejects the profile at startup, not at runtime when the parameter is first read.

`runtimeProfileAdapter` allows profiles to be patched at runtime based on conductor signals. Never bypass it by writing directly to a profile object — runtime patches go stale and produce incoherent behavior across sections.

<!-- HME-DIR-INTENT
rules:
  - New profile parameters must exist in composerCapabilities.js before adding them to a profile — validateProfiles throws at boot otherwise
  - Runtime profile patches go through runtimeProfileAdapter only — never mutate profile objects directly
-->
