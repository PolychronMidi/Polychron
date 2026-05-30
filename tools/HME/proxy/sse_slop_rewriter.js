'use strict';

function _escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _normalizeAbbrevKey(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function _preserveAbbrevCase(source, target) {
  const src = String(source || '').trim();
  const out = String(target || '');
  if (!src || !out || !/^[a-z]/.test(out)) return out;

  // Preserve simple Title Case for one-word replacements: Information -> Info.
  // Avoid title-casing symbol-ish targets like &, ~, -, b/c, w/o, etc.
  const isTitleCase = /^[A-Z][a-z]/.test(src);
  return isTitleCase ? out[0].toUpperCase() + out.slice(1) : out;
}

const _ABBREVIATION_MAP = Object.freeze({
  // Common phrases.
  'in order to': 'to',
  'as well as': '&',
  'for the purpose of': '4',
  'with respect to': 're:',
  'in terms of': 'via',
  'at the present time': 'now',
  'at this point in time': 'now',
  'due to the fact that': 'b/c',
  'in light of the fact that': 'b/c',
  'by means of': 'via',
  'on the other hand': ',',
  'but': ',',
  'in the event that': 'if',
  'provided that': 'if',
  'prior to': 'b4',
  'subsequent to': 'after',
  'a number of': 'many',
  'right now': 'now',
  'end-to-end': 'full',
  'step by step': 'steps',
  'one by one': '1x1',

  // Common words / compact forms.
  'executing': 'doing',
  'execute': 'do',
  'sequence': 'seq',
  'without': 'w/o',
  'with': 'w/',
  'between': 'b/w',
  'before': 'b4',
  'for': '4',
  'because': 'b/c',
  'amount': 'amt',
  'and': '&',
  'into': '2',
  'to': '-',
  'in': 'n',
  'why': 'y',
  'what': 'wht',
  'when': 'whn',
  'where': 'whr',
  'which': 'wch',
  'yes': 'y',
  'or': '|',
  'you': 'u',
  'your': 'ur',
  'are': 'r',
  'both': 'bth',
  'read': 'rd',
  'reads': 'rds',
  'reading': 'rdn',
  'please': 'pls',
  'thanks': 'thx',
  'thank you': 'thx',
  'about': 'abt',
  'through': 'thru',
  'though': 'tho',
  'people': 'ppl',
  'number': 'num',
  'example': 'ex',
  'examples': 'exs',
  'versus': 'vs',
  'problem': 'prob',
  'problems': 'probs',
  'question': 'q',
  'questions': 'qs',
  'acknowledged': 'k',
  'understood': 'k',
  'complete': 'done',
  'completed': 'done',
  'current': 'cur',
  'currently': 'now',
  'different': 'diff',
  'difference': 'diff',
  'difficult': 'hard',
  'important': 'impt',
  'necessary': 'req',
  'become': 'bcm',
  'leave': 'lve',
  'live': 'lv',
  'healthy': 'hlty',
  'confirm': 'conf',
  'reason': 'rsn',
  'forward': 'fwd',
  'available': 'avail',
  'candidate': 'cand',
  'candidates': 'cands',
  'real': 'rl',
  'really': 'rly',
  'honest': 'rl',
  'honestly': 'rly',
  'after': 'aft',
  'during': 'dur',
  'around': 'rnd',
  'never': 'nvr',
  'always': 'alwys',

  // Number words.
  'zero': '0',
  'one': '1',
  'two': '2',
  'three': '3',
  'four': '4',
  'five': '5',
  'six': '6',
  'seven': '7',
  'eight': '8',
  'nine': '9',
  'ten': '10',

  // Ordinal/place words.
  'first': '1st',
  'second': '2nd',
  'third': '3rd',
  'fourth': '4th',
  'fifth': '5th',
  'sixth': '6th',
  'seventh': '7th',
  'eighth': '8th',
  'ninth': '9th',
  'tenth': '10th',

  // Contractions / common modal phrases.
  'cannot': 'cant',
  'can not': 'cant',
  'could not': 'couldnt',
  'should not': 'shouldnt',
  'would not': 'wouldnt',
  'will not': 'wont',
  'do not': 'dont',
  'does not': 'doesnt',
  'did not': 'didnt',
  'is not': 'isnt',
  'are not': 'arent',
  'was not': 'wasnt',
  'were not': 'werent',

  // Long vocabulary concordance.
  'replacement': 'repl',
  'replace': 'repl',
  'continue': 'go',
  'continuing': 'doing',
  'continued': 'did',
  'handle': 'do',
  'handles': 'does',
  'continues': 'does',
  'validation': 'check',
  'validate': 'check',
  'validating': 'checking',
  'validates': 'checks',
  'status': 'stat',
  'approximately': '~',
  'maybe': '~',
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
  'instead': 'instd',
  'performed': 'did',
  'perform': 'do',
  'implemented': 'did',
  'implement': 'do',
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
  'specification': 'spec',
  'specifications': 'specs',
  'synchronization': 'sync',
  'synchronizations': 'syncs',
  'transformation': 'change',
  'transformations': 'changes',
  'uncharacteristically': 'oddly',
  'unconditionally': 'always',
  'understandable': 'clear',
  'signature': 'sig',
  'signatures': 'sigs',

  // Tech & dev.
  'server': 'svr',
  'servers': 'svrs',
  'service': 'svc',
  'services': 'svcs',
  'autocommit': 'autocmt',
  'clear': 'clr',
  'clearing': 'clrn',
  'recent': 'rcnt',
  'insert': 'ins',
  'insertion': 'insn',
  'insertions': 'insns',
  'feature': 'ftr',
  'work': 'wrk',
  'works': 'wrks',
  'exact': 'exct',
  'message': 'msg',
  'messages': 'msgs',
  'previous': 'last',
  'enormous': 'big',
  'diagnosis': 'diag',
  'diagnose': 'diag',
  'diagnostic': 'diag',
  'diagnostics': 'diags',
  'actual': 'actl',
  'change': 'chg',
  'changes': 'chgs',
  'changing': 'chgn',
  'changed': 'chd',
  'ready': 'rdy',
  'next': 'nxt',
  'failure': 'flr',
  'failures': 'flrs',
  'active': 'actv',
  'diagnosing': 'diagn',
  'diagnosed': 'diagd',
  'request': 'req',
  'requested': 'reqd',
  'requests': 'reqs',
  'requesting': 'reqn',
  'generate': 'make',
  'regenerate': 'remake',
  'generated': 'made',
  'regenerated': 'remade',
  'generating': 'making',
  'regenerating': 'remaking',
  'generation': 'gen',
  'maintenance': 'maint',
  'system': 'sys',
  'systems': 'sys',
  'command': 'cmd',
  'commands': 'cmds',
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
  'parameter': 'param',
  'parameters': 'params',
  'temporary': 'tmp',
  'version': 'v',
  'versions': 'vs',
  'function': 'fn',
  'functions': 'fns',
  'variable': 'var',
  'variables': 'vars',
  'directory': 'dir',
  'directories': 'dirs',
  'database': 'db',
  'databases': 'dbs',
  'document': 'doc',
  'documents': 'docs',
  'documentation': 'docs',
  'dependency': 'dep',
  'dependencies': 'deps',
  'package': 'pkg',
  'packages': 'pkgs',
  'installation': 'install',
  'initialization': 'init',
  'authentication': 'auth',
  'authorization': 'authz',
  'administrator': 'admin',
  'administrators': 'admins',
  'interface': 'iface',
  'interfaces': 'ifaces',
  'utility': 'util',
  'utilities': 'utils',
  'reference': 'ref',
  'references': 'refs',
  'production': 'prod',
  'development environment': 'dev env',
  'production environment': 'prod env',
  'pull request': 'PR',
  'pull requests': 'PRs',
  'continuous integration': 'CI',
  'continuous deployment': 'CD',
  'continuous delivery': 'CD',
  'user interface': 'UI',
  'application programming interface': 'API',
  'software development kit': 'SDK',
  'central processing unit': 'CPU',
  'graphics processing unit': 'GPU',
  'operating system': 'OS',
  'regular expression': 'regex',
  'regular expressions': 'regexes',
  'exception': 'exn',
  'exceptions': 'exns',
  'configuration file': 'config file',
  'configuration files': 'config files',
  'implementation detail': 'impl detail',
  'implementation details': 'impl details',
});

function _buildAbbreviationRegExp(map) {
  const pattern = Object.keys(map)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(_escapeRegExp)
    .map((value) => value.replace(/\\ /g, '\\s+'))
    .join('|');

  // The closing \b fixes partial matches like complete -> completed + "d".
  // Spaces are not consumed by single-word entries, so keys like "in" work.
  return new RegExp(`\\b(${pattern})\\b(?!['’])([.!?,;:]?)`, 'gi');
}

const _ABBREVIATION_RE = _buildAbbreviationRegExp(_ABBREVIATION_MAP);

function _abbreviateMatch(_match, word, punct = '') {
  const key = _normalizeAbbrevKey(word);
  const target = _ABBREVIATION_MAP[key];
  if (target === undefined) return `${word}${punct}`;
  return `${_preserveAbbrevCase(word, target)}${punct}`;
}

const _SUFFIX_EXCEPTIONS = new Set([
  'spring',
  'thing',
  'bring',
  'string',
  'during',
  'fission',
  'mission',
  'passion',
]);

function _suffixRule(name, suffix, minStem, replacementSuffix, { minOutput = 5, plural = true } = {}) {
  const escapedSuffix = _escapeRegExp(suffix);
  const pluralPart = plural ? '(s?)' : '()';
  return {
    name,
    re: new RegExp(`(?<![A-Za-z0-9_/@.-])([a-z]{${minStem},})${escapedSuffix}${pluralPart}\\b`, 'gi'),
    repl: (match, stem, pluralMark = '') => {
      const word = String(match || '');
      if (_shouldSkipMorphWord(word)) return word;
      const lower = word.toLowerCase();
      const singularLower = pluralMark ? lower.slice(0, -1) : lower;
      const out = `${stem}${replacementSuffix}${pluralMark ? 's' : ''}`;
      if (_SUFFIX_EXCEPTIONS.has(lower) || _SUFFIX_EXCEPTIONS.has(singularLower)) return word;
      if (out.length < minOutput) return word;
      return out;
    },
  };
}

function _dropContractionApostrophesSegment(text) {
  return String(text || '').replace(/\b([A-Za-z]+)['’]([A-Za-z]+)\b/g, '$1$2');
}

function _stripMarkdownFormattingSegment(text) {
  return String(text || '')
    .replace(/\*\*([^*\n]{1,200})\*\*/g, '$1')
    .replace(/(?<![A-Za-z0-9_])__([^_\n]{1,200})__(?![A-Za-z0-9_])/g, '$1')
    .replace(/(?<!\*)\*([^*\n]{1,200})\*(?!\*)/g, '$1')
    .replace(/(?<![A-Za-z0-9_])_([^_\n]{1,200})_(?![A-Za-z0-9_])/g, '$1');
}

function _shouldSkipMorphWord(word) {
  // Avoid mangling code-ish/proper-name tokens in prose, such as JavaScript,
  // ChatGPT, OpenAI, HTTPServer, or ALLCAPS constants. Single leading caps
  // still compress so sentence-start words do not bypass the rule.
  return /[a-z][A-Z]|[A-Z]{2,}/.test(word);
}

function _stripCenterVowelsWord(word) {
  const value = String(word || '');
  const removeCount = value.length > 8 ? 2 : value.length > 6 ? 1 : 0;
  if (!removeCount || _shouldSkipMorphWord(value)) return value;

  const center = (value.length - 1) / 2;
  const removableVowels = [];
  const protectedFirstLetterVowels = [];
  for (let i = 0; i < value.length; i += 1) {
    if (!/[aeiou]/i.test(value[i])) continue;
    if (i === 0) protectedFirstLetterVowels.push(i);
    else removableVowels.push(i);
  }
  if (removableVowels.length === 0) return value;

  // Choose center-nearest vowels as before, but exempt the first letter. When a
  // first-letter vowel would have been chosen, remove fewer vowels rather than
  const ranked = removableVowels.concat(protectedFirstLetterVowels)
    .sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || b - a);
  const toRemove = new Set(ranked
    .slice(0, removeCount)
    .filter((i) => i !== 0));

  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (!toRemove.has(i)) out += value[i];
  }
  return out;
}

function _stripCenterVowelsSegment(text) {
  return String(text || '').replace(/\b[A-Za-z]{7,}\b/g, (word) => _stripCenterVowelsWord(word));
}

function _compactNonAlnumSegment(text) {
  return String(text || '')
    // Preserve newline entries. Only strip spaces/tabs around punctuation that is
    // safe without padding; keep word separators around operators like &, |, -.
    .replace(/[ \t]*([,.;:!?])([ \t]*)/g, (m, punct, tail) => {
      if (/[.!?]/.test(punct)) return punct + (tail ? ' ' : '');
      return punct;
    })
    .replace(/[ \t]*([()\[\]{}])[ \t]*/g, '$1')
    // Deduplicate concurrent repeated non-alphanumeric chars: !!! -> !, ... -> .
    .replace(/([^A-Za-z0-9\s])\1+/g, '$1');
}


// Anti-slop strip; entries define regex, replacement, and stat label.
const _SLOP_PATTERNS = [
  // #1 Narrator setup.
  { name: 'narrator_setup',
    re: /(^|[.!?]\s+|\n\s*)(?:Here'?s the thing[,:]?|Here'?s where it gets interesting[,:]?|Here'?s where the real [a-zA-Z]+ lives[,:]?)\s*/gi,
    repl: '$1' },
  // #2 Dramatic rhetorical framing.
  { name: 'dramatic_framing',
    re: /(^|[.!?]\s+|\n\s*)(?:The part that (?:actually|really) matters\?|But here'?s the part where[^.]*\.|And that'?s when (?:it clicked|everything (?:changed|clicked))\.?|Want to (?:know|hear) the (?:crazy|wild|interesting) part\??)\s*/gi,
    repl: '$1' },
  // #7 Authority signaling.
  { name: 'authority_signal',
    re: /(^|[.!?]\s+|\n\s*)(?:Let me be clear[,:]?|The uncomfortable truth is(?: that)?[,:]?|Here'?s what nobody tells you[,:]?|The hard truth is(?: that)?[,:]?|Here'?s the reality[,:]?|What most people miss is(?: that)?[,:]?)\s*/gi,
    repl: '$1' },
  // #8 False dichotomy lead-in. "It's not about X, it's about Y" /
  // "Stop doing X. Start doing Y." -- catch the rhetorical scaffold.
  { name: 'false_dichotomy',
    re: /(^|[.!?]\s+|\n\s*)(?:It'?s not (?:about|that) [^,.]+,\s*it'?s (?:about|that)\s+|Stop (?:doing|thinking|trying)[^.]*\.\s*Start\s+)/gi,
    repl: '$1' },
  // #9 Self-branded concepts. "This is what I call the X" / "I have a
  // framework called X" -- naming a pattern before showing it works.
  { name: 'self_branded_concept',
    re: /(^|[.!?]\s+|\n\s*)(?:This is what I call (?:the|a)?\s*|I (?:have|use|developed) a (?:framework|model|system|method) (?:called|named)\s+)/gi,
    repl: '$1' },
  // #10 Artificial drama sentences. Short paired contrasts.
  { name: 'artificial_drama',
    re: /(^|[.!?]\s+|\n\s*)(?:The shift sounds simple\.\s*It'?s not\.|Easy to say\.\s*Hard to (?:execute|do)\.|Sounds (?:obvious|simple)\.\s*It'?s not\.|Simple in theory\.\s*Hard in practice\.)\s*/gi,
    repl: '$1' },
  // #11 Empathy openers. Even in tool output these sometimes appear
  // (e.g. an agent prefacing a fix with "We've all been there").
  { name: 'empathy_opener',
    re: /(^|[.!?]\s+|\n\s*)(?:We'?ve all been there\.?|You know (?:that|the) feeling when[^.?]*[.?]|Sound familiar\??)\s*/gi,
    repl: '$1' },
  // #12 Wisdom packaging.
  { name: 'wisdom_packaging',
    re: /(^|[.!?]\s+|\n\s*)(?:The lesson\??[:.]?|The takeaway(?:\s+here)?\s+is(?:\s+simple)?[:.]?|What this really means is(?: that)?[,:]?)\s*/gi,
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
    re: /(^|[.!?]\s+|\n\s*)(?:But then I realized(?:\s+that)?[,:]?|That'?s when everything changed\.?|That'?s when it (?:hit|clicked) me\.?|And then it hit me[,:]?)\s*/gi,
    repl: '$1' },
  // #20 Engagement-bait endings.
  { name: 'engagement_bait',
    re: /(^|[.!?]\s+|\n\s*)(?:So here'?s my question for you[:.]?[^.]*\.?|Curious to hear your thoughts\.?|What do you think\?|Let me know (?:what you think|your thoughts)[.?]?|Drop (?:a comment|your thoughts) below\.?)\s*$/gim,
    repl: '$1' },
  // #21 Humble-brag disclaimer.
  { name: 'humble_brag',
    re: /(^|[.!?]\s+|\n\s*)(?:I don'?t have all the answers,? but|Not claiming to be (?:an? )?expert,? but|Just my (?:two cents|2c|opinion),? but)\s+/gi,
    repl: '$1' },
  // #23 "Most people" strawman. "Most people think X." / "Everyone
  // focuses on X. Nobody talks about Y."
  { name: 'most_people_strawman',
    re: /(^|[.!?]\s+|\n\s*)(?:Most people (?:think|believe|assume)[^.]*\.\s*They'?re wrong\.?|Everyone focuses on [^.]*\.\s*Nobody (?:talks about|mentions|sees)\s+|Most people (?:miss this|don'?t see this)[,:]?)\s*/gi,
    repl: '$1' },
  // #25 The reframe play. "X isn't [obvious]. It's [slight tweak]."
  // Pure rhetorical flourish; the slight tweak is rarely action-changing.
  { name: 'reframe_play',
    re: /(^|[.!?]\s+|\n\s*)(?:It'?s not (?:really )?(?:about|a question of) [^,.]+\.\s*It'?s (?:about|a question of)\s+)/gi,
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
    re: /(^|[.!?]\s+|\n\s*)(?:It'?s worth noting that|Interestingly(?: enough)?[,:]?|What'?s (?:fascinating|interesting) is(?: that)?[,:]?|It'?s important to note that|Notably[,:]?)\s*/gi,
    repl: '$1' },
  // #28 Overly smooth transitions.
  { name: 'smooth_transition',
    re: /(^|[.!?]\s+|\n\s*)(?:Speaking of which[,:]?|This brings us to[^.]*\.|Building on (?:this|that)(?:\s+idea)?[,:]?|With that (?:in mind|said)[,:]?)\s*/gi,
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

  // Caveman abbreviation pass. Generated from _ABBREVIATION_MAP so longer
  // phrases win, trailing word boundaries prevent partial-word matches, and
  // single-word entries like "in" do not consume the following space.
  { name: 'caveman_abbreviations',
    re: _ABBREVIATION_RE,
    repl: _abbreviateMatch },

  // Caveman -ing suffix pass. minOutput blocks short false positives; plural
  // form also works: meeting(s) -> meetn(s), testing -> testn.
  _suffixRule('caveman_ing_suffix', 'ing', 1, 'n'),

  // Caveman compression: delete low-signal glue words/first-person filler.
  // Kept after abbreviations so phrase replacements like "as well as" -> "&"
  // happen before small words are removed.
  // Boundary guards forbid letters, digits, underscore AND apostrophe on both
  // sides. The apostrophe guard is critical: without it, bare `i` followed by
  // "'" matches the "i" in "i'm" and deletes ONLY the letter, leaving "'m".
  { name: 'caveman_compression',
    re: /(?<![A-Za-z0-9_'’])(?:i\s+am|i\s+will|i['’]m|im|i['’]ll|ill|i['’]ve|ive|i['’]d|id|i\s+would|i\s+have|my|me|now|you\s+are|you['’]re|youre|you['’]ll|youll|we['’]ll|well|we['’]re|were|we|i|a|an|as|our|right|okay|ok|hmm|let\s+me|them|they|was|has|need|too|also|needs|is|it|its|it['’]s|so|wait|be|the|that|that['’]s|thats|this|then|agreed|explicitly|actually|basically|essentially|fundamentally|literally|virtually|completely|absolutely|specifically|generally|frequently|very|really|cleanly)(?![A-Za-z0-9_'’])\s*/gi,
    repl: '' },

  // Caveman -ed suffix pass. Only words greater than 5 letters are changed.
  // Prefix must be at least 4 letters, because 4 + "ed" = 6.
  // Runs after compression so explicit deletes like "agreed" win first.
  _suffixRule('caveman_ed_suffix', 'ed', 3, 'd'),

  _suffixRule('caveman_er_suffix', 'er', 3, 'r'),

  _suffixRule('caveman_ism_suffix', 'ism', 4, 'sm'),

  // Caveman -tion suffix pass. Only words greater than 6 letters are changed.
  // Prefix must be at least 3 letters, because 3 + "tion" = 7.
  // Runs after explicit abbreviations so map entries like "configuration" ->
  // "config" and "application" -> "app" win before generic suffix cleanup.
  // Examples: station -> statn, caution -> cautn, relation -> relatn.
  // Non-examples: action, option.
  _suffixRule('caveman_tion_suffix', 'tion', 3, 'tn'),

  // Caveman -sion suffix pass. Only words greater than 6 letters are changed.
  // Examples: decision -> decisn, revision -> revisn, expansion -> expansn.
  // Non-examples: vision; exception-list words like fission/mission/passion.
  _suffixRule('caveman_sion_suffix', 'sion', 3, 'sn'),

  // Caveman -ment suffix pass. Only words greater than 6 letters are changed.
  // Examples: agreement -> agreemt, shipment -> shipmt, fragment -> fragmt.
  // Non-examples: cement, moment.
  _suffixRule('caveman_ment_suffix', 'ment', 3, 'mt'),

  // Caveman -ly suffix pass. Only words greater than 6 letters are changed.
  // Examples: locally -> localy, globally -> globaly, normally -> normaly.
  // Non-examples: ally.
  _suffixRule('caveman_ly_suffix', 'ly', 5, 'y'),

  // Caveman -ior suffix pass. Only words greater than 5 letters are changed.
  // Examples: behavior -> behavr, superior -> superr, interior -> interr.
  // Non-examples: prior.
  _suffixRule('caveman_ior_suffix', 'ior', 3, 'r'),

  // Remove apostrophes inside contractions/possessive-looking word tokens.
  // Examples: can't -> cant, you're -> youre, it's -> its.
  { name: 'caveman_apostrophe_drop', fn: _dropContractionApostrophesSegment },

  // Remove markdown emphasis markers while preserving the emphasized text.
  // Keep this outside protected code spans so identifiers/flags remain untouched.
  { name: 'markdown_formatting', fn: _stripMarkdownFormattingSegment },

  // For alphabetic words >6 chars, remove center-nearest vowel. For words >8,
  // remove the two center-nearest vowels; later vowels win exact center ties.
  { name: 'caveman_center_vowels', fn: _stripCenterVowelsSegment },

  // #15 Excessive bold: sentinel invokes density-gated demoter below.
  { name: 'excessive_bold',
    re: null,  // handled in _stripExcessiveBold below
    repl: null }
];

function _capFix(s) {
  // After deletions, sentences may start with lowercase. Promote the
  // first alpha after sentence-end punctuation, newline, or start-of-string.
  return _replaceOutsideCode(
    String(s || ''),
    /(^|[.!?]\s+|\n\s*)([a-z])/g,
    (_m, lead, ch) => lead + ch.toUpperCase(),
  );
}

function _stripExcessiveBoldSegment(text) {
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

// #15 Excessive bold demoter; all-or-nothing when density is egregious.
function _stripExcessiveBold(text) {
  if (!text || typeof text !== 'string') return { out: text, hit: false };
  if (!/`/.test(text)) return _stripExcessiveBoldSegment(text);

  let hit = false;
  const segs = _segmentByCode(text).map((seg) => {
    if (seg.code) return seg;
    const result = _stripExcessiveBoldSegment(seg.s);
    if (result.hit) hit = true;
    return { code: false, s: result.out };
  });

  return { out: segs.map((seg) => seg.s).join(''), hit };
}

function _cleanupPlainSlopArtifacts(text, trim = false) {
  const out = String(text || '')
    .replace(/(?:[ \t]*[,.;:!?]){2,}/g, '.')
    .replace(/^[ \t]*[,.;:!?]+[ \t]*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([.!?])[ \t]*([,.;:!?])+/g, '$1')
    .replace(/\([ \t]+/g, '(')
    .replace(/[ \t]+\)/g, ')')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n');

  return trim ? out.trim() : out;
}

function _needsBoundaryBetween(left, right) {
  if (!left || !right) return false;
  const l = String(left).slice(-1);
  const r = String(right)[0];
  if (/\s/.test(l) || /\s/.test(r)) return false;
  if (/^[,.;:!?)]$/.test(r)) return false;
  if (/^[(\[]$/.test(l)) return false;
  return /[`\w)\]]/.test(l) && /[`\w]/.test(r);
}

function _joinProtectedSegments(segs) {
  let out = '';
  for (const seg of segs) {
    const s = typeof seg === 'string' ? seg : seg.s;
    if (_needsBoundaryBetween(out, s)) out += ' ';
    out += s;
  }
  return out;
}

function _cleanupSlopArtifacts(text) {
  const raw = String(text || '');
  if (!_hasProtectedSegments(raw)) return _cleanupPlainSlopArtifacts(raw, true);

  const out = _segmentByCode(raw)
    .map((seg) => seg.code ? seg.s : _cleanupPlainSlopArtifacts(seg.s, false));
  const joined = _joinProtectedSegments(out);

  return joined.trim();
}

function _hasProtectedSegments(text) {
  return /`|https?:\/\/|(?<!\S)(?:\/|--[A-Za-z0-9]|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)(?=$|[\s,.;:!?)}\]])/.test(String(text || ''));
}

// Split text into [{code:bool, s:string}, ...] segments. Protected segments are
// triple-backtick fenced blocks, inline single-backtick spans, URLs, absolute
// paths, CLI flags, or dotted code-ish tokens like package.json. Code-unsafe
// slop patterns are applied only to {code:false} segments.
function _segmentByCode(text) {
  const out = [];
  const re = /```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s`]+|(?<!\S)(?:\/[^\s`]+|--[A-Za-z0-9][^\s`]*|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)(?=$|[\s,.;:!?)}\]])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ code: false, s: text.slice(last, m.index) });
    out.push({ code: true, s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ code: false, s: text.slice(last) });
  return out;
}

function _replaceOutsideCode(text, re, repl) {
  if (!_hasProtectedSegments(text)) return text.replace(re, repl);
  const segs = _segmentByCode(text);
  for (const seg of segs) {
    if (!seg.code) seg.s = seg.s.replace(re, repl);
  }
  return segs.map((seg) => seg.s).join('');
}

function _applyTextTransformOutsideCode(text, fn) {
  if (!_hasProtectedSegments(text)) return fn(text);
  const segs = _segmentByCode(text);
  for (const seg of segs) {
    if (!seg.code) seg.s = fn(seg.s);
  }
  return segs.map((seg) => seg.s).join('');
}

function _applyPatternOutsideCode(text, pattern) {
  if (typeof pattern.fn === 'function') return _applyTextTransformOutsideCode(text, pattern.fn);
  return _replaceOutsideCode(text, pattern.re, pattern.repl);
}

function _stripSlop(text) {
  if (typeof text !== 'string' || !text) return { out: text, hits: [] };
  let out = text;
  const hits = [];

  for (const p of _SLOP_PATTERNS) {
    if (p.re === null && typeof p.fn !== 'function') continue;  // sentinel entries
    const before = out;
    out = _applyPatternOutsideCode(out, p);
    if (out !== before) hits.push(p.name);
  }

  // Function-style strips: density-gated, can't be a simple regex.
  const boldResult = _stripExcessiveBold(out);
  if (boldResult.hit) {
    out = boldResult.out;
    hits.push('excessive_bold');
  }

  const punctProbe = _applyTextTransformOutsideCode(out, _compactNonAlnumSegment);
  if (hits.length > 0 || punctProbe !== out) out = _capFix(out);

  const beforePunctCompact = out;
  out = _applyTextTransformOutsideCode(out, _compactNonAlnumSegment);
  if (out !== beforePunctCompact) hits.push('caveman_non_alnum_compaction');

  out = _cleanupSlopArtifacts(out);
  return { out, hits };
}

function _logSlopHits(hits, textPreview, blockType) {
  try {
    const fs = require('fs');
    const path = require('path');
    const { PROJECT_ROOT } = require('./shared');
    const logDir = path.join(PROJECT_ROOT, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'hme-slop-strips.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        block_type: blockType || 'unknown',
        hits,
        text_preview: String(textPreview || '').slice(0, 80),
      }) + '\n',
    );
  } catch (_e) { /* stat is best-effort */ }
}

function _isStructuredJson(text) {
  const t = String(text || '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return false;
  try { JSON.parse(t); return true; } catch (_e) { return false; }
}

function _emitHeldTextEvents(state, index) {
  const events = [];
  if (state.startData) events.push(['content_block_start', state.startData]);

  // Word-level slop rules (compression, suffix, abbreviation) are ONLY safe on
  // the FULL contiguous block text. Striping a partial buffer mid-stream splits
  let assembled = '';
  for (const d of state.deltas || []) {
    if (!d || !d.delta) continue;
    if (typeof d.delta.text === 'string') assembled += d.delta.text;
    if (typeof d.delta.thinking === 'string') assembled += d.delta.thinking;
  }

  let hits = [];
  if (assembled && _isStructuredJson(assembled)) {
    // Structured-JSON response (e.g. Claude Code's /goal Stop-hook verdict
    // {"continue":false,"rsn":"..."}). Caveman compression abbreviates keys and
    for (const d of state.deltas || []) events.push(['content_block_delta', d]);
  } else if (assembled) {
    const stripped = _stripSlop(assembled);
    hits = stripped.hits;
    if (hits.length === 0) {
      for (const d of state.deltas || []) events.push(['content_block_delta', d]);
    } else if (stripped.out) {
      const delta = state.blockType === 'thinking'
        ? { type: 'thinking_delta', thinking: stripped.out }
        : { type: 'text_delta', text: stripped.out };
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta }]);
    }
  }

  // Replay non-text passthrough deltas (signature_delta, etc.) after content,
  // preserving their relative order.
  for (const d of state.passthrough || []) events.push(['content_block_delta', d]);

  state.startData = null;
  state.deltas = [];
  state.passthrough = [];
  state.flushed = true;
  return { events, hits, out: assembled };
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

  // Non-text/thinking deltas (e.g. signature_delta on thinking blocks) arriving
  // mid-block must NOT trigger a partial strip -- that splits a word across two
  // strip passes ("inspection" -> "NSpectn"). Buffer them in order; they are
  if (eventName === 'content_block_delta' && data && holds.has(data.index)) {
    const state = holds.get(data.index);
    if (!state.passthrough) state.passthrough = [];
    state.passthrough.push(data);
    return null;
  }

  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);

    const { events, hits, out: assembled } = _emitHeldTextEvents(state, data.index);
    if (hits.length > 0) _logSlopHits(hits, assembled, state.blockType);
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
  _ABBREVIATION_MAP,
  _ABBREVIATION_RE,
  _stripCenterVowelsWord,
  _stripMarkdownFormattingSegment,
  _compactNonAlnumSegment,
};
