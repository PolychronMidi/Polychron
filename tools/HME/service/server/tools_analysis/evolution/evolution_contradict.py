"""Evolution strategies -- curate, contradict, adversarial stress.

Split from evolution_evolve.py. These are the heavy analysis functions
that each focus on a different evolution mode.
"""
import os
import re
import json
import logging

from server import context as ctx
from .. import _track, _budget_gate, BUDGET_COMPOUND, BUDGET_TOOL

logger = logging.getLogger("HME")




def _detect_contradictions() -> str:
    """Full KB contradiction scan -- find entries that are related but conflicting.

    Two passes: (1) semantic similarity band for topically-related pairs,
    (2) same-category pairs with shared title keywords (catches rephrased conflicts).
    """
    import numpy as np
    import re

    entries = ctx.project_engine.list_knowledge_full()
    if len(entries) < 2:
        return "# Contradiction Scan\n\nToo few KB entries for contradiction detection."

    valid_entries = []
    vectors = []
    for e in entries:
        embed_text = f"{e['title']}\n{e['content']}"
        v = ctx.project_engine.model.encode(embed_text)
        if v is None or not hasattr(v, 'shape') or v.ndim != 1:
            continue
        valid_entries.append(e)
        vectors.append(v)

    if len(vectors) < 2:
        return "# Contradiction Scan\n\nToo few valid embeddings (shim may be unavailable)."
    entries = valid_entries
    vectors = np.array(vectors)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normalized = vectors / norms
    sim_matrix = np.dot(normalized, normalized.T)

    seen_pairs = set()
    candidates = []

    # Pass 1: similarity band -- topically related but not redundant
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            sim = float(sim_matrix[i, j])
            if 0.30 < sim < 0.85:
                candidates.append((i, j, sim))
                seen_pairs.add((i, j))

    # Pass 2: same-category + shared title keywords (catches rephrased conflicts)
    def _title_tokens(t):
        return {w.lower() for w in re.findall(r'[a-zA-Z]{4,}', t)
                if w.lower() not in {"with", "from", "that", "this", "legendary", "round"}}

    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if (i, j) in seen_pairs:
                continue
            if entries[i].get("category") != entries[j].get("category"):
                continue
            ti, tj = _title_tokens(entries[i]["title"]), _title_tokens(entries[j]["title"])
            overlap = ti & tj
            if len(overlap) >= 2:
                sim = float(sim_matrix[i, j])
                if sim > 0.25:
                    candidates.append((i, j, sim))

    candidates.sort(key=lambda x: -x[2])

    # Skip pairs linked by synthesizes/supersedes/clarifies relations,
    # or where one entry's title contains the other's round identifier (arc entries)
    _skip_relations = {"synthesizes", "supersedes", "clarifies"}
    def _has_relation(a, b):
        a_tags = (a.get("tags") or "").split(",")
        b_tags = (b.get("tags") or "").split(",")
        for tag in a_tags + b_tags:
            rel = tag.strip().split(":", 1)[0]
            if rel in _skip_relations:
                return True
        # Skip if both entries share round identifiers (same-round coverage)
        a_rounds = set(re.findall(r'\bR(\d+)\b', a["title"]))
        b_rounds = set(re.findall(r'\bR(\d+)\b', b["title"]))
        if a_rounds and b_rounds and (a_rounds & b_rounds):
            return True
        return False
    candidates = [(i, j, s) for i, j, s in candidates if not _has_relation(entries[i], entries[j])]

    candidates = candidates[:20]

    if not candidates:
        return "# Contradiction Scan\n\nNo related-but-distinct entry pairs found. KB is internally consistent at the semantic level."

    from ..synthesis_inference import _local_think
    from ..synthesis_llamacpp import _LOCAL_MODEL

    # Batch into groups of 5 for LLM checking (keeps prompt focused)
    all_contradictions = []
    for batch_start in range(0, len(candidates), 5):
        batch = candidates[batch_start:batch_start + 5]
        batch_items = []
        for idx, (i, j, sim) in enumerate(batch):
            a, b = entries[i], entries[j]
            batch_items.append(
                f"PAIR {idx + 1} (similarity={sim:.2f}):\n"
                f"  A [{a['id']}] \"{a['title']}\" (category: {a.get('category', '?')}):\n"
                f"    {a['content'][:400]}\n"
                f"  B [{b['id']}] \"{b['title']}\" (category: {b.get('category', '?')}):\n"
                f"    {b['content'][:400]}\n"
            )

        prompt = (
            "Analyze these knowledge base entry pairs for GENUINE contradictions.\n\n"
            "CONTRADICT means: two entries make INCOMPATIBLE claims about the SAME specific thing.\n"
            "Examples of real contradictions:\n"
            "- Entry A says 'module X should INCREASE density' vs Entry B says 'module X should DECREASE density'\n"
            "- Entry A says 'this bug is fixed' vs Entry B says 'this bug still exists'\n"
            "- Entry A says 'use approach X for this' vs Entry B says 'never use approach X for this'\n\n"
            "NOT contradictions (mark OK):\n"
            "- Entries about DIFFERENT rounds, modules, or coupling pairs (even if they mention the same signal)\n"
            "- A bugfix entry + an architecture entry about the same system (bug was fixed, architecture describes normal state)\n"
            "- One entry mentions something the other doesn't (omission is NOT contradiction)\n"
            "- Entries that ADD to each other (complementary coupling bridges, different aspects)\n"
            "- Entries from different time periods that reflect evolution (later supersedes earlier)\n"
            "- Entries that describe different modules interacting with the same signal differently\n"
            "- Different coupling bridges involving the same module but different partners or dimensions\n\n"
            + "\n".join(batch_items) + "\n\n"
            "For each pair, respond with EXACTLY one line:\n"
            "PAIR N: CONTRADICT -- <the specific incompatible claims>\n"
            "or\n"
            "PAIR N: OK\n"
            "Nothing else."
        )

        result = _local_think(
            prompt, max_tokens=400, model=_LOCAL_MODEL,
            system="You are a strict KB consistency auditor. You RARELY flag contradictions -- only when two entries make genuinely incompatible claims about the same specific thing. When in doubt, say OK.",
            temperature=0.05,
        )

        if result:
            omission_markers = ["without mention", "doesn't mention", "not mention",
                                "does not mention", "no mention", "without specif",
                                "not directly", "without indicating",
                                "no genuine contra", "no contradiction", "not a contra",
                                "no real contra", "consistently", "no conflict"]
            for line in result.strip().splitlines():
                line = line.strip()
                if "CONTRADICT" in line:
                    try:
                        pair_num = int(line.split("PAIR")[1].split(":")[0].strip()) - 1
                        explanation = line.split("CONTRADICT")[1].strip().lstrip("--").lstrip("-").strip()
                        if any(m in explanation.lower() for m in omission_markers):
                            continue
                        if 0 <= pair_num < len(batch):
                            i, j, sim = batch[pair_num]
                            all_contradictions.append({
                                "a": entries[i], "b": entries[j],
                                "sim": sim, "explanation": explanation,
                            })
                    except (ValueError, IndexError):
                        continue

    parts = [f"# Contradiction Scan: {len(entries)} entries, {len(candidates)} pairs checked\n"]

    if not all_contradictions:
        parts.append("No contradictions detected. KB is internally consistent.")
    else:
        parts.append(f"**{len(all_contradictions)} contradiction(s) found:**\n")
        for c in all_contradictions:
            a, b = c["a"], c["b"]
            parts.append(f"## [{a['id']}] \"{a['title']}\"  vs  [{b['id']}] \"{b['title']}\"")
            parts.append(f"  Similarity: {c['sim']:.2f} | Categories: {a.get('category', '?')}/{b.get('category', '?')}")
            parts.append(f"  Conflict: {c['explanation']}")
            parts.append(f"  Resolution options:")
            parts.append(f"    1. Supersede older: learn(title=..., related_to='{a['id']}', relation_type='supersedes')")
            parts.append(f"    2. Tag contradiction: learn(title=..., related_to='{a['id']}', relation_type='contradicts')")
            parts.append(f"    3. Remove stale: remove_knowledge(entry_id='{a['id']}') or '{b['id']}'")
            parts.append("")

    # Code-vs-KB grounding: for hme-infrastructure entries, verify key backtick-quoted
    # symbols still exist in the actual HME server codebase. Stale entries are flagged.
    code_mismatches = []
    try:
        import subprocess as _sp_cgrep
        _server_root = os.path.join(ctx.PROJECT_ROOT, "tools", "HME", "service", "server")
        for _e in entries:
            _cat = _e.get("category", "")
            _tags = _e.get("tags", "")
            if _cat != "hme-infrastructure" and "hme-infrastructure" not in _tags:
                continue
            _body = _e.get("content", "")
            # Extract backtick-quoted identifiers (function/class names)
            _claimed = re.findall(r'`([a-zA-Z_]\w{3,})`', _body)[:4]
            if not _claimed:
                continue
            for _sym in _claimed:
                _gr = _sp_cgrep.run(
                    ["grep", "-rql", "--include=*.py", _sym, _server_root],
                    capture_output=True, text=True, timeout=3
                )
                if _gr.returncode != 0 or not _gr.stdout.strip():
                    code_mismatches.append({
                        "id": _e["id"], "title": _e["title"], "symbol": _sym,
                    })
                    break  # one mismatch per entry is sufficient
    except Exception as _err3:
        logger.debug(f'silent-except evolution_evolve.py:611: {type(_err3).__name__}: {_err3}')

    if code_mismatches:
        parts.append(f"\n## Code-vs-KB Grounding ({len(code_mismatches)} stale claim(s))\n")
        for _m in code_mismatches:
            parts.append(f"  [{_m['id']}] \"{_m['title']}\"")
            parts.append(f"    Symbol `{_m['symbol']}` not found in tools/HME/service/server/")
            parts.append(f"    -> Verify manually: grep -r '{_m['symbol']}' tools/HME/service/server/")
            parts.append(f"    -> If removed: remove_knowledge(entry_id='{_m['id']}')")
            parts.append("")

    return "\n".join(parts)


