#!/usr/bin/env python3
"""Synthesize DRAFT generalizations into actual universal claims.

Reads hme-generalizations.json (crystallized patterns with DRAFT templates),
calls the HME reasoning cascade to produce project-agnostic formalizations
for each candidate, and writes the results back. render-generalizations.py
then formats them for doc/hme-discoveries.md.

This is the step that transforms raw pattern data into genuine intellectual
output — the system reasoning about what its own patterns mean universally.

Non-fatal diagnostic. Skips candidates that already have a non-DRAFT template.
Falls back gracefully if no synthesis provider is available.
"""
import json
import os
import sys
import urllib.request
import urllib.error

PROJECT = os.environ.get("PROJECT_ROOT", os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(PROJECT, "metrics", "hme-generalizations.json")
KB_PATH = os.path.join(PROJECT, ".claude", "mcp", "HME")

# Try local arbiter first, fall back to shim synthesis endpoint
ARBITER_URL = os.environ.get("HME_LLAMACPP_ARBITER_URL", "http://127.0.0.1:8080")
SHIM_URL = f"http://127.0.0.1:{os.environ.get('HME_SHIM_PORT', '7734')}"


def load_kb_entries_for_pattern(pattern):
    """Load the KB entries that are members of this crystallized pattern."""
    member_ids = pattern.get("member_ids", [])
    if not member_ids:
        return []
    # Try loading from lance DB
    try:
        import lancedb
        db = lancedb.connect(KB_PATH)
        tbl = db.open_table("knowledge")
        df = tbl.to_pandas()
        matches = df[df["id"].isin(member_ids)]
        return [row.get("content", "") for _, row in matches.iterrows()]
    except Exception:
        return []


def synthesize_one(pattern, kb_texts):
    """Ask the reasoning cascade to formalize one pattern."""
    pid = pattern["pattern_id"]
    tags = pattern.get("shared_tags", [])
    rounds = pattern.get("rounds", [])
    members = pattern.get("member_count", 0)

    prompt = f"""You are extracting a universal principle from a specific software project's evolution history.

The project Polychron is a JavaScript algorithmic composition system. Its HME (Hypermeta) layer has crystallized the following recurring pattern across {len(rounds)} rounds of evolution:

Pattern: {pid}
Tags: {', '.join(tags)}
Observed in rounds: {', '.join(rounds[:8])}
KB entries ({members} members):
{chr(10).join(f'  - {t[:300]}' for t in kb_texts[:5])}

Your task: rewrite this as a UNIVERSAL structural claim that would apply to ANY complex adaptive system with similar topology. Strip ALL Polychron-specific names (module names, file paths, subsystem names). Use abstract structural terms only.

Format your answer as a single paragraph, no more than 3 sentences. Start with the structural pattern, then the outcome it produces, then the condition under which it holds.

Example: "Bidirectional coupling between structurally anti-correlated subsystems converts destructive interference into constructive opposition, producing emergent behavior that neither subsystem could generate alone. This holds when the coupling strength is calibrated to the anti-correlation magnitude rather than fixed."

Write ONLY the generalization. No preamble, no explanation."""

    body = json.dumps({
        "model": "hme-arbiter",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 200,
        "temperature": 0.3,
    }).encode()

    # Try arbiter
    for url in [f"{ARBITER_URL}/v1/chat/completions", f"{SHIM_URL}/synthesize"]:
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
            # OpenAI format
            choices = data.get("choices", [])
            if choices:
                text = choices[0].get("message", {}).get("content", "").strip()
                if text and len(text) > 30:
                    return text
        except Exception:
            continue

    return None


def main():
    if not os.path.isfile(SRC):
        print(f"synthesize-generalizations: {SRC} not found, skipping")
        return

    with open(SRC) as f:
        data = json.load(f)

    patterns = data.get("patterns", [])
    candidates = [p for p in patterns if p.get("is_generalization_candidate")]

    synthesized = 0
    skipped = 0

    for c in candidates:
        template = c.get("template", "")
        # Skip if already synthesized (not a DRAFT)
        if template and "[DRAFT]" not in template and "<<STRUCTURE>>" not in template:
            skipped += 1
            continue

        kb_texts = load_kb_entries_for_pattern(c)
        result = synthesize_one(c, kb_texts)

        if result:
            c["template"] = result
            c["synthesis_source"] = "reasoning_cascade"
            synthesized += 1
        else:
            # Keep DRAFT template, mark as attempted
            c["synthesis_attempted"] = True

    # Write back
    with open(SRC, "w") as f:
        json.dump(data, f, indent=2)

    print(f"synthesize-generalizations: {synthesized} synthesized, {skipped} already done, "
          f"{len(candidates) - synthesized - skipped} failed/skipped")


if __name__ == "__main__":
    main()
