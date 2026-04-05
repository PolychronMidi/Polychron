#!/usr/bin/env bash
# HME PostToolUse: after pipeline run, extract trace-summary observations for KB auto-population
# This runs AFTER posttooluse_bash.sh (which handles Evolver phase reminders)
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only trigger on pipeline completion
echo "$CMD" | grep -q 'npm run main' || exit 0

PROJECT="${CLAUDE_PROJECT_DIR:-/home/jah/Polychron}"
SUMMARY="$PROJECT/metrics/trace-summary.json"
[ -f "$SUMMARY" ] || exit 0

# Extract key metrics and format as a reminder to persist to KB
python3 -c "
import json, sys
try:
    s = json.load(open('$SUMMARY'))
    regimes = s.get('regimes', {})
    total_r = sum(v for v in regimes.values() if isinstance(v, (int,float))) or 1
    coherent = regimes.get('coherent', 0) / total_r
    exploring = regimes.get('exploring', 0) / total_r
    trust_dom = s.get('trustDominance', {})
    dominant = trust_dom.get('dominantSystems', []) if isinstance(trust_dom, dict) else []
    top_trust = [(d['system'], d.get('score', 0)) for d in dominant[:3]]
    coupling = list(s.get('aggregateCouplingLabels', {}).keys())[:4]
    beats = s.get('beats', {}).get('totalEntries', '?')
    sections = len(s.get('sectionStats', []))

    print(f'TRACE SUMMARY for KB: {beats} beats, {sections} sections. ', end='')
    print(f'Regimes: coherent={coherent:.0%}, exploring={exploring:.0%}. ', end='')
    if top_trust:
        print(f'Top trust: ' + ', '.join(f'{k}={v:.2f}' for k,v in top_trust) + '. ', end='')
    if coupling:
        print(f'Coupling: ' + ', '.join(coupling) + '.', end='')
    print()
except Exception as e:
    print(f'Could not parse trace-summary: {e}', file=sys.stderr)
" >&2

exit 0
