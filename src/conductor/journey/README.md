# conductor/journey

Tonal trajectory planning across sections. `harmonicJourney` plans a key/mode journey once at composition start and advances through stops at section boundaries. `harmonicContext` is the shared state store — it is the single source of truth for current key, mode, and harmonic position consumed by all downstream composers and priors.

`planJourney(totalSections)` is called **once** from `main.js` at composition start. Never call it mid-composition or from a beat/section handler — it resets the journey from scratch and orphans any downstream state already seeded from the previous plan.

L2 gets a complementary relationship to L1 (same key, relative, or parallel) — this is planned at journey-build time, not dynamically per beat. If you need per-beat harmonic variation, update `harmonicContext` via its setters, not by re-planning.

<!-- HME-DIR-INTENT
rules:
  - planJourney() is called once at composition start only — never mid-composition; it resets the full journey and orphans downstream state
  - harmonicContext is the sole shared state store for current key/mode; downstream consumers read it, never maintain their own copies
-->
