# conductor/signal/meta/manager

`hyperMetaManager` is the primary orchestration hub for the hypermeta layer — it assembles state, systemHealth, contradictions, topologyIntelligence, and telemetryReconciliation into a single query surface consumed by all 19 meta-controllers.

**Tick cadence is split:** a fast EMA energy pass runs every beat; the full orchestration logic runs every `ORCHESTRATE_INTERVAL` beats. Never move the full orchestration into the per-beat path — it is intentionally coarsened to prevent oscillation.

Public getters (`getRateMultiplier`, `getPhaseBoostCeiling`, `getAxisConcentration`, etc.) are the only legitimate read path for meta-layer signals. Don't read from `state.js` directly outside this dir.

<!-- HME-DIR-INTENT
rules:
  - Full orchestration runs every ORCHESTRATE_INTERVAL beats only — never move it into the per-beat fast path
  - Meta-layer signals are read through hyperMetaManager public getters only — never import state.js directly from outside this dir
-->
