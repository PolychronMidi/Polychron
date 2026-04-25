'use strict';
/**
 * Pure-JS port of nexus_pending.sh — late lifecycle audit.
 * Reads tmp/hme-nexus.state markers and tmp/hme-onboarding.state, emits a
 * `deny` if the run has unresolved REVIEW issues, an uncommitted PIPELINE
 * verdict, a COMMIT_FAILED marker, or the onboarding "verified-but-no-learn"
 * state. EDIT-count is handled by the early gate (nexus_edit_check) — this
 * stage covers everything else `_nexus_pending` checked.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../../shared');

const NEXUS_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-nexus.state');
const ONBOARDING_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-onboarding.state');

function readNexusState() {
  try { return fs.readFileSync(NEXUS_FILE, 'utf8'); }
  catch (_e) { return ''; }
}

function nexusGet(type) {
  const lines = readNexusState().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith(`${type}:`)) {
      const parts = line.split(':');
      return parts.slice(2).join(':');
    }
  }
  return '';
}

function nexusHas(type) {
  return readNexusState().split('\n').some((l) => l.startsWith(`${type}:`));
}

function nexusCount(type) {
  return readNexusState().split('\n').filter((l) => l.startsWith(`${type}:`)).length;
}

module.exports = {
  name: 'nexus_pending',
  async run(ctx) {
    const issues = [];

    // EDIT count — the early gate already blocks if >0, but if that gate
    // was disabled or bypassed (defense-in-depth), still report here.
    const editCount = nexusCount('EDIT');
    if (editCount > 0) {
      issues.push(`  - ${editCount} edited file(s) not yet reviewed: run review(mode='forget')`);
    }

    const reviewIssuesRaw = nexusGet('REVIEW_ISSUES');
    const reviewIssues = parseInt(reviewIssuesRaw, 10);
    if (Number.isFinite(reviewIssues) && reviewIssues > 3) {
      issues.push(`  - ${reviewIssues} unresolved review issue(s) — fix then re-run review(mode='forget') until count drops to 0`);
    }

    const verdict = nexusGet('PIPELINE');
    if (verdict === 'STABLE' || verdict === 'EVOLVED') {
      if (!nexusHas('COMMIT')) {
        issues.push(`  - Pipeline passed (${verdict}) but changes not committed`);
      }
    }
    if (verdict === 'FAILED' || verdict === 'DRIFTED') {
      issues.push(`  - Pipeline ${verdict} — needs diagnosis before stopping`);
    }

    const commitFail = nexusGet('COMMIT_FAILED');
    if (commitFail) {
      issues.push(`  - COMMIT FAILED: ${commitFail} — run 'git status' and commit manually`);
    }

    if (fs.existsSync(ONBOARDING_FILE)) {
      let onbState = '';
      try { onbState = fs.readFileSync(ONBOARDING_FILE, 'utf8').trim(); }
      catch (_e) { /* ignore */ }
      if (onbState === 'verified') {
        issues.push(`  - Onboarding step 8/8: pipeline STABLE but learn() not called — run learn(title='round summary', content='...') to graduate`);
      }
    }

    if (issues.length === 0) return ctx.allow();
    return ctx.deny(`NEXUS — incomplete lifecycle steps:\n${issues.join('\n')}\n\nFinish these before stopping.`);
  },
};
