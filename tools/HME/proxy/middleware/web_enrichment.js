'use strict';
/**
 * Web tool envelopment — emits activity events for WebFetch / WebSearch so
 * they're visible to the coherence tracker and session telemetry. No footer
 * enrichment: external URLs/queries rarely intersect internal KB, and
 * padding every web result with silence would be noise. Extension point:
 * when a URL/query matches a known module name or concept in KB, future
 * work can append a cross-reference hint here.
 */

module.exports = {
  name: 'web_enrichment',

  onToolResult({ toolUse, ctx }) {
    const name = toolUse.name || '';
    if (name !== 'WebFetch' && name !== 'WebSearch') return;
    const input = toolUse.input || {};
    const target = String(input.url || input.query || '').slice(0, 120);
    ctx.emit({ event: 'web_tool_call', tool: name, target });
  },
};
