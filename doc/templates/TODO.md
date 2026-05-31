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

#1 5_ HME design-pattern optimization survey: 4 parallel subsystem agents (proxy / event_kernel+hooks / verifiers+detectors / tools_analysis) finding duplication+inconsistent-abstraction to unify; DONE — all 4 returned, findings synthesized into the items below

#2 4_ proxy: unify content-block text extraction — canonical `blockText(block,{toolResults})` + `contentText(content)` added to request_shape.js; conversation_graph.blockText now delegates (tool-result-inclusive preserved), request_mutation `_lastUserPromptText`/`_lastUserTextBlocks` collapsed to shared `messageText` + one `_lastUserMessageRaw`; 16/16 shortcuts + 5/5 facade green, behavior asserted [E2]

#13 5_ migrated every text-rewalk copy onto the shared request_shape helper: hme_proxy_core._extractTextContent, messages._textOf + inline stripBoilerplate walk, file_unchanged_swap._textOf, middleware index._toolResultText, tool_result_semantics.textOfToolResult, 29_edit_failure_context.textOf, and 04a/06/10/12/13/14/17/19/27 `_textOf`/`_resultText` all delegate to blockText/contentText (added toolResultJoiner for the two '\n'-joining scanners); behavior-preserving (reads .content even when toolResult lacks type, the bare-object test shape); secret_sanitizer 19/19 + extracted-modules 68/68 + tool-result suites green

#3 5_ rewriters: structured-JSON bypass hoisted to shared `structured_output_guard.js`; guards `sse_slop_rewriter`, `sse_ascii_strip_rewriter`, and the shared `sse_stop_hook_rewriters/text_block_buffer.js` used by stop-hook response-text rewriters. Added regression that structured JSON bypasses text-block strategy mutation byte-identically. Verified response rewriter suite 57/57 green [E2]

#4 5_ hooks: ONE source of truth for self-origin `_SELF_TAG_RE` — extracted shared `hooks/helpers/_self_tags.sh` and sourced it from both `hooks/lifecycle/stop/lifesaver.sh` and `hooks/helpers/_check_errors_inline.sh`; removed duplicated shell regex drift (incl `worker_client`/`HCI trajectory`/`hook-output-validation` mismatch). Verified no shell `_SELF_TAG_RE='...'` copies remain outside the shared file, lifesaver_canary 9/9 + hook lifecycle 24/24 green [E2]

#5 5_ env-fallback pattern sweep: central checker `tools/HME/scripts/check-env-failfast.py` run against declared env keys; current result `env fail-fast ok: central references clean; root .env complete; 0 inline fallbacks`. Prior converted sites (`proxy_liveness_gate.js`, `self_reexec.js`, `file_watcher_watch_set.test.js`) stayed clean; no remaining declared-key `process.env.* ||` / `os.environ.get(..., default)` fallbacks found [E2]

#6 0_ re-run the design-pattern survey after the top optimizations land, to confirm no new duplication was introduced and the unifications actually removed the cited call-sites

#7 0_ get HCI score to 100

#8 5_ LIFESAVER guard built (per user demand): deleting any unfinished (non-5_) todo from doc/templates/TODO.md now raises a [todo-guard] LIFESAVER — tools/HME/scripts/todo_guard.py (10/10 tests incl id-reuse-across-sets), wired into posttooluse_edit.sh + posttooluse_write.sh

#9 5_ self-origin tag triplication patched (survey finding, partial): hook-output-validation added to all 3 lists (_check_errors_inline.sh, lifesaver.sh, 22_lifesaver_inject.js) so kernel-sanitized validation no longer surfaces as a blocking agent error — #4 tracks the full single-source unification

#10 0_ event_kernel: host-adapter stdout validation divergent across claude/codex/opencode (only Claude hardened) → move per-host check into decision_normalizer host-policy table; extractFirstJsonDocument reimplemented 3x → import shared [E3]

#11 0_ verifiers/detectors: detector name dual-sourced (registry.json + 7 hardcoded _emit_stats); 18 detectors share argv+load+emit boilerplate → @detector(name) base derives name once [E3]

#12 0_ tools_analysis: string-dispatch if/action chains in ~8 "unified" tools (search/learn/trace/read/evolution_admin) → shared dispatch(key, table) like status_unified _STATUS_MODES; fold manual _track(name) (37 sites) into @chained which already knows the name [E3]
