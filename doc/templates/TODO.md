# File Format Rules: 1 todo item per line. Each line must start with one of the following todo status codes:
0_ default status upon creation,
1_ in progress,
2_ revisit (default is in 10 minutes, or whenever all todos in list completed, move to top of list as status 0_). Specify minutes by appending like "2_60",
3_ major block via architechtural design, scope, or low confidence/high risk needing explicit confirmation,
4_ nominally complete, but needs a follow-up. Must be followed by the follow-up todo on the next line with the following code,
4f_ follow up todo, automatically becomes status 0_ in 30 minutes, or specify custom minutes like "4f_60" for 60 minutes. If needs qualifier before becoming status 0_, append _q="qualifier explanation here". Auto-added to new todo sets
5_ Completed totally, no danglers, nothing missing.

Example:
#1 5_ make todo template with rules so agents can simply fill out below. A set auto-archives to `log/todo/set<number>.md` once no item is still in progress (none at 0_/1_/2_) and at least one item is 5_; the non-5_ items (3_/4_/4f_) carry forward into the next set with their codes preserved

### Todo - Set 25

#15 5_ F1 deeper policy/governance integration -- DONE (CEO/user sign-off to scope F1 to AUDITABILITY, DECLINE enforcement). Shipped: teams/rounds/coverage_status.py turns teams/rounds/coverage-map.json (machine-readable review-status DATA, no longer a doc/*.md spillover) into a governance signal (reviewed/pending counts + which control-plane surfaces lack mesh review; --strict gate; coverage_status.test.py). ENFORCEMENT DECLINED with recorded reasons: gating live autonomous actions on review-status would either fail-closed (block legitimate work on "unreviewed" surfaces, violating the cost-control charter) or fail-open (security theater); review status is point-in-time, so coupling runtime permission to it makes safety depend on map freshness; the mesh's proven value is REVIEW (defect discovery + calibrated dissent), not runtime gatekeeping. Auditability is the right, sufficient F1 scope.
