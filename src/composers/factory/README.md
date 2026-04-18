# composers/factory

Composer instantiation and capability profile binding. `FactoryManager` is the static orchestrator — it holds the active composer family, capability profiles, runtime profile precedence, and the shared phrase arc manager.

`setComposerContext()` must be called before any factory construction. The shared `phraseArcManager` is reset between sections via `resetPhraseArcManager()` — never reset it mid-phrase or from a per-beat handler.

Capability profiles are validated by `validateCapabilityProfiles()` at boot. If you add a new profile key, add it to the capability surface in `composerCapabilities.js` first — the validator will reject unknown keys.

<!-- HME-DIR-INTENT
rules:
  - setComposerContext() must be called before any factory construction — FactoryManager state is undefined until then
  - New profile keys must be declared in composerCapabilities.js first; validateCapabilityProfiles() rejects unknown keys at boot
-->
