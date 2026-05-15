#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from omniroute_reasoning_config import verify as verify_omniroute

ROOT = Path(__file__).resolve().parents[1]
ERR = ROOT / 'log' / 'hme-errors.log'


def check(name, ok, detail='', fix=''):
    print(f'{"PASS" if ok else "FAIL"}\t{name}\t{detail}\t{fix}')
    return ok


def run_check(name, argv, detail='', fix=''):
    proc = subprocess.run(argv, cwd=ROOT, text=True, capture_output=True)
    out = (proc.stdout or proc.stderr or '').strip().splitlines()
    return check(name, proc.returncode == 0, out[-1] if out else detail, fix)


def http_ok(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def load_jsonc(path):
    text = path.read_text()
    out = []
    in_string = False
    escaped = False
    i = 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == '/' and nxt == '/':
            while i < len(text) and text[i] not in '\r\n':
                i += 1
            continue
        out.append(ch)
        i += 1
    return json.loads(''.join(out))


def model_limits_ok():
    try:
        cfg = load_jsonc(ROOT/'config/models.json')
        return [m['id'] for t in cfg['tiers'].values() for m in t['models'] if 'context_length' not in m or 'max_output_tokens' not in m]
    except Exception as e:
        return [str(e)]


def hooks_doctor():
    ok = True
    ok &= run_check(
        'claude_settings_sync',
        [sys.executable, str(ROOT / 'scripts/sync-claude-settings.py'), '--check'],
        fix='scripts/sync-claude-settings.py',
    )
    ok &= run_check(
        'claude_settings_audit',
        [sys.executable, str(ROOT / 'scripts/audit-claude-settings.py')],
        fix='scripts/sync-claude-settings.py',
    )
    ok &= run_check(
        'event_kernel_dispatch',
        ['node', str(ROOT / 'scripts/hme-hook-test.js')],
        fix='check tools/HME/event_kernel/dispatcher.js',
    )

    status_input = json.dumps({
        'context_window': {
            'used_percentage': 25,
            'remaining_percentage': 75,
            'context_window_size': 200000,
        },
        'model': {'id': 'doctor', 'display_name': 'Doctor'},
    })
    status = subprocess.run(
        ['node', str(ROOT / 'tools/HME/event_kernel/statusline.js')],
        input=status_input,
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    status_out = status.stdout.strip()
    ok &= check(
        'statusline',
        status.returncode == 0 and status_out.startswith('ctx:75%'),
        status_out,
        'check tools/HME/event_kernel/statusline.js',
    )

    git_dir = ROOT / '.git'
    ok &= check(
        'git_dir_writable',
        os.access(git_dir, os.W_OK),
        str(git_dir),
        'fix filesystem permissions/mount; autocommit needs .git write access',
    )

    fail_flag = ROOT / 'runtime/hme/autocommit.fail'
    counter = ROOT / 'runtime/hme/autocommit.counter'
    counter_value = counter.read_text().strip() if counter.exists() else '0'
    try:
        attempts = int(counter_value or '0')
    except ValueError:
        attempts = 999
    ok &= check(
        'autocommit_state',
        not fail_flag.exists() and attempts < 3,
        f'fail_flag={fail_flag.exists()} counter={counter_value}',
        'let a real UserPromptSubmit autocommit succeed, or inspect runtime/hme/autocommit.fail',
    )
    return ok


def main():
    ap = argparse.ArgumentParser(description='HME local health checks')
    ap.add_argument('--hooks', action='store_true', help='run only hook wiring/autocommit checks')
    args = ap.parse_args()

    if args.hooks:
        return 0 if hooks_doctor() else 1

    ok = True
    ok &= check('proxy', http_ok('http://127.0.0.1:9099/health'), '9099/health', 'restart HME proxy')
    ok &= check('omniroute', http_ok('http://127.0.0.1:20128/v1/models'), '20128/v1/models', 'tools/omniroute/start.sh')
    ok &= check('universal_pulse', (ROOT/'tmp/hme-universal-pulse.heartbeat').exists(), 'heartbeat file', 'universal-pulse-supervisor start')
    or_ok, or_detail = verify_omniroute()
    ok &= check('omniroute_max_reasoning', or_ok, or_detail, 'scripts/configure-omniroute-max-reasoning.py')
    missing = model_limits_ok()
    ok &= check('model_limits', not missing, f'missing={len(missing)}', 'scripts/sync-omniroute-model-limits.py')
    report = subprocess.run(['node', str(ROOT/'tools/HME/hooks/hook_report.js'), '--json'], text=True, capture_output=True)
    ok &= check('hook_report', report.returncode == 0, 'log/hme-hook-exec.jsonl', 'check event kernel')
    ok &= hooks_doctor()
    if ok:
        (ROOT/'tmp/hme-doctor.ok').write_text(str(int(time.time())))
    else:
        ERR.parent.mkdir(exist_ok=True)
        with ERR.open('a') as f:
            ts = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            f.write(f'[{ts}] [hme-doctor] FAIL health check; run scripts/hme-doctor.py\n')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
