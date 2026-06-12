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

### Todo - Set 53
#1 0_ Dynamic loop proof through the REAL shell hooks: verify-onboarding-flow.py already dynamically drives the PYTHON chain (boot->graduated, all pass) but grep confirms it never invokes the shell hooks -- so the targeted->edited advancer (which lives in posttooluse_edit.sh) would still have passed it. Extend it (or add a sibling) to exercise the posttooluse_*.sh advancers against an isolated state file, proving the shell-side transitions fire on their real trigger+guard, not just the python ones.
#2 1_ Advancer-site discovery: make audit-onboarding-transitions.py DISCOVER advancer sites (any file calling _onb_advance_to/set_state) instead of scanning 3 hardcoded paths, so a new advancer in a new file/runtime cannot escape the dead-edge/ghost/unguarded checks.
#3 1_ Label/count drift guard: assert STEP_LABELS N/M numbering + label count stay derived-from / consistent-with the canonical state list, so adding a state can't silently leave the "N/7" labels lying (same drift class as the briefed ghost, one layer up).
