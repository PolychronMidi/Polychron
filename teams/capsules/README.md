# teams/capsules

Durable Context Capsules used by the team-review mesh.

Each capsule is a bounded, auditable review input: artifact, goal, constraints,
rubric, coverage, and evidence. The dispatch guard enforces required sections
and checks that `## coverage` `included:` code-symbol claims are present in the
`## evidence` body before a peer can be grounded by the capsule.
