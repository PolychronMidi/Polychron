"""agent_local entry point — argparse + mode routing."""
from __future__ import annotations

import json
import sys

from . import _base as _base_module
from ._base import PROJECT_ROOT
from .research import run_agent, _MODE_CONFIGS


def main():
    import argparse
    parser = argparse.ArgumentParser(description="HME local agentic research")
    parser.add_argument("--prompt", help="Research prompt")
    parser.add_argument("--stdin", action="store_true", help="Read JSON from stdin")
    parser.add_argument("--project", default=PROJECT_ROOT, help="Project root")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument(
        "--mode", default="explore", choices=list(_MODE_CONFIGS.keys()),
        help="Subagent mode: explore (code research), plan (architecture plan)",
    )
    args = parser.parse_args()

    if args.stdin:
        data = json.load(sys.stdin)
        prompt = data.get("prompt", "")
        mode = data.get("mode", args.mode)
    elif args.prompt:
        prompt = args.prompt
        mode = args.mode
    else:
        parser.error("--prompt or --stdin required")
        return

    result = run_agent(prompt, project_root=args.project, mode=mode)
    result["mode"] = mode

    if args.json:
        print(json.dumps(result))
    else:
        print(result["answer"])
        print(f"\n\n[mode={mode} | {result['model']} | {result['iterations']} iterations | "
              f"{len(result['tools_used'])} tools | {result['elapsed_s']}s]")


if __name__ == "__main__":
    main()
