# teams/rounds

Durable review-round runners for the team mesh.

Runners use tracked capsules from `teams/capsules/` and write transient outputs
to ignored `teams/runtime/output/`. They must remain sequential (no fan-out) to
avoid provider overload and to preserve auditable turn order.
