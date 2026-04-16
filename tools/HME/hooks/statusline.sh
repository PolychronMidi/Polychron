#!/bin/bash
# Claude Code statusLine handler — receives session JSON on stdin.
# Writes real context data to HME_CTX_FILE (PTY sessions) or /tmp/claude-context.json.
# Fields: used_pct, remaining_pct, size, model_id, model_name (all from API, no fabrication).
input=$(cat)
echo "$input" > /tmp/claude-statusline-raw.json

if [ -z "$input" ]; then
  echo "ctx:?"
  exit 0
fi

python3 -c "
import json, os, subprocess, sys, time
try:
    d = json.loads(sys.argv[1])
    cw = d.get('context_window', {})
    m = d.get('model', {})
    u = round(cw.get('used_percentage', 0))
    r = round(cw.get('remaining_percentage', 0))
    sz = int(cw.get('context_window_size', 0))
    out = {
        'used_pct': u,
        'remaining_pct': r,
        'size': sz,
        'model_id': m.get('id', ''),
        'model_name': m.get('display_name', '')
    }
    f = os.environ.get('HME_CTX_FILE', '/tmp/claude-context.json')
    open(f, 'w').write(json.dumps(out))
    label = m.get('display_name', '') or m.get('id', '')
    print(f'ctx:{r}%' + (f' | {label}' if label else ''))

    # H-compact optimization #1: preemption trigger.
    # When used_pct crosses 70%, fire a chain-snapshot in the background so
    # the chain-link artifact is ready BEFORE Claude's auto-compaction kicks
    # in. Single-shot per turn via a sentinel file (reset at userpromptsubmit).
    sentinel = '/tmp/hme-chain-snapshot-fired'
    if u >= 70 and not os.path.exists(sentinel):
        project = os.environ['PROJECT_ROOT']
        script = os.path.join(project, 'tools', 'HME', 'scripts', 'chain-snapshot.py')
        if os.path.isfile(script):
            open(sentinel, 'w').write(str(int(time.time())))
            subprocess.Popen(
                ['python3', script, '--imminent'],
                env={**os.environ, 'PROJECT_ROOT': project},
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
except Exception as e:
    import sys as _sys
    print(f'ctx:err', file=_sys.stderr)
    raise
" "$input" 2>/dev/null || echo "ctx:?"
