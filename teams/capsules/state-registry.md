# Context Capsule: review the typed state registry

## artifact
tools/HME/proxy/state_registry.js -- the typed registry all HME state files go
through (register, read, write, append, reset, _writeAtomic, buildShapeSchema,
registerFromStateFiles, _loadStateFiles). Callers use it instead of raw
fs.read/writeFileSync to avoid schema drift; it provides atomic writes and
optional JSON schema validation.

## goal
Find decision-changing correctness/safety flaws: a write that can corrupt or
half-write durable state, a schema bypass that lets a malformed value persist, a
read that silently returns wrong-shaped data, an atomic-write race, or a jsonl
round-trip that drops/duplicates records. Cite the function + line.

## constraints
read() intentionally degrades to a typed empty (null/[]/'') on a missing file or
parse error -- that fail-soft is by design for optional state, unless you can show
it masks a real corruption a caller will trust. _writeAtomic must be crash-safe
(readers see old or new, never half). Schema validation only applies to json
format with a registered schema. Review only the evidence below unless you verify
a fact with tools.

## rubric
Classify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact
failure, contradictory evidence (which existing check/test may already cover it,
or "none found after checking"), and a one-line fix. Reject style notes. Prefer
atomic-write/durability, schema-bypass, and jsonl/parse round-trip bugs.

## coverage
included: full state_registry.js source below -- _absPath, _writeAtomic, register,
_loadStateFiles, registerFromStateFiles, _entry, read, write, append, reset,
paths, listRegistered, buildShapeSchema, and the module-load registrations.
excluded: the config/state-files.json contents and the individual callers; the
verify_coherence state-file-ownership verifier (assumed correct here).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/proxy/state_registry.js

