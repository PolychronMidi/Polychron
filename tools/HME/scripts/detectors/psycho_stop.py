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
    print("psycho" if (saw_bg and saw_wakeup) else "ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
