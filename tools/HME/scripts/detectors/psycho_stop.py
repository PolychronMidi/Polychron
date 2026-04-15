#!/usr/bin/env python3
"""Detect ScheduleWakeup-during-long-background-job (psychopathic stop).

Fires when the same turn contains BOTH:
  1. A Bash tool call with run_in_background=true whose command matches a
     long-running workload (training, pip install, nohup, accelerate, etc.)
  2. A ScheduleWakeup call

The combination means the agent deferred work instead of continuing with
other productive tasks while the background job runs.

Usage: psycho_stop.py <transcript_path>
Output: "psycho" or "ok"
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import iter_tool_uses, load_turn_events  # noqa: E402

BG_KEYWORDS = (
    "train", "pip install", "pip3 install", "nohup", "accelerate", "axolotl",
    "unsloth", "merge_", "convert_hf_to_gguf", "finetune", "stress-test",
    # Generic long-running python scripts — `python3 /tmp/foo.py` or inline
    # `python3 <<EOF ... EOF` in a background command. Catches reindex
    # loops, download scripts, migration wrappers, and anything launched
    # from /tmp as a batch one-shot. The presence of `&` at end OR heredoc
    # marker also indicates the command was intended to run long.
    "python3 /tmp/", "python3 <<", "python <<",
    # Shim / daemon restarts deferred via nohup are not the same pattern
    # (those are quick) — they're caught elsewhere. But if a nohup or
    # disown appears in the command AND there's a wakeup, that's defer.
    "disown", "/reindex", "reindex",
    # HF / large model downloads
    "snapshot_download", "hf_hub_download", "huggingface_hub",
)


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    saw_bg = False
    saw_wakeup = False
    for event in load_turn_events(sys.argv[1]):
        for tu in iter_tool_uses(event):
            if tu["name"] == "ScheduleWakeup":
                saw_wakeup = True
            if tu["name"] == "Bash" and tu["input"].get("run_in_background"):
                cmd = tu["input"].get("command", "")
                if any(kw in cmd for kw in BG_KEYWORDS):
                    saw_bg = True
            # Also catch the heredoc-in-foreground-then-disown pattern:
            # `python3 <<'EOF' ... EOF &` with disown on a subsequent line.
            # Those aren't flagged as run_in_background by the harness but
            # they ARE background jobs.
            if tu["name"] == "Bash" and not tu["input"].get("run_in_background"):
                cmd = tu["input"].get("command", "")
                if " &" in cmd and "disown" in cmd:
                    if any(kw in cmd for kw in BG_KEYWORDS):
                        saw_bg = True
    print("psycho" if (saw_bg and saw_wakeup) else "ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
