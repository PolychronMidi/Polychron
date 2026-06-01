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

#1 1_ regenerate repo mermaid and verify repo-mermaid-freshness

#2 1_ rebaseline env-tamper only after treating current .env as intentional under explicit user authorization

#3 1_ fix bg.sh oversized payload / setsid Argument list too long failures for pipeline bg scripts

#4 1_ profile and trim UserPromptSubmit hook latency without weakening synchronous safety checks

#5 1_ perform scoped silent-failure cleanup for load-bearing paths only; no generic fallback annotations

#6 1_ run proxy availability smoke for active-active constant-availability invariant
