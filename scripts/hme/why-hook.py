#!/usr/bin/env python3
"""i/why mode=hook — surface what hook activity has happened recently.

Broader than mode=block (which only shows error/deny events). Reads
the activity log for posttooluse/pretooluse events + the hme.log for
hook firings, surfaces the last N hook-related events.
"""
from __future__ import annotations
import json
import os
import re
import sys
from datetime import datetime

from _common import PROJECT_ROOT


def main(argv):
    activity = os.path.join(PROJECT_ROOT, "output", "metrics", "hme-activity.jsonl")
    hme_log = os.path.join(PROJECT_ROOT, "log", "hme.log")

    out = ["# i/why mode=hook — recent hook activity"]
    out.append("")

    if os.path.isfile(activity):
        try:
            with open(activity) as f:
                lines = f.readlines()[-100:]
        except OSError:
            lines = []
        hook_events = []
        for ln in lines:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            ev = e.get("event", "")
            # Hook-related events: anything emitted by a hook layer
            if any(k in ev for k in (
                "brief_recorded", "auto_brief_injected", "edit_without_brief",
                "memory_redirect", "secret_sanitized", "bash_error_surfaced",
                "enricher_fired", "enricher_acted_upon", "nexus_cleared",
                "boilerplate_stripped", "semantic_redundancy_stripped",
            )):
                hook_events.append(e)
        if hook_events:
            out.append(f"  last {min(10, len(hook_events))} hook events:")
            for e in hook_events[-10:]:
                ts = e.get("ts", 0)
                ts_str = datetime.fromtimestamp(ts).strftime("%H:%M:%S") if ts else "?"
                ev = e.get("event", "?")
                src = e.get("source", e.get("session", ""))
                out.append(f"    {ts_str}  {ev:30}  {src}")
        else:
            out.append("  (no hook events in last 100 activity entries)")

    # Recent hme.log lines mentioning hooks
    if os.path.isfile(hme_log):
        try:
            with open(hme_log, encoding="utf-8", errors="ignore") as f:
                tail = f.readlines()[-200:]
        except OSError:
            tail = []
        hook_log = [ln.rstrip() for ln in tail if re.search(
            r"hook|posttooluse|pretooluse|policy", ln, re.IGNORECASE
        )]
        if hook_log:
            out.append("")
            out.append(f"  last {min(5, len(hook_log))} hook log lines:")
            for ln in hook_log[-5:]:
                out.append(f"    {ln[:140]}")

    out.append("")
    out.append("# Next:")
    out.append("  i/why mode=block          last hook/policy block specifically")
    out.append("  i/policies list           which policies are currently active")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
