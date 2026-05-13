#!/usr/bin/env python3
import argparse
import json
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path.home() / ".omniroute" / "storage.sqlite"
RULES = ROOT / "config" / "omniroute-payloadRules.json"
THINKING = {"mode": "adaptive", "customBudget": 131072, "effortLevel": "xhigh"}


def _login(port: str, password: str):
    jar = str(ROOT / "tmp" / "omniroute-config-cookies.txt")
    res = subprocess.run([
        "curl", "-sf", "-c", jar, "-X", "POST",
        f"http://127.0.0.1:{port}/api/auth/login",
        "-H", "Content-Type: application/json",
        "-d", json.dumps({"password": password}),
    ], text=True, capture_output=True)
    if res.returncode != 0 or '"success":true' not in res.stdout:
        return None
    return jar


def _put(port: str, path: str, body: dict, cookie_file: str) -> bool:
    res = subprocess.run([
        "curl", "-sf", "-b", cookie_file, "-X", "PUT",
        f"http://127.0.0.1:{port}{path}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(body),
    ], text=True, capture_output=True)
    return res.returncode == 0


def _db_write(rules: dict) -> None:
    con = sqlite3.connect(DB)
    cur = con.cursor()
    vals = {"thinkingBudget": THINKING, "payloadRules": rules}
    for key, val in vals.items():
        cur.execute(
            "insert or replace into key_value(namespace,key,value) values('settings',?,?)",
            (key, json.dumps(val)),
        )
    con.commit()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="20128")
    ap.add_argument("--password", default="polychron")
    ap.add_argument("--db-only", action="store_true")
    args = ap.parse_args()
    rules = json.loads(RULES.read_text())
    ok = False
    if not args.db_only:
        jar = _login(args.port, args.password)
        if jar:
            ok = _put(args.port, "/api/settings/thinking-budget", THINKING, jar)
            ok = _put(args.port, "/api/settings/payload-rules", rules, jar) and ok
    if not ok:
        _db_write(rules)
        print("configured=db")
    else:
        print("configured=api")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
