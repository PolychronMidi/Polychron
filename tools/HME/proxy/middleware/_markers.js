'use strict';
/**
 * Central registry of cross-component marker strings.
 *
 * Pattern A (from the persistent-thread architectural review): the same
 * fragility shows up across multiple files -- a producer emits a string,
 * a consumer parses it with assumed grammar, and there's no schema or
 * test pinning the two together. Examples surfaced during the review:
 *
 *   - synthesis_reasoning emits `[[HME_AGENT_TASK req_id=<hex>...]]`,
 *     13_agent_jobs.js parses `HME reasoning for ([a-f0-9]{12,})` --
 *     two files, no shared constant, recently broken once already.
 *
 *   - context_budget.js regex-matches `[HME dir:`, `[HME:edit]`,
 *     `[HME:read]`, `[err]`, `[HME neighborhood` -- each marker owned by
 *     a different sibling middleware, none cross-referenced.
 *
 *   - posttooluse_hme_review.sh greps `<!-- HME_REVIEW_VERDICT: ... -->`
 *     emitted from onboarding_chain.emit_review_verdict_marker -- a wording
 *     drift on either side silently breaks the parse.
 *
 * Centralizing these here gives every consumer + producer a single source
 * of truth. New markers added here MUST be referenced by at least one
 * producer and one consumer (enforced by the marker-coherence verifier
 * in tools/HME/scripts/audit-* or by manual review until that lints).
 *
 * Each marker entry documents its producer file, consumer files, and
 * the regex form. Bash/Python consumers can mirror these constants by
 * including the regex strings as comments referencing this file.
 */

const MARKERS = {
  // Agent-job dispatch sentinel -- synthesis_reasoning.py emits, the agent
  HME_AGENT_TASK: {
    producer: 'tools/HME/service/server/tools_analysis/synthesis/synthesis_reasoning.py',
    consumers: [
<<<<<<< Updated upstream
      'tools/HME/proxy/middleware/13_agent_jobs.js',
=======
      'tools/HME/proxy/middleware/13_subagent_bridge.js',
>>>>>>> Stashed changes
      'tools/HME/service/server/tools_analysis/synthesis/synthesis_overdrive.py',
    ],
    sentinel: '[[HME_AGENT_TASK req_id=<hex12+> prompt_file=tmp/hme-subagent-queue/<reqId>.json subagent_type=<type>...]]',
    reqIdRegex: /HME reasoning for ([a-f0-9]{12,})\b/,
  },

  // Review verdict -- onboarding_chain.emit_review_verdict_marker writes
  HME_REVIEW_VERDICT: {
    producer: 'tools/HME/service/server/onboarding_chain.py',
    consumers: ['tools/HME/hooks/posttooluse/posttooluse_hme_review.sh'],
    pattern: /<!-- HME_REVIEW_VERDICT: (clean|warnings|error) -->/,
  },

  // Footer markers added by enrichment middleware. context_budget.js
  HME_DIR: {
    producer: 'tools/HME/proxy/middleware/11_dir_context.js',
    consumers: ['tools/HME/proxy/middleware/17_context_budget.js'],
    sentinel: '[HME dir:',
  },
  HME_READ: {
    producer: 'tools/HME/proxy/middleware/09_read_context.js',
    consumers: ['tools/HME/proxy/middleware/17_context_budget.js'],
    sentinel: '[HME:read]',
  },
  HME_EDIT: {
    producer: 'tools/HME/proxy/middleware/07_edit_context.js',
    consumers: ['tools/HME/proxy/middleware/17_context_budget.js'],
    sentinel: '[HME:edit]',
  },
  HME_NEIGHBORHOOD: {
    producer: 'tools/HME/proxy/middleware/10_grep_glob_neighborhood.js',
    consumers: ['tools/HME/proxy/middleware/17_context_budget.js'],
    sentinel: '[HME neighborhood',
  },
  HME_BG_DOMINANCE: {
    producer: 'tools/HME/proxy/middleware/12_background_dominance.js',
    consumers: [],
    sentinel: '[hme bg-dominance]',
  },
  ERR_FOOTER: {
    producer: 'tools/HME/proxy/middleware/14_bash_enrichment.js',
    consumers: ['tools/HME/proxy/middleware/17_context_budget.js'],
    sentinel: '[err]',
  },

  // Auto-brief from PreToolUse Edit/Write hook
  HME_AUTO_BRIEF: {
    producer: 'tools/HME/hooks/pretooluse/pretooluse_{edit,write}.sh',
    consumers: ['(read by agent next-turn additionalContext)'],
    sentinel: '[hme auto-brief: <module>]',
  },

  // Scaffolding-warning prefixes -- the "detect scaffolding-only warnings
  HME_SCAFFOLD_HOOK_CHANGE: {
    producer: 'tools/HME/service/server/tools_analysis/review_unified.py',
    consumers: [
      'tools/HME/hooks/posttooluse/posttooluse_hme_review.sh',
      'tools/HME/service/server/tools_analysis/workflow_audit.py',
    ],
    sentinel: 'HOOK CHANGE',
  },
  HME_SCAFFOLD_DOC_CHECK: {
    producer: 'tools/HME/service/server/tools_analysis/review_unified.py',
    consumers: [
      'tools/HME/hooks/posttooluse/posttooluse_hme_review.sh',
      'tools/HME/service/server/tools_analysis/workflow_audit.py',
    ],
    sentinel: 'DOC CHECK',
  },
  HME_SCAFFOLD_SKIPPED: {
    producer: 'tools/HME/service/server/tools_analysis/review_unified.py',
    consumers: [
      'tools/HME/hooks/posttooluse/posttooluse_hme_review.sh',
      'tools/HME/service/server/tools_analysis/workflow_audit.py',
    ],
    sentinel: 'SKIPPED',
  },

  // Detector verdict names -- produced by run_all.py's per-detector
  DETECTOR_VERDICTS: {
    producer: 'tools/HME/scripts/detectors/run_all.py',
    consumers: ['tools/HME/hooks/lifecycle/stop/detectors.sh'],
    sentinel: 'psycho_stop',
  },

  // Self-origin error tags -- added per peer-review iter 130's
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
    producer: 'tools/HME/proxy/supervisor/children.js',
    consumers: ['tools/HME/hooks/lifecycle/stop/lifesaver.sh'],
    sentinel: 'llamacpp_daemon',
  },
};

module.exports = { MARKERS };
