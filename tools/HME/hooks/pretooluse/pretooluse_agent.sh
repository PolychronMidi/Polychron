#!/usr/bin/env bash
# MODE=6 Agent reroute: nested subagent calls go through stage-crew tier policy.
INPUT=$(cat)
PROJECT="${PROJECT_ROOT:-$(pwd)}"
python3 "$PROJECT/tools/HME/scripts/team_agent_router.py" <<<"$INPUT"
exit 0
