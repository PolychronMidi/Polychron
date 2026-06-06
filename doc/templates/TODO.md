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

### Todo - Set 27

#23 1_ Execute Phase 14 Workstream 1 via mesh: make the corrected progress-ledger/status-reader/reply-capture/failure-state contract binding for remaining first-class round runners, with regression tests and HCI verification
#24 0_ Execute Phase 14 Workstream 2 via mesh: run corrected red/blue/purple consultation on mesh signal discipline (dispatch guard, review_brief.py, ask-peer routing, team-channel writes), accept only decision-changing grounded fixes, and verify regressions
#25 0_ Execute Phase 14 Workstream 3 via mesh: select one HME self-coherence-suite slice, run corrected consultation for P0/P1 gaps that make HCI misleading/noisy/stale/fail-open, and land verifier/test/registry fixes
#26 0_ Execute Phase 14 Workstream 4: keep all approved work in TODO, team messages in channels, review-brief data beside runners, and update plan.md status only after implementation + verification
