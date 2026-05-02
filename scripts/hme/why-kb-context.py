#!/usr/bin/env python3
"""i/why mode=kb-context <entry-id-or-prefix> -- Horizon III expansion.

Pairs with `i/why mode=kb-graph` (graph stats). This view is per-entry:
given an entry ID (or 8-char prefix), traverses outgoing + incoming
citation edges and surfaces the entry's full context -- what it cites,
what cites it, supersedes/superseded-by, related-by-category.

Today the KB has 0 live citation edges (kb-graph reports), so this
view returns mostly the entry itself + same-category neighbors. As
future entries land with `tags=supersedes:<id>` / `derived_from:<id>`
the traversal becomes meaningfully populated.

Why ship now: establishes the API + traversal pattern so future tools
that *write* citations (e.g. `i/learn add` with auto-detected
predecessors) have a reader on the other side."""
from __future__ import annotations
import os
import re
import sys
from collections import defaultdict

from _common import PROJECT_ROOT


def _load_kb() -> list[dict]:
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "tools", "HME", "service"))
    try:
        from direct_lance import _open_table  # type: ignore
    except Exception:
        return []
    table = _open_table()
    if table is None:
        return []
    try:
        df = table.to_pandas()
    except Exception:
        return []
    return df.to_dict(orient="records")


def main(argv):
    target = ""
    for a in argv[1:]:
        if a.startswith("id=") or a.startswith("entry="):
            target = a.split("=", 1)[1]
        elif not a.startswith("mode=") and not a.startswith("--"):
            target = a
    if not target:
        print("# i/why mode=kb-context <entry-id-or-prefix>")
        print()
        print("Traverses citation edges + same-category neighbors from one entry.")
        print()
        print("Usage:")
        print("  i/why mode=kb-context 9d8440e7        (8-char prefix accepted)")
        print("  i/why mode=kb-context 9d8440e70570    (full 12-char id)")
        return 2

    rows = _load_kb()
    if not rows:
        print(f"# i/why mode=kb-context {target}")
        print("KB empty or lance access unavailable.")
        return 1

    # Index entries
    by_id: dict[str, dict] = {}
    by_prefix: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        kid = str(r.get("id", "")).lower()
        if not kid:
            continue
        by_id[kid] = r
        # Index 8-char prefix for short matches
        if len(kid) >= 8:
            by_prefix[kid[:8]].append(kid)

    # Resolve target -- exact, prefix, or fuzzy
    target_lower = target.lower()
    resolved = None
    if target_lower in by_id:
        resolved = target_lower
    elif target_lower in by_prefix:
        if len(by_prefix[target_lower]) == 1:
            resolved = by_prefix[target_lower][0]
        else:
            print(f"# i/why mode=kb-context {target}")
            print(f"  Prefix '{target_lower}' is ambiguous -- matches:")
            for kid in by_prefix[target_lower]:
                title = str(by_id[kid].get("title", ""))[:60]
                print(f"    [{kid[:8]}]  {title}")
            return 1
    if resolved is None:
        # Try fuzzy on title
        from difflib import get_close_matches
        titles = [str(r.get("title", "")) for r in rows]
        matches = get_close_matches(target, titles, n=3, cutoff=0.4)
        print(f"# i/why mode=kb-context {target}")
        print(f"  No entry with id or 8-char prefix '{target}'.")
        if matches:
            print(f"  Did you mean (by title)?")
            for t in matches:
                for r in rows:
                    if str(r.get("title", "")) == t:
                        kid = str(r.get("id", ""))
                        print(f"    [{kid[:8]}]  {t[:60]}")
                        break
        return 1

    entry = by_id[resolved]
    title = str(entry.get("title", ""))
    cat = str(entry.get("category", ""))
    tags = str(entry.get("tags", ""))
    content = str(entry.get("content", ""))

    print(f"# KB context -- [{resolved[:8]}] {title[:60]}")
    print(f"  category: {cat}  tags: {tags or '(none)'}")
    print()
    # Content preview
    print(f"## Content (first 400 chars)")
    print(f"  {content[:400]}{'...' if len(content) > 400 else ''}")
    print()

    # Outgoing edges from tags
    tag_id_re = re.compile(r"(\w+):([a-f0-9]{12})\b")
    out_links = tag_id_re.findall(tags.lower())
    if out_links:
        print(f"## Outgoing tag-edges ({len(out_links)})")
        for kind, target_id in out_links:
            target_row = by_id.get(target_id)
            if target_row:
                t_title = str(target_row.get("title", ""))[:50]
                print(f"  --{kind}--> [{target_id[:8]}] {t_title}")
            else:
                print(f"  --{kind}--> [{target_id[:8]}] (missing -- superseded entry was removed)")
        print()

    # Incoming edges (entries whose tags point to this one)
    incoming = []
    for r in rows:
        r_tags = str(r.get("tags", "")).lower()
        for kind, t_id in tag_id_re.findall(r_tags):
            if t_id == resolved:
                incoming.append((kind, str(r.get("id", "")), str(r.get("title", ""))))
    if incoming:
        print(f"## Incoming tag-edges ({len(incoming)})")
        for kind, src_id, src_title in incoming:
            print(f"  [{src_id[:8]}] {src_title[:48]}  --{kind}--> (this)")
        print()

    # Same-category neighbors
    same_cat = [r for r in rows
                if str(r.get("category", "")) == cat
                and str(r.get("id", "")).lower() != resolved]
    if same_cat:
        print(f"## Same-category siblings ({len(same_cat)} in '{cat}'):")
        for r in same_cat[:6]:
            r_id = str(r.get("id", ""))
            r_title = str(r.get("title", ""))[:55]
            print(f"  [{r_id[:8]}] {r_title}")
        if len(same_cat) > 6:
            print(f"  (+{len(same_cat) - 6} more)")
        print()

    if not out_links and not incoming:
        print("# Note:")
        print("  This entry has no explicit tag-encoded relations. Today's KB is")
        print("  mostly flat (see `i/why mode=kb-graph` for the system-wide view).")
        print("  Future entries that cite this one should use:")
        print(f"    tags=supersedes:{resolved}      (this entry is being replaced)")
        print(f"    tags=derived_from:{resolved}    (this entry inspired the new one)")
        print(f"    tags=contradicts:{resolved}     (opposing position to this)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
