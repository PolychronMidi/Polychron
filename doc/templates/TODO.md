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

### Todo - Set 48

#15 3_ F1 deeper policy/governance integration: wire the mesh into permission decisions, write gates, state ownership, and lifecycle hooks so every autonomous action is governable and auditable. AUDITABILITY HALF LIVE (evidence corrected): the coverage_status.py/myth0s-coverage-map.md/coverage-map.json path cited earlier was RETIRED in commit 48a21902a (review-briefs.json names them "historical retired capsule/coverage-map/scoring tools"); the live governance signal is teams/rounds/review_brief.py + review-briefs.json -- briefs ARE channel messages whose `## evidence`/`## coverage included:` symbols are inlined from LIVE source at dispatch, so a review can never drift onto stale code (review_brief.test.py green). ENFORCEMENT HALF NEEDS EXPLICIT CONFIRMATION (3_): making the live permission/write/lifecycle gates CONSULT review status to gate autonomous actions is a high-risk control-plane change -- needs a design decision (which surfaces gate which actions, fail-open vs fail-closed, override path) and CEO/user sign-off before implementation. Stale .pyc for the retired modules removed.

#18 3_ prove read-chain through actual host/Claude Code transcript path, not only proxy HTTP: task-notification must lead to native Read tool_use/tool_result rows with hme_read_chain__ provenance. BLOCKED (re-verified 2026-06-11): latest-consult-read-queue.json shows consumed:true at 22:47 (proxy read_chain_driver consumed the queue), yet JSON-structured parsing of the 3 most recent host transcripts found 0 tool_use rows named Read with hme_read_chain__ ids and 0 matching tool_result rows -- the 200+ text hits are grep/transcript echoes, not structured tool rows. Proxy emit path is well-formed (read_chain.js buildReadToolUseMessage sets stop_reason:'tool_use' with a proper content_block_start/input_json_delta/content_block_stop SSE), so the gap is host-side: the Claude Code client is not executing/persisting the synthetic Read tool_use from a non-streaming or streamed proxy response on the task-notification turn. Completion requires host/client behavior investigation without FIFO/readq, /hme/spawn, or task-output polling.
