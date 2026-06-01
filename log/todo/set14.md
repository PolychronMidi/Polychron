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

### Todo - Set 14

#1 5_ regenerate repo mermaid and verify repo-mermaid-freshness — done: regenerated/checked README repo mermaid; generator reported already current and verifier now PASS as part of HCI 99.3 run

#2 5_ rebaseline env-tamper only after treating current .env as intentional under explicit user authorization — done: rebaselined .env.sha256 to current authorized .env hash 1984600ff13596f65; env-tamper now PASS in HCI run

#3 5_ fix bg.sh oversized payload / setsid Argument list too long failures for pipeline bg scripts — done: fixed bg.sh oversized prompt handling by stdin temp-file runner and rewired satisfaction/tier classifier to read stdin; 200k payload smoke completed without setsid E2BIG

#4 5_ profile and trim UserPromptSubmit hook latency without weakening synchronous safety checks — done: profiled recent hook latency; UserPromptSubmit p95 is now below budget (~190ms recent vs 700ms) with safety checks still synchronous

#5 5_ perform scoped silent-failure cleanup for load-bearing paths only; no generic fallback annotations — done: completed scoped load-bearing silent-failure cleanup around bg telemetry/lifesaver self-tags; silent-failure-class count improved 253 -> 248 without generic fallback annotations

#6 5_ run proxy availability smoke for active-active constant-availability invariant — done: ran proxy availability smoke: proxy_liveness_gate --check-only rc=0; shuffler 9099 and slots 9100/9101 healthy; proxy_liveness_gate + slot_admission tests 18/18 PASS
