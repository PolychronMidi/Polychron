'use strict';
/**
 * Write-time guard for the doc invariant. Fires the instant an agent tries to
 * subvert the limited-.md-files rule by smuggling work-tracking or machine-
 * parsed data into doc/ (the way doc/myth0s-coverage-map.md / pilot-report.md
 * once rode the blanket doc/ grandfather clause). Mirrors the signals the
 * markdown-invariant verifier enforces, but at PreToolUse so the subversion is
 * blocked before the file ever lands.
 *
 * Denies:
 *   - a NEW top-level doc/*.md that is not one of the four canonical specs
 *     (doc/ top level is reserved for them; prose essays go in doc/theory/,
 *     templates in doc/templates/);
 *   - any doc/**.md (except the canonical doc/templates/ tracker tree) whose
 *     content carries TODO-tracking grammar or a status-tracking table -- that
 *     is data/tracking, not a doc.
 */

const CANONICAL_TOP_LEVEL = new Set([
  'composition.md',
  'composition-full.md',
  'self-coherence.md',
  'self-coherence-full.md',
]);
const TEMPLATE_PREFIX = 'doc/templates/';
const TODO_CODE_RE = /^\s*#\d+\s+(?:0|1|2|3|4f|4|5)_(?:\d+)?(?:\s|$)/m;
const STATUS_ROW_RE = /^\s*\|.*\|\s*(?:reviewed|pending|partial|done|blocked|wip|todo|in[ -]progress)\s*\|\s*$/gim;

function _docRel(fp) {
  const s = String(fp || '').replace(/\\/g, '/');
  if (!s.endsWith('.md')) return null;
  const m = /(?:^|\/)(doc\/[^\0]*\.md)$/.exec(s);
  return m ? m[1] : null;
}

function _content(ti) {
  if (typeof ti.content === 'string') return ti.content;
  if (typeof ti.new_string === 'string') return ti.new_string;
  if (Array.isArray(ti.edits)) return ti.edits.map((e) => (e && e.new_string) || '').join('\n');
  return '';
}

module.exports = {
  name: 'block-doc-spillover',
  description: 'Block doc/ writes that smuggle TODO-tracking or machine-data tables into a doc (limited-.md-files invariant, write-time).',
  category: 'consistency',
  defaultEnabled: true,
  decisionClass: 'block',
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    const rel = _docRel(ti.file_path || ti.path || '');
    if (!rel) return ctx.allow();

    const isTopLevel = /^doc\/[^/]+\.md$/.test(rel);
    if (isTopLevel && !CANONICAL_TOP_LEVEL.has(rel.slice('doc/'.length))) {
      return ctx.deny(
        `BLOCKED: ${rel} -- doc/ top level is reserved for the four canonical specs `
        + `(composition[-full], self-coherence[-full]). A new top-level doc/*.md is how `
        + `tracking/data spillover dodges the limited-.md-files invariant. Prose essay -> `
        + `doc/theory/; work-tracking -> doc/templates/TODO.md; machine-readable data -> a `
        + `.json/.py beside its consumer (not a doc).`
      );
    }

    if (rel.startsWith(TEMPLATE_PREFIX)) return ctx.allow();
    const content = _content(ti);
    if (TODO_CODE_RE.test(content)) {
      return ctx.deny(
        `BLOCKED: ${rel} carries TODO-tracking grammar (#<n> <code>_ ...). Tracking belongs `
        + `in doc/templates/TODO.md, not a doc. Move it there or drop the status codes.`
      );
    }
    const statusRows = (content.match(STATUS_ROW_RE) || []).length;
    if (statusRows >= 2) {
      return ctx.deny(
        `BLOCKED: ${rel} carries a ${statusRows}-row status-tracking table (reviewed/pending/...). `
        + `Machine-readable status is DATA -- put it in a .json/.py beside its consumer, not a doc.`
      );
    }
    return ctx.allow();
  },
};
