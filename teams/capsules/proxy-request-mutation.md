# Context Capsule: review the proxy request mutation path

## artifact
tools/HME/proxy/hme_proxy_request_mutation.js -- mutateClaudeRequest, the single
outbound-request transform for Anthropic traffic. It applies a dynamic output-token
cap (_dynamicOutputCap/applyExplicitOtpmCap), large-payload compaction
(compactLargeInteractiveAnthropicPayload), strip/inject transforms, the middleware
pipeline, and a FINAL GUARANTEE sanitize on every Anthropic path. It tracks a
bodyDirtied flag to decide whether to rebuild the outgoing buffer.

## goal
Find decision-changing correctness/safety flaws in the ORCHESTRATION here (not the
imported helpers): a mutation that dirties the payload but is NOT re-serialized into
outBody (stale wire body), an output cap that can compute wrong/negative, a
compaction/cap interaction that drops the buffer rebuild, or the FINAL GUARANTEE
being skippable. Cite the function + line.

## constraints
outBody must reflect payload whenever any transform mutated it -- a missed rebuild
sends the UN-mutated body upstream (e.g. an un-sanitized payload). The FINAL
GUARANTEE sanitize runs on EVERY Anthropic path including passthrough. Helper
functions (stripBoilerplate, injectHmeTools, middleware.runPipeline, sanitizePayload,
etc.) are imported and assumed correct -- review only how this file sequences and
rebuilds around them. Review only the evidence below unless you verify with tools.

## rubric
Classify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact
failure, contradictory evidence (which existing rebuild/guard already covers it, or
"none found after checking"), and a one-line fix. Reject style notes. Prefer
missed-buffer-rebuild, cap math, and FINAL-GUARANTEE-bypass bugs.

## coverage
included: full hme_proxy_request_mutation.js source below -- _positiveNumber,
_loadOutputRegistry, _modelOutputInfo, _estimatedInputTokens, _dynamicOutputCap,
_anthropicTransportMaxBytes, compactLargeInteractiveAnthropicPayload,
applyExplicitOtpmCap, and mutateClaudeRequest (including the bodyDirtiedByStrip
tracking and the FINAL GUARANTEE block).
excluded: the imported transform/inject/middleware helpers' internals and the proxy
dispatch that calls mutateClaudeRequest (assumed correct here).

## evidence
Live source (read fresh at dispatch -- never a stale copy):
- tools/HME/proxy/hme_proxy_request_mutation.js

