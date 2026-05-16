import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DB = Path.home() / '.omniroute' / 'storage.sqlite'
CONFIG = ROOT / 'config' / 'omniroute-max-reasoning.json'


def load_config() -> dict:
    return json.loads(CONFIG.read_text())


def read_setting(key: str):
    con = sqlite3.connect(DB)
    row = con.execute(
        "select value from key_value where namespace='settings' and key=?", (key,)
    ).fetchone()
    return json.loads(row[0]) if row else None


def write_settings(config: dict | None = None) -> None:
    cfg = config or load_config()
    con = sqlite3.connect(DB)
    cur = con.cursor()
    for key, val in cfg.items():
        cur.execute(
            "insert or replace into key_value(namespace,key,value) values('settings',?,?)",
            (key, json.dumps(val)),
        )
    con.commit()


def verify() -> tuple[bool, str]:
    cfg = load_config()
    for key, expected in cfg.items():
        if read_setting(key) != expected:
            return False, f'{key} mismatch'
    return True, 'ok'
