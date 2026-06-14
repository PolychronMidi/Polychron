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

### Todo - Set 54

#18 0_ prove read-chain through actual host/Claude Code transcript path, not only proxy HTTP: task-notification must lead to native Read tool_use/tool_result rows with hme_read_chain__ provenance. BLOCKED (re-verified 2026-06-11): latest-consult-read-queue.json shows consumed:true at 22:47 (proxy read_chain_driver consumed the queue), yet JSON-structured parsing of the 3 most recent host transcripts found 0 tool_use rows named Read with hme_read_chain__ ids and 0 matching tool_result rows -- the 200+ text hits are grep/transcript echoes, not structured tool rows. Proxy emit path is well-formed (read_chain.js buildReadToolUseMessage sets stop_reason:'tool_use' with a proper content_block_start/input_json_delta/content_block_stop SSE), so the gap is host-side: the Claude Code client is not executing/persisting the synthetic Read tool_use from a non-streaming or streamed proxy response on the task-notification turn. Subagent deep-audit (level 4) confirmed host-side limitation, not a proxy defect: queue is provably consumed only after clientRes.end ships the synthetic Read tool_use on the task-notification turn, yet the host runs no tool-execution loop on that turn (no execute, no persist, no follow-up tool_result), so the chain dead-ends at index 0; no proxy change can force the host to run a tool on a turn it does not treat as agentic. The two real (non-causal) SSE-correctness defects the audit surfaced ARE now fixed + regression-locked: read_chain.js toAnthropicSse message_start now carries an OPEN message (stop_reason/stop_sequence null, usage.output_tokens 1; terminal stop_reason only in message_delta), asserted in read_chain_e2e.test.js (5 tests pass). Completion of the host-execution proof requires host/client behavior investigation without FIFO/readq, /hme/spawn, or task-output polling.
