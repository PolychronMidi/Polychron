#!/usr/bin/env python3
import argparse
import json
import subprocess
from omniroute_reasoning_config import ROOT, load_config, write_settings

ENDPOINTS = {
    'thinkingBudget': '/api/settings/thinking-budget',
    'payloadRules': '/api/settings/payload-rules',
}


def _login(port: str, password: str):
    jar = str(ROOT / 'tmp' / 'omniroute-config-cookies.txt')
    res = subprocess.run([
        'curl', '-sf', '-c', jar, '-X', 'POST',
        f'http://127.0.0.1:{port}/api/auth/login',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'password': password}),
    ], text=True, capture_output=True)
    return jar if res.returncode == 0 and '"success":true' in res.stdout else None


def _put(port: str, path: str, body: dict, cookie_file: str) -> bool:
    res = subprocess.run([
        'curl', '-sf', '-b', cookie_file, '-X', 'PUT',
        f'http://127.0.0.1:{port}{path}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(body),
    ], text=True, capture_output=True)
    return res.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', default='20128')
    ap.add_argument('--password', default='polychron')
    ap.add_argument('--db-only', action='store_true')
    args = ap.parse_args()
    cfg = load_config()
    ok = False
    if not args.db_only:
        jar = _login(args.port, args.password)
        if jar:
            ok = all(_put(args.port, ENDPOINTS[k], v, jar) for k, v in cfg.items())
    if not ok:
        write_settings(cfg)
    print('configured=api' if ok else 'configured=db')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
