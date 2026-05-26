'use strict';

const { parentTaskDebt } = require('../../parent_task_guard');
const { REASONS } = require('../context');
const { unfinishedTaskDebt } = require('../task_debt');
const { assistantToolNamesSinceLastUserPrompt } = require('../transcript');

function scanNextActionDebt(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const re = /\bnext\s+(action|step)\s+(is|would\s+be|will\s+be|should\s+be|remains?|needed|to\s+do)\b[^.!?\n]{0,160}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (s) out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}

function scanWorkDebtAdmission(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const safeNegation = /\b(no|zero|nothing)\s+(remaining|remains|left|pending|open|outstanding|unfinished|incomplete)\b/i;
  const re = /\b(not\s+(complete|done|finished|closed)|does(?:n['’]?t|\s+not)\s+complete|not\s+fully\s+(complete|closed|done)|remaining\s+(work|gap|gaps|item|items|issue|issues|todo|todos|finding|findings|violation|violations|offender|offenders)|still\s+(needs?|pending|open|outstanding|unfinished|incomplete)|pending\s+(work|item|items|todo|todos|fix|fixes)|follow-?up\s+(needed|required|remains?)|limitation\s*:|not\s+completed\s+from|before\s+.*diversion|resume\s+exactly\s+there|(?:i['’]?m|i\s+am|i\s+will|i['’]?ll|we\s+will)\s+(fixing|going\s+to|running|patching|continuing|executing|doing|checking|verifying)|(?:fixing|patching|running|continuing|executing|doing|checking|verifying)\s+(now|next|that|this|the))\b[^.!?\n]{0,180}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (!s || safeNegation.test(s)) continue;
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

function denyHits(state, reasonKey, intro, hits) {
  const enumerated = hits.map((x, i) => `  ${i + 1}. "${x}"`).join('\n');
  return state.deny(reasonKey, `${intro}\n\n${enumerated}`);
}

const unfinishedTaskDebtCheck = {
  name: 'unfinished-task-debt',
  evaluate(state) {
    const debt = unfinishedTaskDebt(state.transcriptPath);
    return debt ? state.deny('UNFINISHED_TASKS', debt) : null;
  },
};

const nextActionDebtCheck = {
  name: 'next-action-debt',
  evaluate(state) {
    const hits = scanNextActionDebt(state.lastAssistantText);
    return hits.length ? denyHits(state, 'NEXT_ACTION_DEBT', REASONS.NEXT_ACTION_DEBT, hits) : null;
  },
};

const workDebtAdmissionCheck = {
  name: 'work-debt-admission',
  evaluate(state) {
    const hits = scanWorkDebtAdmission(state.lastAssistantText);
    return hits.length ? denyHits(state, 'WORK_DEBT_ADMISSION', REASONS.WORK_DEBT_ADMISSION, hits) : null;
  },
};

const parentTaskDebtCheck = {
  name: 'parent-task-debt',
  evaluate(state) {
    const debt = parentTaskDebt(state.transcriptPath);
    return debt ? state.deny('CORRECTION_PIVOT_PARENT_TASK', debt) : null;
  },
};

const todoChurnDebtCheck = {
  name: 'todo-churn-debt',
  evaluate(state) {
    const names = assistantToolNamesSinceLastUserPrompt(state.transcriptPath);
    if (names.length < 2) return null;
    if (!names.every((name) => name === 'TodoWrite')) return null;
    return state.deny('WORK_DEBT_ADMISSION', `${REASONS.WORK_DEBT_ADMISSION}\n\nOpen task evidence:\n  1. TodoWrite-only turn: task-list updates are not work evidence.`);
  },
};

module.exports = {
  nextActionDebtCheck,
  parentTaskDebtCheck,
  scanNextActionDebt,
  scanWorkDebtAdmission,
  todoChurnDebtCheck,
  unfinishedTaskDebtCheck,
  workDebtAdmissionCheck,
};
