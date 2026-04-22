# mcp/server/tools_analysis/coupling

Coupling-matrix analytics. Reads `systemDynamicsProfiler.getSnapshot().couplingMatrix` and derivative signals; produces pair-level pressure, gain, and antagonism reports that feed review + trace modes.

Per the CLAUDE.md coupling matrix firewall, this directory is one of the approved readers. Modules outside this dir that need coupling awareness must register a bias via `conductorIntelligence` — they do NOT read the matrix directly. The firewall is enforced by ESLint rule `local/no-direct-coupling-matrix-read`.

<!-- HME-DIR-INTENT
rules:
  - This dir is inside the coupling-matrix firewall (approved reader); modules outside must register biases via conductorIntelligence
  - Outputs feed review + trace dispatchers only; never mutate coupling state from here
-->
