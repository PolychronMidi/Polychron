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
HME_SCRIPTS = ROOT / 'tools' / 'HME' / 'scripts'
sys.path.insert(0, str(HME_SCRIPTS))

from jsonc import load_jsonc  # noqa: E402
from service_registry import (  # noqa: E402
    heartbeat_path,
    load_services,
    service_enabled,
    service_url,
)
from state_registry import (  # noqa: E402
    iter_entries,
    repair_command_issues,
    unregistered_state_candidates,
)

ERR = ROOT / 'log' / 'hme-errors.log'


def check(name, ok, detail='', fix=''):
    print(f'{"PASS" if ok else "FAIL"}\t{name}\t{detail}\t{fix}')
    return ok


def run_check(name, argv, detail='', fix=''):
    proc = subprocess.run(argv, cwd=ROOT, text=True, capture_output=True)
    out = (proc.stdout or proc.stderr or '').strip().splitlines()
    return check(name, proc.returncode == 0, out[-1] if out else detail, fix)


def git_dirty():
    proc = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, text=True, capture_output=True)
    if proc.returncode != 0:
        return True
    return bool(proc.stdout.strip())


def freshness_check(name, file_path, max_age_sec, fix):
    try:
        age = time.time() - file_path.stat().st_mtime
    except FileNotFoundError:
        return check(name, False, f'{file_path} missing', fix)
    return check(name, age < max_age_sec, f'age={age:.0f}s max={max_age_sec}s', fix)


def http_ok(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def model_limits_ok():
    try:
        cfg = load_jsonc(ROOT/'config/models.json')
        return [m['id'] for t in cfg['tiers'].values() for m in t['models'] if 'context_length' not in m or 'max_output_tokens' not in m]
    except Exception as e:
        return [str(e)]


def service_checks():
    ok = True
    try:
        services = load_services(ROOT)
    except Exception as e:
        return check('service_registry', False, str(e), 'fix tools/HME/config/services.json')
    ok &= check('service_registry', True, f'{len(services)} service(s)')
    for service in services:
        name = str(service.get('id') or 'unknown')
        if not service_enabled(service):
            ok &= check(name, True, 'disabled by environment')
            continue
        kind = service.get('kind')
        if kind == 'http':
            url = service_url(service)
            ok &= check(name, http_ok(url), url, str(service.get('fix') or 'start service'))
        elif kind == 'heartbeat':
            hb = heartbeat_path(service, ROOT)
            max_age = float(service.get('max_age_sec', 90))
            try:
                age = time.time() - hb.stat().st_mtime
                ok &= check(name, age < max_age, f'age={age:.0f}s', str(service.get('fix') or 'start heartbeat'))
            except FileNotFoundError:
                ok &= check(name, False, f'{hb} missing', str(service.get('fix') or 'start heartbeat'))
        else:
            ok &= check(name, False, f'unknown kind={kind!r}', 'fix tools/HME/config/services.json')
    return ok


def state_registry_check():
    try:
        entries = iter_entries(ROOT)
        repair_issues = repair_command_issues(ROOT)
        candidates = unregistered_state_candidates(ROOT)
    except Exception as e:
        return check('state_registry', False, str(e), 'fix tools/HME/config/state-files.json')
    detail = f'registered={len(entries)} unregistered_candidates={len(candidates)}'
    if repair_issues:
        return check('state_registry', False, detail + f' repair_issues={len(repair_issues)}',
                     'fix repair commands in tools/HME/config/state-files.json')
    return check('state_registry', True, detail, 'register new shared state files when promoted')


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
        'codex_settings_sync',
        [sys.executable, str(ROOT / 'scripts/sync-codex-settings.py'), '--check'],
        fix='scripts/sync-codex-settings.py',
    )
    ok &= run_check(
        'codex_settings_audit',
        [sys.executable, str(ROOT / 'scripts/audit-codex-settings.py')],
        fix='scripts/sync-codex-settings.py',
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
    active_max_age = int(os.environ.get('HME_DOCTOR_ACTIVE_HOOK_MAX_AGE_SEC', str(6 * 60 * 60)))
    if git_dirty():
        ok &= freshness_check(
            'autocommit_heartbeat',
            ROOT / 'runtime' / 'hme' / 'heartbeat-autocommit.ts',
            active_max_age,
            'run a real Claude/Codex request through the proxy; inspect autocommit fail channels if stale',
        )
    else:
        ok &= check('autocommit_heartbeat', True, 'clean tree; freshness not required')
    ok &= freshness_check(
        'lifesaver_heartbeat',
        ROOT / 'runtime' / 'hme' / 'heartbeat-lifesaver.ts',
        active_max_age,
        'run a real Claude/Codex request through the proxy; lifesaver must heartbeat from hook or proxy path',
    )
    return ok


def main():
    ap = argparse.ArgumentParser(description='HME local health checks')
    ap.add_argument('--hooks', action='store_true', help='run only hook wiring/autocommit checks')
    args = ap.parse_args()

    if args.hooks:
        return 0 if hooks_doctor() else 1

    ok = True
    ok &= service_checks()
    ok &= state_registry_check()
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
