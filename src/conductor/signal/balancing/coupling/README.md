# conductor/signal/balancing/coupling

Self-tuning decorrelation engine. `pipelineCouplingManager` is the thin orchestrator: it reads the full coupling matrix from `systemDynamicsProfiler` each beat, then delegates to helpers for gain adaptation, effective-gain computation, and bias accumulation.

**Single-ownership contract:** all mutable state lives in `couplingState`; all constants live in `couplingConstants`. Helpers must not carry their own copies of either — sharing diverges under the meta-controller chain.

`pipelineCouplingManager` is one of the **few legitimate readers of `.couplingMatrix`** from `systemDynamicsProfiler.getSnapshot()`. Other modules needing coupling awareness register a bias through `conductorIntelligence` instead.

## Sub-boundary

`homeostasis/` is a tracked sub-boundary with its own README — its constants and state are separate and must not be imported directly into this dir's modules.

<!-- HME-DIR-INTENT
rules:
  - All mutable state in couplingState, all constants in couplingConstants — helpers own neither; divergence breaks the meta-controller chain
  - This is one of the few legitimate .couplingMatrix readers; all other modules register a bias through conductorIntelligence instead
-->
