import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = Path.home() / '.omniroute' / 'storage.sqlite'
RULES = ROOT / 'config' / 'omniroute-payloadRules.json'
THINKING = {'mode': 'adaptive', 'customBudget': 131072, 'effortLevel': 'xhigh'}


def load_rules() -> dict:
    return json.loads(RULES.read_text())


def read_setting(key: str):
    con = sqlite3.connect(DB)
    row = con.execute(
        "select value from key_value where namespace='settings' and key=?", (key,)
    ).fetchone()
    return json.loads(row[0]) if row else None


def write_settings(rules: dict | None = None) -> None:
    con = sqlite3.connect(DB)
    cur = con.cursor()
    vals = {'thinkingBudget': THINKING, 'payloadRules': rules or load_rules()}
    for key, val in vals.items():
        cur.execute(
            "insert or replace into key_value(namespace,key,value) values('settings',?,?)",
            (key, json.dumps(val)),
        )
    con.commit()


def verify() -> tuple[bool, str]:
    thinking = read_setting('thinkingBudget')
    rules = read_setting('payloadRules')
    if thinking != THINKING:
        return False, 'thinkingBudget mismatch'
    defaults = rules.get('default') if isinstance(rules, dict) else None
    if not isinstance(defaults, list):
        return False, 'payloadRules.default missing'
    params = [r.get('params', {}) for r in defaults]
    if {'reasoning_effort': 'xhigh'} not in params:
        return False, 'reasoning_effort rule missing'
    if {'thinkingLevel': 'xhigh'} not in params:
        return False, 'thinkingLevel rule missing'
    return True, 'ok'
