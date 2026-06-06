# teams/rounds

Durable review-round runners for the team mesh.

Runners compose per-surface review briefs (DATA in `review-briefs.json`, via
`review_brief.py`) into a peer review-request MESSAGE -- with live source inlined
fresh at dispatch -- and send it through ask-peer so it lands in the
red/blue/purple channel. Briefs are never committed capsule files. Transient
outputs go to ignored `teams/runtime/output/`. Runners must remain sequential
(no fan-out) to avoid provider overload and preserve auditable turn order.
