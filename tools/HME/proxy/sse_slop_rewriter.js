'use strict';

// Anti-slop strip; entries define regex, replacement, and stat label.
const _SLOP_PATTERNS = [
  // #1 Narrator setup.
  { name: 'narrator_setup',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Here'?s the thing[,:]?|Here'?s where it gets interesting[,:]?|Here'?s where the real [a-zA-Z]+ lives[,:]?)\s*/gi,
    repl: '$1' },
  // #2 Dramatic rhetorical framing.
  { name: 'dramatic_framing',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:The part that (?:actually|really) matters\?|But here'?s the part where[^.]*\.|And that'?s when (?:it clicked|everything (?:changed|clicked))\.?|Want to (?:know|hear) the (?:crazy|wild|interesting) part\??)\s*/gi,
    repl: '$1' },
  // #7 Authority signaling.
  { name: 'authority_signal',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Let me be clear[,:]?|The uncomfortable truth is(?: that)?[,:]?|Here'?s what nobody tells you[,:]?|The hard truth is(?: that)?[,:]?|Here'?s the reality[,:]?|What most people miss is(?: that)?[,:]?)\s*/gi,
    repl: '$1' },
  // #8 False dichotomy lead-in. "It's not about X, it's about Y" /
  // "Stop doing X. Start doing Y." -- catch the rhetorical scaffold.
  { name: 'false_dichotomy',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:It'?s not (?:about|that) [^,.]+,\s*it'?s (?:about|that)\s+|Stop (?:doing|thinking|trying)[^.]*\.\s*Start\s+)/gi,
    repl: '$1' },
  // #9 Self-branded concepts. "This is what I call the X" / "I have a
  // framework called X" -- naming a pattern before showing it works.
  { name: 'self_branded_concept',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:This is what I call (?:the|a)?\s*|I (?:have|use|developed) a (?:framework|model|system|method) (?:called|named)\s+)/gi,
    repl: '$1' },
  // #10 Artificial drama sentences. Short paired contrasts.
  { name: 'artificial_drama',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:The shift sounds simple\.\s*It'?s not\.|Easy to say\.\s*Hard to (?:execute|do)\.|Sounds (?:obvious|simple)\.\s*It'?s not\.|Simple in theory\.\s*Hard in practice\.)\s*/gi,
    repl: '$1' },
  // #11 Empathy openers. Even in tool output these sometimes appear
  // (e.g. an agent prefacing a fix with "We've all been there").
  { name: 'empathy_opener',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:We'?ve all been there\.?|You know (?:that|the) feeling when[^.?]*[.?]|Sound familiar\??)\s*/gi,
    repl: '$1' },
  // #12 Wisdom packaging.
  { name: 'wisdom_packaging',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:The lesson\??[:.]?|The takeaway(?:\s+here)?\s+is(?:\s+simple)?[:.]?|What this really means is(?: that)?[,:]?)\s*/gi,
    repl: '$1' },
  // #13 Em-dash crutch. Replace bracketing em-dashes / `--` with
  // commas when used as parenthetical bridges between word characters.
  // Skips structural use (start-of-line lists, code).
  { name: 'em_dash_crutch',
    re: /(\w)\s+(?:\u2014|--)\s+(\w)/g,
    repl: '$1, $2' },
  // #17 Colon-list trio.
  { name: 'colon_list_trio',
    re: /(?:^|\n)(?:\s*The (?:result|impact|lesson|takeaway|point|outcome|effect)[:.]\s*[^.\n]+\.\s*){3,}/gi,
    repl: '\n' },
  // #19 The perfect pivot. "But then I realized...", "That's when
  // everything changed."
  { name: 'perfect_pivot',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:But then I realized(?:\s+that)?[,:]?|That'?s when everything changed\.?|That'?s when it (?:hit|clicked) me\.?|And then it hit me[,:]?)\s*/gi,
    repl: '$1' },
  // #20 Engagement-bait endings.
  { name: 'engagement_bait',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:So here'?s my question for you[:.]?[^.]*\.?|Curious to hear your thoughts\.?|What do you think\?|Let me know (?:what you think|your thoughts)[\.\?]?|Drop (?:a comment|your thoughts) below\.?)\s*$/gim,
    repl: '$1' },
  // #21 Humble-brag disclaimer.
  { name: 'humble_brag',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:I don'?t have all the answers,? but|Not claiming to be (?:an? )?expert,? but|Just my (?:two cents|2c|opinion),? but)\s+/gi,
    repl: '$1' },
  // #23 "Most people" strawman. "Most people think X." / "Everyone
  // focuses on X. Nobody talks about Y."
  { name: 'most_people_strawman',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Most people (?:think|believe|assume)[^.]*\.\s*They'?re wrong\.?|Everyone focuses on [^.]*\.\s*Nobody (?:talks about|mentions|sees)\s+|Most people (?:miss this|don'?t see this)[,:]?)\s*/gi,
    repl: '$1' },
  // #25 The reframe play. "X isn't [obvious]. It's [slight tweak]."
  // Pure rhetorical flourish; the slight tweak is rarely action-changing.
  { name: 'reframe_play',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:It'?s not (?:really )?(?:about|a question of) [^,.]+\.\s*It'?s (?:about|a question of)\s+)/gi,
    repl: '$1' },
  // #26 Adverb overload. Delete intensifying adverbs that add weight to
  // sentences that should stand on their own. Word-boundary anchored
  // and only when followed by a space (so "actuallySomething" in code
  // identifiers stays put). Conservative -- only the worst offenders.
  { name: 'adverb_overload',
    re: /\b(?:Truly|truly|Actually|actually|Fundamentally|fundamentally|Essentially|essentially|Ultimately|ultimately|Literally|literally)(?=\s+[a-zA-Z])\s+/g,
    repl: '' },
  // #27 Qualifying hedge.
  { name: 'qualifying_hedge',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:It'?s worth noting that|Interestingly(?: enough)?[,:]?|What'?s (?:fascinating|interesting) is(?: that)?[,:]?|It'?s important to note that|Notably[,:]?)\s*/gi,
    repl: '$1' },
  // #28 Overly smooth transitions.
  { name: 'smooth_transition',
    re: /(^|[\.\!\?]\s+|\n\s*)(?:Speaking of which[,:]?|This brings us to[^.]*\.|Building on (?:this|that)(?:\s+idea)?[,:]?|With that (?:in mind|said)[,:]?)\s*/gi,
    repl: '$1' },
  // #29 Parenthetical asides for relatability. "(yes, really)",
  // "(trust me on this)", "(I learned this the hard way)"
  { name: 'relatability_aside',
    re: /\s*\((?:yes,?\s*really|trust me(?:\s*on this)?|I learned this the hard way|no really|seriously|believe it or not)\)/gi,
    repl: '' },
  // #22 Metaphor stacking. 2+ "like X" / "as if Y" similes in the same
  // sentence. The first simile lands, the second+ stacks. Strip the
  // additional ones (collapses "X is like A, like B, like C" -> "X is
  // like A").
  { name: 'metaphor_stacking',
    re: /(\blike\s+[a-z][^,.;:!?]{0,40})\s*,\s*(?:like|as if)\s+[a-z][^,.;:!?]{0,40}(?:\s*,\s*(?:like|as if)\s+[a-z][^,.;:!?]{0,40})*/gi,
    repl: '$1' },
  // #24 Numbered wisdom list: drop 3+ short standalone maxim items.
  { name: 'numbered_wisdom_list',
    re: /(?:^|\n)(?:\s*\d+\.\s+[A-Z][^.\n]{5,75}\.\s*\n){3,}/gm,
    repl: '\n' },
  // #3 Parallel dramatic sentences: keep first repeated-opener sentence.
  { name: 'parallel_dramatic',
    re: /(\b(?:You|I|We|It|This|That|They)\b)([^.!?\n]{1,50}[.!?])\s+\1[^.!?\n]{1,50}[.!?]\s+\1[^.!?\n]{1,50}[.!?]/g,
    repl: '$1$2' },
  // Caveman compression: delete low-signal glue words/first-person filler.
  { name: 'caveman_compression',
    re: /(?<![A-Za-z0-9_])(?:i\s+am|i\s+will|i['’]m|i['’]ll|i['’]ve|i\s+have|you\s+are|you['’]re|you['’]ll|we['’]ll|we['’]re|we|i|a|as|you|your|right|okay|hmm|was|has|need|too|also|needs|is|the|but|now|that|then|agreed|implement|implementing|continuing|explicitly|actually|basically|essentially|fundamentally|literally|virtually|completely|absolutely|specifically|generally|frequently|very|really|cleanly)(?![A-Za-z0-9_])\s*/gi,
    repl: '' },
  {
    name: 'caveman_abbreviations',
    // Matches common words, tech terms, and long vocabulary for heavy token/space saving.
    re: /\b(in\s+order\s+to|as\s+well\s+as|for\s+the\s+purpose\s+of|with\s+respect\s+to|in\s+terms\s+of|at\s+the\s+present\s+time|due\s+to\s+the\s+fact\s+that|by\s+means\s+of|on\s+the\s+other\s+hand|in\s+light\s+of\s+the\s+fact\s+that|without|with|between|before|amount|because|and|into|to|acknowledged|approximately|characteristically|chronologically|collaboratively|communication|communications|consequently|demonstration|demonstrations|dissemination|ecclesiastical|enthusiastically|environmentally|identification|implementation|implementations|inappropriately|indistinguishable|infrastructure|institutionalized|metaphorically|microarchitecture|misunderstanding|misunderstandings|multi-threading|operationalization|particularization|professionalism|recommendation|recommendations|representative|representatives|responsibility|responsibilities|revolutionary|specifications|specification|synchronization|synchronizations|transformation|transformations|uncharacteristically|unconditionally|understandable|information|application|applications|configuration|configurations|repository|repositories|environment|environments|developer|developers|development|management|organization|organizations|architecture|architectures|performance|parameters|parameter|temporary|version|versions)([.!?,;:]?)/gi,
    repl: (_match, word, punct = '') => {
      const compactMap = {
        'in order to': 'to',
        'as well as': '&',
        'for the purpose of': 'for',
        'with respect to': 're:',
        'in terms of': 'via',
        'at the present time': 'now',
        'due to the fact that': 'b/c',
        'by means of': 'via',
        'on the other hand': 'but',
        'in light of the fact that': 'b/c',
        'without': 'w/o',
        'with': 'w/',
        'between': 'b/w',
        'before': 'b4',
        'amount': 'amt',
        'because': 'b/c',
        'and': '&',
        'into': '2',
        'to': '-',
        'acknowledged': 'k',

        // Long Vocabulary Concordance
        'approximately': '~',
        'characteristically': 'typ',
        'chronologically': 'by-time',
        'collaboratively': 'team',
        'communication': 'msg',
        'communications': 'msgs',
        'consequently': 'so',
        'demonstration': 'demo',
        'demonstrations': 'demos',
        'dissemination': 'spread',
        'ecclesiastical': 'church',
        'enthusiastically': 'eagerly',
        'environmentally': 'eco',
        'identification': 'id',
        'implementation': 'setup',
        'implementations': 'setups',
        'inappropriately': 'wrongly',
        'indistinguishable': 'same',
        'infrastructure': 'infra',
        'institutionalized': 'formed',
        'metaphorically': 'fig',
        'microarchitecture': 'uarch',
        'misunderstanding': 'error',
        'misunderstandings': 'errors',
        'multi-threading': 'mt',
        'operationalization': 'run',
        'particularization': 'detail',
        'professionalism': 'pro-skill',
        'recommendation': 'rec',
        'recommendations': 'recs',
        'representative': 'rep',
        'representatives': 'reps',
        'responsibility': 'duty',
        'responsibilities': 'duties',
        'revolutionary': 'new',
        'specifications': 'specs',
        'specification': 'spec',
        'synchronization': 'sync',
        'synchronizations': 'syncs',
        'transformation': 'change',
        'transformations': 'changes',
        'uncharacteristically': 'oddly',
        'unconditionally': 'always',
        'understandable': 'clear',

        // Expanded Tech & Dev Additions
        'information': 'info',
        'application': 'app',
        'applications': 'apps',
        'configuration': 'config',
        'configurations': 'configs',
        'repository': 'repo',
        'repositories': 'repos',
        'environment': 'env',
        'environments': 'envs',
        'developer': 'dev',
        'developers': 'devs',
        'development': 'dev',
        'management': 'mgmt',
        'organization': 'org',
        'organizations': 'orgs',
        'architecture': 'arch',
        'architectures': 'archs',
        'performance': 'perf',
        'parameters': 'params',
        'parameter': 'param',
        'temporary': 'tmp',
        'version': 'v',
        'versions': 'vs'
      };

      const key = word.toLowerCase();
      if (key in compactMap) {
        // Preserves capitalization style of the original word if needed
        const isTitleCase = word[0] === word[0].toUpperCase() && word.length > 1 && word[1] === word[1].toLowerCase();
        let target = compactMap[key];

        if (isTitleCase && target[0] !== '~' && target[0] !== '&' && target[0] !== '-') {
          target = target[0].toUpperCase() + target.slice(1);
        }
        return `${target}${punct}`;
      }

      return `${word}${punct}`;
    }
  },
  // #15 Excessive bold: sentinel invokes density-gated demoter below.
  { name: 'excessive_bold',
    re: null,  // handled in _stripExcessiveBold below
    repl: null
  }
];

function _capFix(s) {
  // After deletions, sentences may start with lowercase. Promote the
  // first alpha after sentence-end punctuation OR start-of-string.
  return s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

// #15 Excessive bold demoter; all-or-nothing when density is egregious.
function _stripExcessiveBold(text) {
  if (!text || typeof text !== 'string') return { out: text, hit: false };
  const boldRe = /\*\*([^*\n]{1,80})\*\*/g;
  const matches = [...text.matchAll(boldRe)];
  if (matches.length < 6) return { out: text, hit: false };
  const wordCount = (text.match(/\b[\w'-]+\b/g) || []).length;
  if (wordCount === 0) return { out: text, hit: false };
  const density = matches.length / wordCount;  // bolds per word
  if (density < 1 / 25) return { out: text, hit: false };
  // Density-positive AND most bolds short = highlighter pattern.
  const shortBolds = matches.filter((m) => m[1].length <= 30).length;
  if (shortBolds < matches.length * 0.7) return { out: text, hit: false };
  return { out: text.replace(boldRe, '$1'), hit: true };
}

function _cleanupSlopArtifacts(text) {
  return String(text || '')
    .replace(/(?:\s*[,.;:!?]){2,}/g, '.')
    .replace(/^\s*[,.;:!?]+\s*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

function _stripSlop(text) {
  if (typeof text !== 'string' || !text) return { out: text, hits: [] };
  let out = text;
  const hits = [];
  for (const p of _SLOP_PATTERNS) {
    if (p.re === null) continue;  // function-style entries (e.g. excessive_bold)
    const before = out;
    out = out.replace(p.re, p.repl);
    if (out !== before) hits.push(p.name);
  }
  // Function-style strips: density-gated, can't be a simple regex.
  const boldResult = _stripExcessiveBold(out);
  if (boldResult.hit) {
    out = boldResult.out;
    hits.push('excessive_bold');
  }
  if (hits.length > 0) out = _capFix(out);
  out = _cleanupSlopArtifacts(out);
  return { out, hits };
}

function _logSlopHits(hits, textPreview) {
  try {
    const fs = require('fs');
    const path = require('path');
    const { PROJECT_ROOT } = require('./shared');
    fs.appendFileSync(
      path.join(PROJECT_ROOT, 'log', 'hme-slop-strips.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hits,
        text_preview: textPreview.slice(0, 80),
      }) + '\n',
    );
  } catch (_e) { /* stat is best-effort */ }
}

// Text/thinking slop rewriter; full slop cleanup is always-on for all assistant
// response and thinking blocks.
function slopStripRewrite(eventName, data, ctx) {
  const key = 'slop_text_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  if (eventName === 'content_block_start' && data && data.content_block && ['text', 'thinking'].includes(data.content_block.type)) {
    holds.set(data.index, { startData: data, blockType: data.content_block.type, deltas: [] });
    return null;  // hold the start
  }
  if (eventName === 'content_block_delta' && data && data.delta && ['text_delta', 'thinking_delta'].includes(data.delta.type)) {
    const state = holds.get(data.index);
    if (!state) return data;  // not a held block (e.g. ack-strip already swallowed it)
    state.deltas.push(data);
    return null;
  }
  // Non-text/thinking deltas (e.g. signature_delta on thinking blocks) must
  // not jump ahead of the held content_block_start. Flush the start first,
  if (eventName === 'content_block_delta' && data && holds.has(data.index)) {
    const state = holds.get(data.index);
    const events = [['content_block_start', state.startData], [eventName, data]];
    state.startData = null;
    state.deltas = state.deltas || [];
    state.flushed = true;
    return { events };
  }
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);
    let assembled = '';
    for (const d of state.deltas) {
      if (!d || !d.delta) continue;
      if (typeof d.delta.text === 'string') assembled += d.delta.text;
      if (typeof d.delta.thinking === 'string') assembled += d.delta.thinking;
    }
    const { out, hits } = _stripSlop(assembled);
    const events = [];
    if (state.startData) events.push(['content_block_start', state.startData]);
    if (hits.length === 0) {
      for (const d of state.deltas) events.push(['content_block_delta', d]);
      events.push(['content_block_stop', data]);
      return { events };
    }
    _logSlopHits(hits, assembled);
    // Re-emit: the original start, ONE replacement delta with stripped text,
    // then the stop. Original deltas dropped only when stripping changed text.
    if (out) {
      const delta = state.blockType === 'thinking'
        ? { type: 'thinking_delta', thinking: out }
        : { type: 'text_delta', text: out };
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta,
      }]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

module.exports = {
  slopStripRewrite,
  _stripSlop,
  _stripExcessiveBold,
  _cleanupSlopArtifacts,
};
