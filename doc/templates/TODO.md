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

### Todo - Set 46
#1 1_ replace per-consult runtime shell spam with generated mesh consultation runner from context manifests; ban premature final reports and background polling for consult tasks
#2 5_ make `teams/rounds/consult_from_context.py <ctx>` proof-carrying: after a successful consult, do not return success until required post-completion native Read tool_use rows are observed in the Claude transcript (prove_native_reads gates main; verified live round proof-carrying-standard-1781031522)
#3 5_ add a standard-run proof verifier for consults that records `completed_at`, transcript path/session id, required artifact list, Read tool_use line numbers, tool ids, timestamps, and path coverage in `_consult-native-read-proof.json`
#4 5_ make consult runner exit nonzero when native Read proof is missing, stale, manual/substitute-only, or incomplete; reject queue-only, manual Read, proxy synthetic injection, and external PTY harness proofs as success evidence (collect_native_read_rows rejects hme_consult_auto_read_* synthetic ids; rc=1 on missing proof)
#5 4_ wire the existing readq/PTY submission into the proof loop so the standard bare invocation itself waits for or triggers the native Read chain, with bounded timeout and clear failure diagnostics
#5f_ replace the claude -p print-mode proof driver with live-PTY/readq-only triggering so the standard bare run never spawns a side print session; fail clearly when no live bridge is attached
#6 4_ add tests/smokes proving standard bare `python3 teams/rounds/consult_from_context.py <ctx>` succeeds only when transcript-native post-completion Read rows cover every required artifact and fails otherwise
#6f_ add an end-to-end smoke (not just unit) asserting rc=0 only with full transcript coverage and rc=1 on partial/synthetic-only coverage
#7 5_ strip rendered tool-call/result echo leaks (Called/Calld <Tool> tool ... / Result of calling ... / File ... updated successfully) from model-visible text in hook_ui_echo_guard with regression coverage in policy_universalization.test.js
