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
#1 5_ replace per-consult runtime shell spam with generated mesh consultation runner from context manifests; ban premature final reports and background polling for consult tasks (consult_from_context.py owns manifests; task-output polling blocked; read-chain proof no longer types into user input)
#2 5_ make `teams/rounds/consult_from_context.py <ctx>` proof-carrying: after a successful consult, require queued proxy read_chain proof artifacts and host task-notification native Read coverage before reporting conclusions
#3 5_ add a standard-run proof verifier for consults that records `completed_at`, transcript path/session id, required artifact list, Read tool_use line numbers, tool ids, timestamps, and path coverage in `_consult-native-read-proof.json`
#4 5_ make consult proof reject stale, manual/substitute-only, incomplete, proxy synthetic injection, external PTY harness, and input-field marker proofs as success evidence
#5 5_ replace readq/PTY consult proof submission with proxy task-notification read_chain: no FIFO, no readq!, no submit_read_queue_to_pty, no `[HME_READ_CHAIN]` typed into the live input field; regression locked by no-retired-consult-readchain-routes and read_chain_e2e task-notification test
#6 5_ add tests/smokes proving standard bare `python3 teams/rounds/consult_from_context.py <ctx>` succeeds only when transcript-native post-completion Read rows cover every required artifact and fails otherwise (8 passing; proof-gate pass-on-full-coverage and fail-on-partial-coverage smokes with background appender simulating live post-start reads)
#7 5_ strip rendered tool-call/result echo leaks (Called/Calld <Tool> tool ... / Result of calling ... / File ... updated successfully) from model-visible text in hook_ui_echo_guard with regression coverage in policy_universalization.test.js
#8 5_ Phase Omega workstream 1: add compact causal proof schema, validator, and sample coherence trace fixture
#9 5_ Phase Omega workstream 2: add dead-mechanism reaper invariant for retired consult/read-chain routes (FIFO/readq typing, submit_read_queue_to_pty, readq!, local-session [HME_READ_CHAIN] expansion, stale PTY/nonce proof wording, foreign /proc fd pokes)
#10 5_ Phase Omega workstream 3: add typed shortcut and route causal-path metadata plus tests for rr, cc, task-notification read-chain, and retired readq
#11 5_ Phase Omega workstream 4: add executable invariant topology graph and validator with watcher edges, escape vectors, and negative controls
#12 5_ Phase Omega workstream 5: add artifact lifecycle lattice and tracked-path lifecycle check for source/generated/runtime/metric/proof/transcript/ephemeral/fixture/baseline/retired paths
#13 5_ Phase Omega workstream 6: add runtime freshness helper and context thermodynamics checks for stale logs, task-output paths, duplicate hook banners, and context-burn noise
#14 5_ Phase Omega workstream 7: add failure-alchemy workflow guard enforcing diagnose -> smallest patch -> syntax -> targeted test -> invariant/test/deletion -> broad suite -> proof trace
#15 1_ produce final compact coherence trace for Phase Omega implementation and verify battery, JS specs, Python specs, read-chain no-input-spam path, and runtime freshness
