#!/usr/bin/env python3
"""i/why mode=kb-graph — Horizon III seed.

Surfaces the implicit citation structure of the knowledge base. Each KB
entry has a 12-char hex `knowledge_id`. When one entry's content
mentions another entry's ID, that's a citation edge — directed,
queryable, traversable.

Today the KB is queried by vector similarity. After this seed it is
ALSO queryable by structural relation: which entries cite this one,
which entries does it cite, what cluster does it sit in.

Output:
  - total entries, citation-edge count
  - hubs (most-cited entries — top 5)
  - orphans (no incoming or outgoing edges — candidates for cleanup)
  - top citation chains (longest connected paths)

Direct lance access — bypasses the proxy/daemon. If lancedb isn't
importable or the KB is empty, surfaces the gap honestly.
"""
from __future__ import annotations
import os
import re
import sys
from collections import defaultdict

from _common import PROJECT_ROOT


def _load_kb() -> list[dict]:
    """Read all KB entries via direct lance access."""
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "service"))
    try:
        from direct_lance import _open_table  # type: ignore
    except Exception as e:
        print(f"# i/why mode=kb-graph\nFailed to import direct_lance: {e}")
        return []
    table = _open_table()
    if table is None:
        return []
    try:
        df = table.to_pandas()
    except Exception:
        return []
    return df.to_dict(orient="records")


def _extract_id_refs(content: str, all_ids: set[str], own_id: str) -> set[str]:
    """Find 12-char hex strings in content that match other entry IDs.
    Excludes self-references."""
    if not isinstance(content, str):
        return set()
    candidates = set(re.findall(r"\b[a-f0-9]{12}\b", content.lower()))
    return (candidates & all_ids) - {own_id.lower()}


def _extract_title_refs(content: str, title_to_id: dict[str, str], own_id: str,
                        min_title_len: int = 25) -> set[str]:
    """Find substring mentions of other entries' titles in content.
    Filters: title must be ≥ min_title_len chars (avoids matching common
    short phrases). Excludes self-references."""
    if not isinstance(content, str):
        return set()
    found = set()
    body = content.lower()
    for title, kid in title_to_id.items():
        if kid == own_id.lower() or len(title) < min_title_len:
            continue
        # Title appears verbatim as a substring; case-insensitive
        if title.lower() in body:
            found.add(kid)
    return found


def main(argv):
    rows = _load_kb()
    if not rows:
        print("# i/why mode=kb-graph")
        print("KB empty or lance access unavailable. Use `i/learn action=add ...` to populate.")
        return 1

    # Index by id (column name varies across schema versions —
    # "id" in current lance schema, "knowledge_id" in some older tools).
    all_ids = set()
    by_id = {}
    for r in rows:
        kid = str(r.get("id") or r.get("knowledge_id") or "").lower()
        if kid:
            all_ids.add(kid)
            by_id[kid] = r

    # Title-keyed index for substring matching (citation by name)
    title_to_id: dict[str, str] = {}
    for kid, row in by_id.items():
        title = str(row.get("title", "")).strip()
        if title and len(title) >= 25:
            title_to_id[title] = kid

    # Build edges: source-id → set of target-ids. Combines three signals:
    # 1. Tag-encoded references like `supersedes:abc123def456`. Sparse
    #    today (~3 entries use them) but explicit and machine-trusted.
    # 2. Exact-ID references in content (rare in this KB; absent in
    #    current snapshot but the regex stays for future entries).
    # 3. Title-substring matches (heuristic; 0 hits in current data —
    #    confirms entries don't quote each other's titles verbatim).
    out_edges: dict[str, set[str]] = defaultdict(set)
    in_edges: dict[str, set[str]] = defaultdict(set)
    edge_kinds: dict[tuple[str, str], set[str]] = defaultdict(set)
    # Dangling edges: tag-encoded refs that point to entries no longer in
    # the KB. Real signal — when a `supersedes:` target is gone, the
    # supersession-history is preserved on the surviving entry alone.
    dangling: list[tuple[str, str, str]] = []  # (source_id, kind, missing_target)
    tag_id_re = re.compile(r"(\w+):([a-f0-9]{12})\b")
    for kid, row in by_id.items():
        content = str(row.get("content", ""))
        title_self = str(row.get("title", ""))
        tags = str(row.get("tags", ""))
        # Tag-encoded relations (supersedes, contradicts, derived_from, ...)
        for kind, target in tag_id_re.findall(tags.lower()):
            if target == kid.lower():
                continue
            if target in all_ids:
                out_edges[kid].add(target)
                in_edges[target].add(kid)
                edge_kinds[(kid, target)].add(kind)
            else:
                dangling.append((kid, kind, target))
        # ID-based refs in content (precise when present)
        for target in _extract_id_refs(content + " " + title_self, all_ids, kid):
            out_edges[kid].add(target)
            in_edges[target].add(kid)
            edge_kinds[(kid, target)].add("content-ref")
        # Title-substring refs (heuristic; commonly 0 in this KB)
        for target in _extract_title_refs(content, title_to_id, kid):
            out_edges[kid].add(target)
            in_edges[target].add(kid)
            edge_kinds[(kid, target)].add("title-quote")

    n = len(by_id)
    n_edges = sum(len(v) for v in out_edges.values())
    n_with_out = len(out_edges)
    n_with_in = len(in_edges)

    print(f"# KB citation graph ({n} entries, {n_edges} edges)")
    print()
    print(f"  entries with outgoing citations:  {n_with_out}")
    print(f"  entries with incoming citations:  {n_with_in}")

    # Honest finding: the KB's citation density is a real architectural
    # signal. If almost everything is an orphan, that means new entries
    # rarely cite earlier ones — entries land as flat data points rather
    # than woven into the existing graph. Future entries should use the
    # `tags` field with `supersedes:<id>` / `contradicts:<id>` /
    # `derived_from:<id>` to build the graph as it grows.
    if n_edges > 0:
        edge_kind_count: dict[str, int] = defaultdict(int)
        for kinds in edge_kinds.values():
            for k in kinds:
                edge_kind_count[k] += 1
        print(f"  edge kinds:  " + ", ".join(
            f"{k}={v}" for k, v in sorted(edge_kind_count.items(), key=lambda kv: -kv[1])
        ))
    citation_pct = (n_with_out + n_with_in) / (2 * n) * 100 if n else 0
    if citation_pct < 5:
        print(f"  citation density: {citation_pct:.1f}% of entries are connected — "
              f"the KB is mostly flat. Future entries should use `tags=supersedes:<id>` / "
              f"`contradicts:<id>` / `derived_from:<id>` to weave new knowledge into the graph.")

    # Hubs: most-cited entries
    if in_edges:
        hubs = sorted(in_edges.items(), key=lambda kv: -len(kv[1]))[:5]
        print()
        print(f"## Hubs (top 5 most-cited):")
        for kid, sources in hubs:
            row = by_id.get(kid, {})
            title = str(row.get("title", ""))[:60]
            print(f"  [{kid[:8]}] cited by {len(sources)}  · {title}")

    # Orphans: no in or out edges. Group by category for actionability.
    orphans = [kid for kid in by_id if kid not in out_edges and kid not in in_edges]
    if orphans:
        by_cat: dict[str, list[str]] = defaultdict(list)
        for kid in orphans:
            cat = str(by_id[kid].get("category", "?"))
            by_cat[cat].append(kid)
        print()
        print(f"## Orphans by category ({len(orphans)} of {n}):")
        for cat, ids in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
            print(f"  {cat:14}  {len(ids)} entries")

    # Citation chains (longest paths) — simple BFS from each entry
    if out_edges:
        def _longest_from(start: str, visited: set[str]) -> list[str]:
            best: list[str] = [start]
            for nxt in out_edges.get(start, set()):
                if nxt in visited:
                    continue
                path = [start] + _longest_from(nxt, visited | {nxt})
                if len(path) > len(best):
                    best = path
            return best
        chains = []
        for kid in by_id:
            try:
                p = _longest_from(kid, {kid})
                if len(p) >= 2:
                    chains.append(p)
            except RecursionError:
                continue
        chains.sort(key=lambda p: -len(p))
        if chains:
            print()
            print(f"## Longest citation chain ({len(chains[0])} entries):")
            for kid in chains[0][:6]:
                title = str(by_id[kid].get("title", ""))[:50]
                print(f"  [{kid[:8]}]  {title}")
            if len(chains[0]) > 6:
                print(f"  ... ({len(chains[0]) - 6} more steps)")

    # Dangling edges — surfaced separately so the supersession history
    # doesn't get lost just because the prior entry was removed.
    if dangling:
        print()
        print(f"## Dangling edges ({len(dangling)}) — refs to entries no longer in KB:")
        for src, kind, missing in dangling[:8]:
            src_title = str(by_id[src].get("title", ""))[:50]
            print(f"  [{src[:8]}] {src_title:52}  --{kind}--> [{missing[:8]}](missing)")
        if len(dangling) > 8:
            print(f"  (+{len(dangling) - 8} more)")

    print()
    print("# Drill-in:")
    print("  i/learn action=search query=…    semantic search (vector)")
    print("  i/learn action=graph             semantic-cluster view (different lens)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
