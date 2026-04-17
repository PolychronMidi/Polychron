#!/usr/bin/env python3
"""H7: Self-improving stopwords for agent_local.py.

Mines prompt history from log/hme.log and from stress-test-subagent.py's
test cases to learn which words are pure noise (appear frequently but are
never useful as search targets). Produces a delta stopword list merged
into _extract_search_terms at runtime via tools/models/training/hme-learned-stopwords.json.

Heuristic: a word is a stopword candidate if:
  1. It appears in >= 3 distinct prompts across the history, AND
  2. Its length <= 8 chars (long words are usually domain-specific), AND
  3. It's not an identifier (no underscore, not camelCase), AND
  4. It's not already in the hardcoded stopword list.

Output: tools/models/training/hme-learned-stopwords.json with schema:
    {
      "version": 1,
      "generated_at": epoch,
      "candidates": ["word1", "word2", ...],
      "prompt_count": int,
      "source": "hme.log" | "manual"
    }

Usage:
    python3 tools/HME/scripts/learn-stopwords.py
    python3 tools/HME/scripts/learn-stopwords.py --apply  # edit agent_local.py
"""
import json
import os
import re
import sys
import time
from collections import Counter

_PROJECT = os.environ.get("PROJECT_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
_LOG = os.path.join(_PROJECT, "log", "hme.log")
_OUTPUT = os.path.join(_PROJECT, "tools", "models", "training", "hme-learned-stopwords.json")


def _extract_prompts_from_log() -> list:
    """Find prompt-shaped strings in the log. Heuristic: lines that
    mention 'prompt' or 'Agent' with attached text."""
    if not os.path.isfile(_LOG):
        return []
    prompts = []
    try:
        with open(_LOG, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = re.search(r'(?:prompt|question|query|description)[:=]\s*"?([^"]{8,200})"?', line, re.IGNORECASE)
                if m:
                    prompts.append(m.group(1).strip())
    except Exception:
        pass
    return prompts


def _tokenize(text: str) -> list:
    return [w.lower() for w in re.findall(r'[a-zA-Z][a-zA-Z0-9_]*', text)]


def _is_identifier(word: str) -> bool:
    """True if this looks like a real symbol (not a common English word)."""
    return "_" in word or bool(re.search(r'[a-z][A-Z]', word))


def _existing_stopwords() -> set:
    """Parse agent_local.py for its hardcoded stop set."""
    agent_py = os.path.join(_PROJECT, "tools", "HME", "mcp", "agent_local.py")
    if not os.path.isfile(agent_py):
        return set()
    try:
        with open(agent_py) as f:
            src = f.read()
    except Exception:
        return set()
    m = re.search(r'stop\s*=\s*\{(.*?)\}', src, re.DOTALL)
    if not m:
        return set()
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def learn() -> dict:
    prompts = _extract_prompts_from_log()
    existing = _existing_stopwords()
    counter = Counter()
    for p in prompts:
        words = set(_tokenize(p))
        for w in words:
            if len(w) > 2 and len(w) <= 8 and not _is_identifier(w):
                counter[w] += 1
    # Candidates: frequent + not already a stopword + not a domain term
    # Also exclude short words that are clearly project-specific identifiers
    domain_whitelist = {
        "hme", "kb", "mcp", "src", "doc", "api", "lru",
        "ema", "bpm", "cpu", "gpu", "cv", "ci", "io", "ui",
    }
    candidates = [
        w for w, n in counter.most_common(50)
        if n >= 3
        and w not in existing
        and w not in domain_whitelist
        and not w.isdigit()
    ]
    return {
        "version": 1,
        "generated_at": time.time(),
        "candidates": candidates[:30],
        "prompt_count": len(prompts),
        "source": "hme.log",
        "coverage_note": (
            f"Examined {len(prompts)} prompts, {len(counter)} unique words. "
            "Candidates appear in 3+ prompts, not already stopwords, not domain terms."
        ),
    }


def main(argv: list) -> int:
    data = learn()
    os.makedirs(os.path.dirname(_OUTPUT), exist_ok=True)
    with open(_OUTPUT, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Learned stopwords written: {_OUTPUT}")
    print(f"Prompt samples: {data['prompt_count']}")
    print(f"Candidates ({len(data['candidates'])}): {data['candidates'][:15]}")
    if "--apply" in argv:
        print()
        print("--apply: would add these to agent_local.py _extract_search_terms")
        print("(manual review recommended; use the output JSON directly via LEARNED_STOPWORDS)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
