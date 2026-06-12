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

### Todo - Set 51

#18 5_ deliver consult read-chain results into the live session. RESOLVED via the agreed design: the read RESULTS are delivered as a user-prompt response through the PTY/cc-control FIFO bridge after each consult finishes. The original literal goal (force the host to execute a proxy-emitted native Read tool_use on a task-notification turn) was proven host-blocked -- the Claude Code client runs no tool-execution loop on that turn, so no proxy change can make it persist the synthetic Read; recorded machine-readably as host_execution_status:"blocked-host-side" in causal-paths.json. SHIPPED instead: teams/rounds/consult_from_context.deliver_read_results_prompt reads the consult result-file CONTENT and writes token `rd` + base64 to tmp/hme-cc-control.fifo (cc_control.js wire protocol, replayed by hme-claude.py; `rd` multi-step shortcut), delivering the actual fetched bytes as one ordinary prompt -- not a [HME_READ_CHAIN] control token (retired route stays grep-clean). PIPE_BUF drain-loop handles briefings > 4096 bytes (regression test proven to fail against the old single-write). causal-paths entry consult.read-results-delivery (host_execution_status:"not-applicable") + validator negative controls. The two real SSE-correctness defects found en route are fixed + regression-locked (message_start carries an OPEN message; read_chain_e2e.test.js 5 tests). consult_from_context.test.py 11, shortcuts_config 10, battery 181/181.
