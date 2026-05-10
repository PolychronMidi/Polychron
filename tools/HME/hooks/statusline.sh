#!/bin/bash
# Claude Code statusLine handler -- receives session JSON on stdin.
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
    # Tier badge from mode-classifier.jsonl (last line). Surfaces the otherwise-invisible
    # prompt classifier so users can see the active ceremony tier.
    tier_badge = ''
    try:
        ml = os.path.join(os.environ['PROJECT_ROOT'], 'output', 'metrics', 'mode-classifier.jsonl')
        if os.path.isfile(ml):
            with open(ml, 'rb') as _f:
                _f.seek(0, 2); end = _f.tell()
                _f.seek(max(0, end - 4096)); tail = _f.read().decode('utf-8', errors='ignore')
            for ln in reversed(tail.strip().split('\n')):
                if not ln.strip(): continue
                rec = json.loads(ln)
                mode = rec.get('mode', '?'); tier = rec.get('tier')
                tier_badge = f' | {mode}' + (f' {tier}' if tier else '')
                break
    except Exception:
        pass
    print(f'ctx:{r}%' + (f' | {label}' if label else '') + tier_badge)

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
