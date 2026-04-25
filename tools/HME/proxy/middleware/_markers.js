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
  HME_DIR: { producer: 'dir_context.js', sentinel: '[HME dir:' },
  HME_READ: { producer: 'read_context.js', sentinel: '[HME:read]' },
  HME_EDIT: { producer: 'edit_context.js', sentinel: '[HME:edit]' },
  HME_NEIGHBORHOOD: { producer: 'grep_glob_neighborhood.js', sentinel: '[HME neighborhood' },
  HME_BG_DOMINANCE: { producer: 'background_dominance.js', sentinel: '[hme bg-dominance]' },
  ERR_FOOTER: { producer: 'bash_enrichment.js', sentinel: '[err]' },

  // Auto-brief from PreToolUse Edit/Write hook
  HME_AUTO_BRIEF: {
    producer: 'tools/HME/hooks/pretooluse/pretooluse_{edit,write}.sh',
    consumers: ['(read by agent next-turn additionalContext)'],
    sentinel: '[hme auto-brief: <module>]',
  },
};

module.exports = { MARKERS };
