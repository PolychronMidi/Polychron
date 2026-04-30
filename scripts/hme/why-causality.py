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
        print("Surfaces the heuristic causal chain leading to recent")
        print("occurrences of <event-name> by grouping same-session")
        print("events temporally before each occurrence.")
        print()
        print("Examples:")
        print("  i/why mode=causality auto_brief_injected")
        print("  i/why mode=causality bash_error_surfaced")
        return 2

    activity = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-activity.jsonl")
    if not os.path.isfile(activity):
        print(f"# i/why mode=causality {target_event}\nNo activity log.")
        return 1

    # Read all events; group by session for causal-window lookup
    by_session: dict[str, list[dict]] = defaultdict(list)
    with open(activity) as f:
        for ln in f:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            sess = e.get("session", "?")
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
        print(f"## Occurrence at {ts_str}  (session {sess[:8]}, +{len(prior)} events prior)")
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
