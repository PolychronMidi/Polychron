#!/usr/bin/env python3
"""Detect background-launch-then-idle antipattern.

If a long-running background job was launched in the current turn and the
agent has not since either (a) done >= 20 real tool calls, or (b) the
pipeline output file signals completion, print "idle". Otherwise "ok".

Background job markers:
  - Pipeline: npm run main / npm run snapshot / node lab/run
  - Training / install: python3 with train/merge/convert/finetune,
    pip install, nohup, accelerate, axolotl, unsloth, trainer.train,
    stress-test

Usage: idle_after_bg.py <transcript_path>
Output: "idle" or "ok" on stdout
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _transcript import iter_tool_results, iter_tool_uses, load_turn_events  # noqa: E402

PIPELINE_MARKERS = ("npm run main", "npm run snapshot", "node lab/run")
GENERIC_MARKERS = (
    "stress-test", "accelerate launch", "unsloth", "axolotl",
    "pip3 install", "pip install", "nohup", "trainer.train",
)
PYTHON_SUBMARKERS = ("train", "merge_", "convert_hf_to_gguf", "finetune")

DONE_SIGNALS = (
    "Pipeline complete", "pipeline complete", "npm ERR!", "Snapshot saved",
    "error Command failed", "DONE", "Finished in", "exited with code",
)

OUTPUT_PATH_RE = re.compile(r"Output is being written to: (\S+)")


def _is_bg_launch(cmd: str) -> bool:
    if not cmd:
        return False
    if any(m in cmd for m in PIPELINE_MARKERS):
        return True
    if any(m in cmd for m in GENERIC_MARKERS):
        return True
    if "python3" in cmd and any(sub in cmd for sub in PYTHON_SUBMARKERS):
        return True
    return False


def main() -> int:
    if len(sys.argv) < 2:
        print("ok")
        return 0
    found_bg = False
    calls_after_bg = 0
    bg_output_path: str | None = None
    events = load_turn_events(sys.argv[1])
    for event in events:
        for tr in iter_tool_results(event):
            m = OUTPUT_PATH_RE.search(tr["text"])
            if m and bg_output_path is None:
                bg_output_path = m.group(1)
        for tu in iter_tool_uses(event):
            inp = tu["input"]
            if (
                tu["name"] == "Bash"
                and inp.get("run_in_background")
                and _is_bg_launch(inp.get("command", ""))
            ):
                found_bg = True
            elif found_bg:
                calls_after_bg += 1

    if not found_bg:
        print("ok")
        return 0

    if bg_output_path and os.path.isfile(bg_output_path):
        try:
            tail = Path(bg_output_path).read_text(encoding="utf-8", errors="ignore")[-2000:]
            if any(sig in tail for sig in DONE_SIGNALS):
                print("idle" if calls_after_bg < 5 else "ok")
                return 0
        except OSError:
            pass

    print("idle" if calls_after_bg < 20 else "ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
