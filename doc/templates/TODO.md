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
#1 5_ Dynamic loop proof through the REAL shell hooks: verify-onboarding-shell-hooks.py drives BOTH posttooluse_edit.sh (targeted->edited; guard + failed-edit negatives) and posttooluse_bash.sh (reviewed->piped; wrong-predecessor negative) against an isolated PROJECT_ROOT (real tools/ symlink, sandboxed tmp/metrics). 5/5 cases pass. Wired as OnboardingShellHooksVerifier (weight 2.0). This is the dynamic layer static analysis can't reach -- the class that let targeted->edited pass every static check.
#2 5_ Advancer-site discovery: audit-onboarding-transitions.py now discovers shell advancers (os.walk hooks/) and python advancers (glob server/onboarding_chain*.py, picking up the helpers.py set_state blind spot), not hardcoded paths. Regression test test_advancer_in_non_dispatch_server_module_is_discovered pins it. 52/52 specs green.
#3 5_ Label/count drift guard: LABEL-DRIFT failure class added -- STEP_LABELS must cover every canonical state in order with sequential N/M where M = non-graduated count. Regression tests for coherent-pass, denominator-drift-fail, missing-state-fail. Absent chain file skips benignly. 52/52 specs green.
