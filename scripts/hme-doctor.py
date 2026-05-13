#!/usr/bin/env python3
import json
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ERR = ROOT / 'log' / 'hme-errors.log'


def check(name, ok, detail='', fix=''):
    glyph = 'PASS' if ok else 'FAIL'
    print(f'{glyph}\t{name}\t{detail}\t{fix}')
    return ok


def http_ok(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def main():
    ok = True
    ok &= check('proxy', http_ok('http://127.0.0.1:9099/health'), 'http://127.0.0.1:9099/health', 'restart HME proxy')
    ok &= check('omniroute', http_ok('http://127.0.0.1:20128/v1/models'), 'http://127.0.0.1:20128/v1/models', 'tools/omniroute/start.sh')
    ok &= check('universal_pulse', (ROOT/'tmp/hme-universal-pulse.heartbeat').exists(), 'heartbeat file', 'tools/HME/hooks/direct/universal-pulse-supervisor.sh start')
    probe = subprocess.run([str(ROOT/'scripts/probe-omniroute-max-reasoning.py')], text=True, capture_output=True)
    ok &= check('omniroute_max_reasoning', probe.returncode == 0, probe.stdout.strip() or probe.stderr.strip(), 'scripts/configure-omniroute-max-reasoning.py')
    try:
        cfg = json.loads((ROOT/'config/models.json').read_text())
        missing = [m['id'] for t in cfg['tiers'].values() for m in t['models'] if 'context_length' not in m or 'max_output_tokens' not in m]
    except Exception as e:
        missing = [str(e)]
    ok &= check('model_limits', not missing, f'missing={len(missing)}', 'scripts/sync-omniroute-model-limits.py')
    hook_report = subprocess.run(['node', str(ROOT/'tools/HME/hooks/hook_report.js'), '--json'], text=True, capture_output=True)
    ok &= check('hook_report', hook_report.returncode == 0, 'log/hme-hook-exec.jsonl', 'check hook_bridge')
    if not ok:
        ERR.parent.mkdir(exist_ok=True)
        with ERR.open('a') as f:
            f.write(f'[{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}] [hme-doctor] FAIL health check; run scripts/hme-doctor.py\n')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
