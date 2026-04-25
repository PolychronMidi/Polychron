'use strict';
/**
 * Central registry of cross-component marker strings.
 *
 * Pattern A (from the persistent-thread architectural review): the same
 * fragility shows up across multiple files — a producer emits a string,
 * a consumer parses it with assumed grammar, and there's no schema or
 * test pinning the two together. Examples surfaced during the review:
 *
 *   - synthesis_reasoning emits `[[HME_AGENT_TASK req_id=<hex>...]]`,
 *     subagent_bridge.js parses `HME reasoning for ([a-f0-9]{12,})` —
 *     two files, no shared constant, recently broken once already.
 *
 *   - context_budget.js regex-matches `[HME dir:`, `[HME:edit]`,
 *     `[HME:read]`, `[err]`, `[HME neighborhood` — each marker owned by
 *     a different sibling middleware, none cross-referenced.
 *
 *   - posttooluse_hme_review.sh greps `<!-- HME_REVIEW_VERDICT: ... -->`
 *     emitted from onboarding_chain.emit_review_verdict_marker — a wording
 *     drift on either side silently breaks the parse.
 *
 * Centralizing these here gives every consumer + producer a single source
 * of truth. New markers added here MUST be referenced by at least one
 * producer and one consumer (enforced by the marker-coherence verifier
 * in scripts/audit-* or by manual review until that lints).
 *
 * Each marker entry documents its producer file, consumer files, and
 * the regex form. Bash/Python consumers can mirror these constants by
 * including the regex strings as comments referencing this file.
 */

const MARKERS = {
  // Subagent dispatch sentinel — synthesis_reasoning.py emits, the agent
  // (or i/thread send) executes, subagent_bridge.js captures the result
  // when Agent path is used.
  HME_AGENT_TASK: {
    producer: 'tools/HME/mcp/server/tools_analysis/synthesis/synthesis_reasoning.py',
    consumers: [
      'tools/HME/proxy/middleware/subagent_bridge.js',
      'i/thread (i/thread send <prompt-file>)',
    ],
    sentinel: '[[HME_AGENT_TASK req_id=<hex12+> prompt_file=tmp/hme-subagent-queue/<reqId>.json subagent_type=<type>...]]',
    reqIdRegex: /HME reasoning for ([a-f0-9]{12,})\b/,
  },

  // Review verdict — onboarding_chain.emit_review_verdict_marker writes
  // an HTML-style comment that posttooluse_hme_review.sh greps to clear
  // EDIT-NEXUS state. Drift in either side hangs the stop chain.
  HME_REVIEW_VERDICT: {
    producer: 'tools/HME/mcp/server/onboarding_chain.py',
    consumers: ['tools/HME/hooks/posttooluse/posttooluse_hme_review.sh'],
    pattern: /<!-- HME_REVIEW_VERDICT: (clean|warnings|error) -->/,
  },

  // Footer markers added by enrichment middleware. context_budget.js
  // tracks which fired by regex-matching these in tool result content.
  // Full repo-relative paths are required so audit-marker-registry.py
  // can grep-check the sentinel literal against each producer source.
  HME_DIR: {
    producer: 'tools/HME/proxy/middleware/dir_context.js',
    consumers: ['tools/HME/proxy/middleware/context_budget.js'],
    sentinel: '[HME dir:',
  },
  HME_READ: {
    producer: 'tools/HME/proxy/middleware/read_context.js',
    consumers: ['tools/HME/proxy/middleware/context_budget.js'],
    sentinel: '[HME:read]',
  },
  HME_EDIT: {
    producer: 'tools/HME/proxy/middleware/edit_context.js',
    consumers: ['tools/HME/proxy/middleware/context_budget.js'],
    sentinel: '[HME:edit]',
  },
  HME_NEIGHBORHOOD: {
    producer: 'tools/HME/proxy/middleware/grep_glob_neighborhood.js',
    consumers: ['tools/HME/proxy/middleware/context_budget.js'],
    sentinel: '[HME neighborhood',
  },
  HME_BG_DOMINANCE: {
    producer: 'tools/HME/proxy/middleware/background_dominance.js',
    consumers: [],
    sentinel: '[hme bg-dominance]',
  },
  ERR_FOOTER: {
    producer: 'tools/HME/proxy/middleware/bash_enrichment.js',
    consumers: ['tools/HME/proxy/middleware/context_budget.js'],
    sentinel: '[err]',
  },

  // Auto-brief from PreToolUse Edit/Write hook
  HME_AUTO_BRIEF: {
    producer: 'tools/HME/hooks/pretooluse/pretooluse_{edit,write}.sh',
    consumers: ['(read by agent next-turn additionalContext)'],
    sentinel: '[hme auto-brief: <module>]',
  },

  // Scaffolding-warning prefixes — the "detect scaffolding-only warnings
  // and treat verdict as clean" convention. Three sites use the same
  // alternation `(HOOK CHANGE|DOC CHECK|SKIPPED|KB):`. Iter 120 peer-
  // review noted that a single-needle registry entry would miss a drop
  // (e.g. one site removes SKIPPED but the registry only checks for it).
  // Per-term entries force the verifier to confirm ALL FOUR alternation
  // members survive in ALL THREE sites — drop one anywhere, verifier
  // breaks.
  HME_SCAFFOLD_HOOK_CHANGE: {
    producer: 'tools/HME/mcp/server/tools_analysis/review_unified.py',
    consumers: [
      'tools/HME/hooks/posttooluse/posttooluse_hme_review.sh',
      'tools/HME/mcp/server/tools_analysis/workflow_audit.py',
    ],
    sentinel: 'HOOK CHANGE',
  },
  HME_SCAFFOLD_DOC_CHECK: {
    producer: 'tools/HME/mcp/server/tools_analysis/review_unified.py',
    consumers: [
      'tools/HME/hooks/posttooluse/posttooluse_hme_review.sh',
      'tools/HME/mcp/server/tools_analysis/workflow_audit.py',
    ],
    sentinel: 'DOC CHECK',
  },
  HME_SCAFFOLD_SKIPPED: {
    producer: 'tools/HME/mcp/server/tools_analysis/review_unified.py',
    consumers: [
      'tools/HME/hooks/posttooluse/posttooluse_hme_review.sh',
      'tools/HME/mcp/server/tools_analysis/workflow_audit.py',
    ],
    sentinel: 'SKIPPED',
  },

  // Detector verdict names — produced by run_all.py's per-detector
  // printout, consumed by detectors.sh's case statement. Rename of
  // any one side silently defaults downstream gates to "ok". Needle
  // `psycho_stop=` uniquely identifies the verdict-print format.
  DETECTOR_VERDICTS: {
    producer: 'tools/HME/scripts/detectors/run_all.py',
    consumers: ['tools/HME/hooks/lifecycle/stop/detectors.sh'],
    sentinel: 'psycho_stop',
  },

  // Self-origin error tags — added per peer-review iter 130's
  // observation that hme-errors.log mixes worker/daemon/supervisor
  // failures with agent failures. lifesaver.sh now classifies by
  // these tags to demote self-origin entries to reveal-register
  // (no block). If a writer changes its tag without updating the
  // classifier, the agent gets demand-register blocks for self-
  // health issues again. Verifier checks each tag appears in BOTH
  // its emitter and the lifesaver classifier.
  HME_SELFORIGIN_PULSE: {
    producer: 'tools/HME/activity/universal_pulse.py',
    consumers: ['tools/HME/hooks/lifecycle/stop/lifesaver.sh'],
    sentinel: '[universal_pulse]',
  },
  HME_SELFORIGIN_SUPERVISOR: {
    producer: 'tools/HME/proxy/supervisor/index.js',
    consumers: ['tools/HME/hooks/lifecycle/stop/lifesaver.sh'],
    sentinel: '[supervisor]',
  },
  HME_SELFORIGIN_LLAMACPP: {
    producer: 'tools/HME/proxy/supervisor/index.js',
    consumers: ['tools/HME/hooks/lifecycle/stop/lifesaver.sh'],
    sentinel: 'llamacpp_daemon',
  },
};

module.exports = { MARKERS };
