#!/usr/bin/env python3
"""i/why mode=causality <event-name> — Horizon VII seed.

The full Horizon VII vision: every state-changing action records its
`caused_by` reference, and `i/why <observed-effect>` walks the chain
to root. That requires touching every emit site to add the field —
big lift.

This seed approximates causality from data already present: the
activity log's `session` field naturally groups events causally
(same Claude turn). Within a session, events are temporally adjacent
and most often causally related.

Algorithm: given an event-name, find recent occurrences, group by
session, surface the events that fired in the same session window
just before each occurrence. That's a heuristic causal context — the
agent reads the chain and synthesizes.

The seed teaches the eventual instrumentation what shape it needs:
explicit `caused_by` would replace the heuristic with a hard fact.
"""
from __future__ import annotations
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime

from _common import PROJECT_ROOT


def main(argv):
    target_event = ""
    show_n = 5
    for a in argv[1:]:
        if a.startswith("event="):
            target_event = a.split("=", 1)[1]
        elif a.startswith("n="):
            try:
                show_n = int(a.split("=", 1)[1])
            except ValueError:
                pass
        elif not a.startswith("mode=") and not a.startswith("--"):
            target_event = a
    if not target_event:
        print("# i/why mode=causality <event-name>")
        print()
        print("Surfaces the causal chain leading to recent occurrences of")
        print("<event-name>. Two-tier resolution:")
        print("  1. If a marker file with explicit caused_by exists for this")
        print("     event, use that (Horizon VII real instrumentation).")
        print("  2. Otherwise, fall back to same-session temporal-adjacency")
        print("     heuristic (8 events back in same session).")
        print()
        print("Examples:")
        print("  i/why mode=causality auto_brief_injected")
        print("  i/why mode=causality hot_reload    (uses explicit caused_by)")
        return 2

    # Tier-1: explicit caused_by from marker files (Horizon VII
    # instrumentation). Hot-reload writes tmp/hme-last-reload.json with
    # caused_by when triggered by fs_watcher. As more sites add explicit
    # caused_by, expand this catalogue.
    marker_catalog = {
        "hot_reload": "tmp/hme-last-reload.json",
    }
    if target_event in marker_catalog:
        marker_path = os.path.join(PROJECT_ROOT, marker_catalog[target_event])
        if os.path.isfile(marker_path):
            try:
                with open(marker_path) as _mf:
                    marker = json.load(_mf)
            except (OSError, ValueError):
                marker = None
            if marker:
                ts = marker.get("ts", 0)
                ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else "?"
                has_explicit = "caused_by" in marker
                tier_label = "Tier-1: explicit caused_by" if has_explicit else "Tier-1: marker without caused_by"
                print(f"# Causal chain — '{target_event}' ({tier_label})")
                print()
                print(f"## Latest occurrence at {ts_str}")
                print(f"  trigger:    {marker.get('trigger', '?')}")
                if has_explicit:
                    print(f"  caused_by:  {marker['caused_by']}")
                else:
                    print(f"  caused_by:  (not recorded — only auto-reloads from fs_watcher carry caused_by)")
                print(f"  summary:    {marker.get('summary', '')[:120]}")
                print(f"  ▶  {target_event}")
                print()
                print("# Note:")
                print("  This is the explicit-instrumentation path (Horizon VII real")
                print("  caused_by). Manual reloads don't carry caused_by since the")
                print("  trigger is the operator. Watcher-driven auto-reloads do.")
                return 0

    activity = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-activity.jsonl")
    if not os.path.isfile(activity):
        print(f"# i/why mode=causality {target_event}\nNo activity log.")
        return 1

    # Read all events; group by session for causal-window lookup. Events
    # without a session field are common (proxy-internal events emitted
    # outside an agent turn); group them under "no-session" rather than
    # "?" so the output is more readable.
    by_session: dict[str, list[dict]] = defaultdict(list)
    with open(activity) as f:
        for ln in f:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            sess = e.get("session") or "no-session"
            if not sess or sess == "?":
                sess = "no-session"
            by_session[sess].append(e)

    # Find target-event occurrences (most recent first)
    occurrences = []
    for sess, events in by_session.items():
        for i, e in enumerate(events):
            if e.get("event") == target_event:
                occurrences.append({"session": sess, "idx": i, "ts": e.get("ts", 0), "event": e})
    if not occurrences:
        print(f"# i/why mode=causality {target_event}")
        print(f"No '{target_event}' events found in activity log.")
        return 0
    occurrences.sort(key=lambda o: -o["ts"])

    print(f"# Heuristic causal chain — '{target_event}'")
    print(f"  ({len(occurrences)} occurrence(s); showing last {min(show_n, len(occurrences))})")
    print()

    for occ in occurrences[:show_n]:
        sess = occ["session"]
        idx = occ["idx"]
        ts = occ["ts"]
        events = by_session[sess]
        ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else "?"
        # Walk back up to 8 events in same session, capturing the causal chain
        prior = events[max(0, idx - 8):idx]
        sess_label = sess if sess == "no-session" else sess[:8]
        print(f"## Occurrence at {ts_str}  (session {sess_label}, +{len(prior)} events prior)")
        for p in prior:
            p_ts = p.get("ts", 0)
            p_age = ts - p_ts if p_ts else 0
            ev = p.get("event", "?")
            src = p.get("source", p.get("session", ""))[:18]
            tag = ""
            if "tool" in p:
                tag = f"  tool={p['tool']}"
            elif p.get("file"):
                f_short = str(p['file']).rsplit("/", 1)[-1][:30]
                tag = f"  file={f_short}"
            print(f"  -{p_age:>3.0f}s  {ev:24}  {src}{tag}")
        # The target event itself
        print(f"  ▶  {target_event}  (this event)")
        print()

    print("# Note:")
    print("  This is heuristic — events in the same session within seconds")
    print("  are usually causally related but not always. The full Horizon VII")
    print("  vision adds explicit `caused_by` to each emit site so the chain")
    print("  becomes a hard fact rather than a temporal-adjacency guess.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
