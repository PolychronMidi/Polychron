'use strict';
/**
 * Example custom policy. Drop this file (or a directory containing files
 * like it) and point `.hme/policies.json` at it via `customPoliciesPath`:
 *
 *   {
 *     "customPoliciesPath": "tools/HME/policies/examples"
 *   }
 *
 * Then `i/policies list` shows the policy, `i/policies disable
 * warn-large-bash-output` toggles it, and the proxy / stop_chain enforce
 * it on matching events.
 *
 * This particular policy is illustrative, not load-bearing — it warns
 * when a Bash tool returned >50KB of output, on the theory that giant
 * bash outputs often signal "you should have used grep / head / tail
 * to reduce noise before showing this to the agent." Tweak the threshold
 * via `i/policies show warn-large-bash-output`'s param settings.
 */

module.exports = {
  name: 'warn-large-bash-output',
  description: 'Instruct the agent when a Bash tool_response exceeds the configured size threshold.',
  category: 'noise-reduction',
  defaultEnabled: false, // opt-in: disabled by default
  match: {
    events: ['PostToolUse'],
    tools: ['Bash'],
  },
  params: {
    thresholdBytes: 50_000,
  },
  async fn(ctx) {
    const response = ctx.payload && ctx.payload.tool_response;
    if (!response) return ctx.allow();
    const text = typeof response === 'string' ? response : JSON.stringify(response);
    const threshold = (ctx.params && ctx.params.thresholdBytes) || 50_000;
    if (text.length <= threshold) return ctx.allow();
    return ctx.instruct(
      `Bash tool returned ${text.length}B (threshold: ${threshold}B). ` +
      `Consider piping through grep/head/awk before re-running to reduce ` +
      `context cost on similar future calls.`
    );
  },
};
