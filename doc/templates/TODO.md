# File Format Rules: 1 todo item per line. Each line must start with one of the following todo status codes:
0_ default status upon creation,
1_ in progress,
2_ revisit (default is in 10 minutes, or whenever all todos in list completed, move to top of list as status 0_). Specify minutes by appending like "2_60",
3_ major block via architechtural design, scope, or low confidence/high risk needing explicit confirmation,
4_ nominally complete, but needs a follow-up. Must be followed by the follow-up todo on the next line with the following code,
4f_ follow up todo, automatically becomes status 0_ in 30 minutes, or specify custom minutes like "4f_60" for 60 minutes. If needs qualifier before becoming status 0_, append _q="qualifier explanation here". Auto-added to new todo sets
5_ Completed totally, no danglers, nothing missing.

Example:
#1 5_ make todo template with rules so agents can simply fill out below. Sets with all items marked code 3_ or above get automatically archived in `log/todo` as `set<number>.md`

### Todo - Set 4

#1 1_ HME design-pattern optimization survey: 4 parallel subsystem agents (proxy / event_kernel+hooks / verifiers+detectors / tools_analysis) finding duplication+inconsistent-abstraction to unify; synthesize their findings into items below as each returns

#2 0_ proxy: unify content-block text extraction — `blockText` (conversation_graph.js), `_extractTextContent` (hme_proxy_core.js), `_lastUserPromptText`/`_lastUserTextBlocks` (hme_proxy_request_mutation.js) each re-walk `content[]` for text; collapse to one shared helper [E2]

#3 0_ rewriters: hoist the structured-JSON bypass just added to `sse_slop_rewriter._emitHeldTextEvents` into a shared guard so `sse_ascii_strip_rewriter` and other response-text rewriters also never corrupt JSON/structured-output (root cause of the /goal-verdict "JSON validation failed") [E2]

#4 0_ hooks: ONE source of truth for self-origin `_SELF_TAG_RE` — it is duplicated AND drifting between `hooks/lifecycle/stop/lifesaver.sh` and `hooks/helpers/_check_errors_inline.sh` (`hook-output-validation` present in one, absent in the other → kernel self-health surfaces as agent-origin); extract to one shared file both source [E2]

#5 0_ env-fallback pattern sweep: 3 `process.env.PROJECT_ROOT || fallback` sites converted to `requireEnv` this session (proxy_liveness_gate.js, self_reexec.js, file_watcher_watch_set.test.js); audit remaining inline `||`/`os.environ.get(,default)` fallbacks for declared keys against the central resolver [E2]

#6 0_ re-run the design-pattern survey after the top optimizations land, to confirm no new duplication was introduced and the unifications actually removed the cited call-sites
