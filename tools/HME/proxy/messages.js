'use strict';
// Message processing: boilerplate strip, semantic-redundancy strip, scan.

const { emit } = require('./shared');
const { isJurisdictionFile } = require('./context');
const { normalizeICommandsInValue } = require('./i_command_text');

const WRITE_INTENT_TOOLS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
]);

// Boilerplate stub stripper
const BOILERPLATE_PATTERNS = [
  {
    name: 'bash_no_output',
    re: /^\(Bash completed with no output\)\s*$/,
    strip_whole_block: true,
  },
  {
    name: 'edit_success_stub',
    re: /^The file \/\S+ has been updated successfully\. \(file state is current in your context[^)]*\)\s*$/,
    strip_whole_block: true,
  },
  {
    name: 'stop_hook_ok',
    // `ok` and `No stderr output` are nothingburgers; `fail=N` carries real signal.
    re: /^Stop hook feedback:\s*\n\[bash [^\]]*stop\.sh\]:\s*(ok|No stderr output)\s*$/,
    strip_whole_block: true,
  },
  {
    name: 'todowrite_nag',
    re: /<system-reminder>\s*The TodoWrite tool hasn't been used recently[\s\S]*?<\/system-reminder>/,
    strip_whole_block: false,
  },
];

function _isBoilerplateText(text) {
  for (const p of BOILERPLATE_PATTERNS) {
    if (p.strip_whole_block && p.re.test(text || '')) return { match: true, pattern: p };
  }
  return { match: false };
}

// Only scan the last RECENT_MSG_WINDOW messages for mutable strip operations.
const RECENT_MSG_WINDOW = 8;


function normalizeICommands(payload) {
  const stats = { command_rewrites: 0, text_rewrites: 0 };
  const normalized = normalizeICommandsInValue(payload, stats);
  if (normalized && normalized !== payload) {
    for (const key of Object.keys(payload)) delete payload[key];
    Object.assign(payload, normalized);
  }
  return stats.command_rewrites + stats.text_rewrites;
}

const _EMPTY_USER_PLACEHOLDER = '(content stripped by hme-proxy boilerplate filter)';

function _ensureUserMessageNonEmpty(msg) {
  if (!msg || msg.role !== 'user') return;
  const c = msg.content;
  if (typeof c === 'string') {
    if (c.trim() === '') msg.content = _EMPTY_USER_PLACEHOLDER;
    return;
  }
  if (!Array.isArray(c)) return;
  const hasSignal = c.some((b) => {
    if (!b || typeof b !== 'object') return false;
    if (b.type === 'tool_result' || b.type === 'tool_use' || b.type === 'image' || b.type === 'document') return true;
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') return true;
    return false;
  });
  if (!hasSignal) msg.content = [{ type: 'text', text: _EMPTY_USER_PLACEHOLDER }];
}

function _ensureAllUserMessagesNonEmpty(payload) {
  if (!payload || !Array.isArray(payload.messages)) return;
  for (const m of payload.messages) _ensureUserMessageNonEmpty(m);
}

function stripBoilerplate(payload) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  let strippedCount = 0;
  const stripped_samples = {};
  // Only strip recent messages -- mutating older ones busts the Anthropic cache.
  const recentStart = Math.max(0, payload.messages.length - RECENT_MSG_WINDOW);
  for (const msg of payload.messages.slice(recentStart)) {
    if (!msg || !Array.isArray(msg.content)) continue;
    const keepBlocks = [];
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') { keepBlocks.push(block); continue; }
      let blockText = '';
      if (block.type === 'text') {
        blockText = typeof block.text === 'string' ? block.text : '';
      } else if (block.type === 'tool_result') {
        const c = block.content;
        if (typeof c === 'string') blockText = c;
        else if (Array.isArray(c)) {
          blockText = c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
        }
      }
      const hit = _isBoilerplateText(blockText);
      if (hit.match) {
        strippedCount++;
        stripped_samples[hit.pattern.name] = (stripped_samples[hit.pattern.name] || 0) + 1;
        // For tool_result blocks, dropping would orphan the paired tool_use.
        // Replace with outcome-honest marker that reflects is_error.
        if (block.type === 'tool_result') {
          const _marker = block.is_error === true ? '[FAIL]' : '[SUCCESS]';
          if (typeof block.content === 'string') {
            block.content = _marker;
          } else if (Array.isArray(block.content)) {
            block.content = [{ type: 'text', text: _marker }];
          } else {
            block.content = _marker;
          }
          keepBlocks.push(block);
          continue;
        }
        continue; // safe to drop standalone text blocks
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        let modified = block.text;
        for (const p of BOILERPLATE_PATTERNS) {
          if (p.strip_whole_block) continue;
          const before = modified.length;
          modified = modified.replace(p.re, '');
          if (modified.length !== before) {
            strippedCount++;
            stripped_samples[p.name] = (stripped_samples[p.name] || 0) + 1;
          }
        }
        block.text = modified;
      }
      keepBlocks.push(block);
    }
    msg.content = keepBlocks;
  }
  if (strippedCount > 0) {
    emit({
      event: 'boilerplate_stripped',
      session: 'proxy',
      count: strippedCount,
      patterns: Object.entries(stripped_samples).map(([k, v]) => `${k}=${v}`).join(','),
    });
  }
  _ensureAllUserMessagesNonEmpty(payload);
  return strippedCount;
}

// Semantic-redundancy strip
const D_MAX_BYTES = 50_000;
const D_HEAD_BYTES = 20_000;
const D_TAIL_BYTES = 20_000;
const IDE_SEL_RE = /<ide_selection>[\s\S]*?<\/ide_selection>/g;
const SYSREM_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function _textOf(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text') return typeof block.text === 'string' ? block.text : '';
  if (block.type === 'tool_result') {
    const c = block.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

function _setText(block, newText) {
  if (block.type === 'text') { block.text = newText; return; }
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') { block.content = newText; return; }
    if (Array.isArray(block.content)) {
      let replaced = false;
      block.content = block.content
        .map((x) => {
          if (!x || x.type !== 'text') return x;
          if (!replaced) { replaced = true; return { ...x, text: newText }; }
          return null;
        })
        .filter(Boolean);
      if (!replaced) block.content.unshift({ type: 'text', text: newText });
    }
  }
}

function _hashText(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) + ':' + s.length;
}

function stripSemanticRedundancy(payload) {
  if (!payload || !Array.isArray(payload.messages)) return 0;
  let strippedCount = 0;
  const patterns = {};
  const bump = (k) => { patterns[k] = (patterns[k] || 0) + 1; strippedCount++; };

  const toolUseById = new Map();
  for (const msg of payload.messages) {
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b && b.type === 'tool_use' && b.id) toolUseById.set(b.id, b);
    }
  }

  // C + D pass -- only on recent messages to avoid busting the Anthropic cache
  // prefix. Older dup-reads and oversize bashes are already cached upstream.
  const cdStart = Math.max(0, payload.messages.length - RECENT_MSG_WINDOW);
  const lastReadByFile = new Map();
  for (const msg of payload.messages.slice(cdStart)) {
    if (!msg || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue;
      if (msg.role === 'assistant' && block.type === 'tool_use' && WRITE_INTENT_TOOLS.has(block.name)) {
        const fp = (block.input && (block.input.file_path || block.input.path)) || null;
        if (fp) lastReadByFile.delete(fp);
        continue;
      }
      if (block.type !== 'tool_result') continue;
      const srcUse = toolUseById.get(block.tool_use_id);
      if (!srcUse) continue;
      if (srcUse.name === 'Read') {
        const fp = (srcUse.input && (srcUse.input.file_path || srcUse.input.path)) || null;
        const rawText = _textOf(block);
        if (fp) {
          const hash = _hashText(rawText);
          const prev = lastReadByFile.get(fp);
          if (prev && prev.hash === hash) {
            _setText(prev.block, '(superseded: same file re-read later with identical content, stripped by hme-proxy)');
            bump('dup_read_collapsed');
          }
          lastReadByFile.set(fp, { hash, block });
        }
        // Oversize-read backstop: if a hook missed, truncate the result before
        if (rawText.length > D_MAX_BYTES) {
          const head = rawText.slice(0, D_HEAD_BYTES);
          const tail = rawText.slice(-D_TAIL_BYTES);
          const elided = rawText.length - head.length - tail.length;
          _setText(block, head + `\n...<${elided} bytes elided by hme-proxy -- use offset+limit for paginated reads>...\n` + tail);
          bump('oversize_read_trim');
        }
      }
      if (srcUse.name === 'Bash') {
        const rawText = _textOf(block);
        if (rawText.length > D_MAX_BYTES) {
          const head = rawText.slice(0, D_HEAD_BYTES);
          const tail = rawText.slice(-D_TAIL_BYTES);
          const elided = rawText.length - head.length - tail.length;
          _setText(block, head + `\n...<${elided} bytes elided by hme-proxy>...\n` + tail);
          bump('oversize_bash_trim');
        }
      }
    }
  }

  // E + F + H/I/J/K pass
  const seenIdeSelection = new Set();
  const COMPACTION_NOTE_RE = /<system-reminder>\s*Note: \/\S+ was read before the last conversation was summarized[\s\S]*?<\/system-reminder>/g;
  const MONITOR_TIMEOUT_RE = /<system-reminder>\s*\[SYSTEM NOTIFICATION[\s\S]*?Monitor timed out[\s\S]*?<\/system-reminder>/g;
  const DEFERRED_TOOLS_RE = /<system-reminder>\s*The following deferred tools are now available[\s\S]*?<\/system-reminder>/g;
  // K: background-task exit notifications. Strip ALL occurrences (not
  const TASK_NOTIFICATION_RE = /<task-notification>[\s\S]*?<\/task-notification>/g;
  const TASK_NOTIFICATION_WRAPPED_RE = /<system-reminder>\s*\[SYSTEM NOTIFICATION[\s\S]*?<task-notification>[\s\S]*?<\/task-notification>[\s\S]*?<\/system-reminder>/g;
  let compactionNoteSeen = false;
  let monitorTimeoutSeen = false;
  let deferredToolsSeen = false;
  for (const msg of payload.messages) {
    if (!msg || !Array.isArray(msg.content)) continue;
    const seenSysRemInMsg = new Set();
    for (const block of msg.content) {
      if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
      let txt = block.text;

      // K runs first: strip task-notifications entirely (wrapped form, then bare).
      txt = txt.replace(TASK_NOTIFICATION_WRAPPED_RE, () => { bump('task_notification_stripped'); return ''; });
      txt = txt.replace(TASK_NOTIFICATION_RE, () => { bump('task_notification_stripped'); return ''; });

      txt = txt.replace(COMPACTION_NOTE_RE, (m) => {
        if (compactionNoteSeen) { bump('dup_compaction_note'); return ''; }
        compactionNoteSeen = true;
        return m;
      });
      txt = txt.replace(MONITOR_TIMEOUT_RE, (m) => {
        if (monitorTimeoutSeen) { bump('dup_monitor_timeout'); return ''; }
        monitorTimeoutSeen = true;
        return m;
      });
      txt = txt.replace(DEFERRED_TOOLS_RE, (m) => {
        if (deferredToolsSeen) { bump('dup_deferred_tools'); return ''; }
        deferredToolsSeen = true;
        return m;
      });
      txt = txt.replace(IDE_SEL_RE, (m) => {
        const key = _hashText(m);
        if (seenIdeSelection.has(key)) { bump('stale_ide_selection'); return ''; }
        seenIdeSelection.add(key);
        return m;
      });
      txt = txt.replace(SYSREM_RE, (m) => {
        const key = _hashText(m);
        if (seenSysRemInMsg.has(key)) { bump('dup_system_reminder'); return ''; }
        seenSysRemInMsg.add(key);
        return m;
      });

      block.text = txt;
    }
  }

  if (strippedCount > 0) {
    emit({
      event: 'semantic_redundancy_stripped',
      session: 'proxy',
      count: strippedCount,
      patterns: Object.entries(patterns).map(([k, v]) => `${k}=${v}`).join(','),
    });
  }
  return strippedCount;
}

function scanMessages(payload) {
  const result = {
    // hmeReadCalled / firstWriteBeforeRead retained as stable `false`/`null`
    hmeReadCalled: true,  // treat as always-true: auto-enrichment handles it
    writeIntentCalled: false,
    toolCalls: [],
    firstWriteBeforeRead: null,
    writeTargets: [],
    jurisdictionTargets: [],
  };
  const msgs = (payload && payload.messages) || [];
  let lastAssistantTools = [];
  for (const m of msgs) {
    const content = m && m.content;
    if (!Array.isArray(content)) continue;
    const toolsInMsg = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type !== 'tool_use') continue;
      const name = block.name || '?';
      result.toolCalls.push(name);
      if (WRITE_INTENT_TOOLS.has(name)) {
        result.writeIntentCalled = true;
        if (!result.hmeReadCalled && result.firstWriteBeforeRead === null) {
          result.firstWriteBeforeRead = name;
        }
      }
      toolsInMsg.push(block);
    }
    if (m.role === 'assistant' && toolsInMsg.length > 0) lastAssistantTools = toolsInMsg;
  }
  for (const block of lastAssistantTools) {
    if (!WRITE_INTENT_TOOLS.has(block.name || '?')) continue;
    const input = block.input || {};
    const fp = input.file_path || input.path || input.target || null;
    if (typeof fp === 'string' && fp.length > 0) {
      result.writeTargets.push(fp);
      if (isJurisdictionFile(fp)) result.jurisdictionTargets.push(fp);
    }
  }
  return result;
}

module.exports = {
  WRITE_INTENT_TOOLS,
  normalizeICommands,
  stripBoilerplate,
  stripSemanticRedundancy,
  scanMessages,
};
