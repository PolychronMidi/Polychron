# teams/rounds

Durable review-round runners for the team mesh.

Runners compose per-surface review briefs (DATA in `review-briefs.json`, via
`review_brief.py`) into a peer review-request MESSAGE -- with live source inlined
fresh at dispatch -- and send it through ask-peer so it lands in the
red/blue/purple channel. Briefs are never committed capsule files. Transient
outputs go to ignored `teams/runtime/output/`. Runners must remain sequential
(no fan-out) to avoid provider overload and preserve auditable turn order.

## Depth decisions

Use `depth_decision.py` when a round needs to decide whether to buy more debate
turns. It computes one evidence-weighted `mesh_depth_decision` JSONL row for the
round ledger. Votes decide depth budget only, never truth: unsupported votes are
advisory, grounded P0/P1 or guard/HCI/routing/compaction gates can override
headcount, and every escalation carries an anti-bloat requirement for new
evidence on the next turn. TODO receives only durable work items produced by the
round, not per-agent votes.
