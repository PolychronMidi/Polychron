#!/usr/bin/env python3
"""i/why mode=causality <event-name> -- Horizon VII seed.

The full Horizon VII vision: every state-changing action records its
`caused_by` reference, and `i/why <observed-effect>` walks the chain
to root. That requires touching every emit site to add the field --
big lift.

This seed approximates causality from data already present: the
activity log's `session` field naturally groups events causally
(same Claude turn). Within a session, events are temporally adjacent
and most often causally related.

Algorithm: given an event-name, find recent occurrences, group by
session, surface the events that fired in the same session window
just before each occurrence. That's a heuristic causal context -- the
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


def _resolve_cause(cause: str, before_ts: float, all_events: list[dict]) -> dict | None:
    """Given a caused_by value string, find an event that could be the
    upstream cause. Heuristics by prefix:
      - 'pretooluse_edit:<file>' / 'pretooluse_write:<file>' ->
        a tool_call event with file=<file> just before before_ts
      - 'pipeline_verdict:<V>' -> round_complete event with verdict=<V>
      - 'posttooluse_read_kb:<target>' -> file_written event with
        target as file or module
      - file path -> file_written event for that file
    Returns the closest preceding event matching, or None if no resolution."""
    if not cause or not isinstance(cause, str):
        return None
    # Walk backwards in time from before_ts looking for the resolved event.
    candidates = [e for e in all_events if e.get("ts", 0) < before_ts]
    candidates.sort(key=lambda e: e.get("ts", 0), reverse=True)

    # Pattern: source:target
    if ":" in cause:
        prefix, payload = cause.split(":", 1)
        if prefix in ("pretooluse_edit", "pretooluse_write"):
            for e in candidates:
                if e.get("event") == "tool_call" and e.get("file") == payload:
                    return e
                if e.get("event") == "file_written" and e.get("file") == payload:
                    return e
        if prefix == "pipeline_verdict":
            for e in candidates:
                if e.get("event") == "round_complete" and e.get("verdict") == payload:
                    return e
                if e.get("event") == "turn_complete":  # weaker fallback
                    return e
        # Generic source:target -- find an event matching the source name
        for e in candidates:
            if e.get("source") == prefix or e.get("event") == prefix:
                if not payload or payload in (e.get("target", ""), e.get("file", ""),
                                              e.get("module", "")):
                    return e

    # Bare file path (heuristic: contains '/' or ends in .py/.js/.sh)
    if "/" in cause or cause.endswith((".py", ".js", ".sh", ".ts")):
        for e in candidates:
            if e.get("file") == cause or e.get("target") == cause:
                return e

    # Bare event name
    for e in candidates:
        if e.get("event") == cause:
            return e

    return None


def main(argv):
    target_event = ""
    show_n = 5
    walk_chain = False
    root_cause_only = False
    chain_depth = 5
    for a in argv[1:]:
        if a.startswith("event="):
            target_event = a.split("=", 1)[1]
        elif a.startswith("n="):
            try:
                show_n = int(a.split("=", 1)[1])
            except ValueError:
                pass  # silent-ok: diagnostic; failure non-fatal
        elif a == "--chain" or a == "chain=true":
            walk_chain = True
        elif a == "--root-cause" or a == "root_cause=true":
            # Root-cause shorthand: walks the chain to terminal, prints
            walk_chain = True
            root_cause_only = True
        elif a.startswith("depth="):
            try:
                chain_depth = max(1, min(20, int(a.split("=", 1)[1])))
            except ValueError:
                pass  # silent-ok: diagnostic; failure non-fatal
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
                print(f"# Causal chain -- '{target_event}' ({tier_label})")
                print()
                print(f"## Latest occurrence at {ts_str}")
                print(f"  trigger:    {marker.get('trigger', '?')}")
                if has_explicit:
                    print(f"  caused_by:  {marker['caused_by']}")
                else:
                    print(f"  caused_by:  (not recorded -- only auto-reloads from fs_watcher carry caused_by)")
                print(f"  summary:    {marker.get('summary', '')[:120]}")
                print(f"  >  {target_event}")
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

    # Tier-1.5: explicit caused_by field on activity-log events themselves
    all_events = []
    explicit_chain_events = []
    try:
        with open(activity) as _af:
            for ln in _af:
                try:
                    e = json.loads(ln)
                except ValueError:
                    continue
                all_events.append(e)
                if e.get("event") == target_event and "caused_by" in e:
                    explicit_chain_events.append(e)
    except OSError:
        pass  # silent-ok: diagnostic; failure non-fatal  # silent-ok: best-effort fs op

    # Recursive chain mode -- walks caused_by references through layered
    if walk_chain and explicit_chain_events and root_cause_only:
        # Root-cause shorthand -- walk silently, print only the leaf.
        latest = explicit_chain_events[-1]
        current = latest
        depth = 0
        seen: set[tuple[str, float]] = set()
        leaf_event = current
        leaf_cause = current.get("caused_by", "")
        leaf_reason = "no further chain"
        while current and depth < chain_depth:
            ts = current.get("ts", 0)
            ev = current.get("event", "?")
            cb = current.get("caused_by", "")
            key = (ev, ts)
            if key in seen:
                leaf_reason = "cycle detected"
                break
            seen.add(key)
            if not cb:
                leaf_reason = "no caused_by -- terminal event"
                break
            leaf_cause = cb
            resolved = _resolve_cause(cb, ts, all_events)
            if resolved is None:
                leaf_reason = "leaf description (no upstream event match)"
                break
            current = resolved
            leaf_event = current
            depth += 1
        if depth >= chain_depth:
            leaf_reason = f"chain truncated at depth={chain_depth}"
        print(f"# Root cause -- '{target_event}'")
        print(f"  walked {depth} step(s), stopped because: {leaf_reason}")
        print(f"  root: caused_by={leaf_cause}")
        if leaf_event != latest:
            ts = leaf_event.get("ts", 0)
            ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else "?"
            ev = leaf_event.get("event", "?")
            print(f"  upstream event: {ev}  at {ts_str}")
        print()
        print("  (Use `--chain` to see the full traversal path.)")
        return 0

    if walk_chain and explicit_chain_events:
        print(f"# Recursive causal chain -- '{target_event}' (depth <= {chain_depth})")
        print()
        latest = explicit_chain_events[-1]
        current = latest
        depth = 0
        # Cycle detection: track (event, ts) tuples we've already visited.
        seen: set[tuple[str, float]] = set()
        while current and depth < chain_depth:
            ts = current.get("ts", 0)
            ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else "?"
            ev = current.get("event", "?")
            cb = current.get("caused_by", "")
            indent = "  " + ("  " * depth)
            arrow = ">" if depth == 0 else "+->"
            if cb:
                print(f"{indent}{arrow} {ts_str}  {ev:24}  caused_by={cb}")
            else:
                print(f"{indent}{arrow} {ts_str}  {ev:24}  (no caused_by -- terminal)")
            key = (ev, ts)
            if key in seen:
                indent2 = "  " + ("  " * (depth + 1))
                print(f"{indent2}+- (cycle detected -- already visited this event)")
                break
            seen.add(key)
            if not cb:
                break
            # Try to resolve caused_by to another event
            resolved = _resolve_cause(cb, ts, all_events)
            if resolved is None:
                indent2 = "  " + ("  " * (depth + 1))
                print(f"{indent2}+- (cause '{cb[:60]}' is a leaf description -- no upstream event match)")
                break
            current = resolved
            depth += 1
        if depth >= chain_depth:
            print(f"  (chain truncated at depth={chain_depth}; pass `depth=N` to extend)")
        print()
        print("# Note: heuristic resolution. Each step matches by prefix or file.")
        print("  Walks stop at leaf-description causes (file paths, verdict labels)")
        print("  that don't correspond to a separate emitted event.")
        return 0

    if explicit_chain_events:
        print(f"# Causal chain -- '{target_event}' (Tier-1.5: activity-log caused_by)")
        print(f"  ({len(explicit_chain_events)} explicit-cause occurrence(s); showing last 5)")
        print()
        for e in explicit_chain_events[-5:]:
            ts = e.get("ts", 0)
            ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else "?"
            print(f"  {ts_str}  caused_by={e['caused_by']}")
        print()
        print("  (Tier-2 heuristic chain follows for events without explicit caused_by;")
        print("  pass `--chain` to recursively resolve caused_by -> upstream events)")
        print()

    # Read all events; group by session for causal-window lookup. Events
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

    print(f"# Heuristic causal chain -- '{target_event}'")
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
        print(f"  >  {target_event}  (this event)")
        print()

    print("# Note:")
    print("  This is heuristic -- events in the same session within seconds")
    print("  are usually causally related but not always. The full Horizon VII")
    print("  vision adds explicit `caused_by` to each emit site so the chain")
    print("  becomes a hard fact rather than a temporal-adjacency guess.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
