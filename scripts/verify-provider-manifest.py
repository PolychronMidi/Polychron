#!/usr/bin/env python3
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT/'config/provider-manifest.json').read_text())
missing = [p for p in manifest.get('requiredFiles', []) if not (ROOT/p).exists()]
for name, rel in manifest.get('checks', {}).items():
    if not (ROOT/rel).exists(): missing.append(rel)
if missing:
    print('provider_manifest_missing=' + ','.join(missing))
    sys.exit(1)
print('provider_manifest=ok')
