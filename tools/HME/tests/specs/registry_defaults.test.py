"""Test default-from-name normalization in detectors/_registry.py."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parent.parent.parent / "scripts" / "detectors"))

import _registry  # noqa: E402


class RegistryDefaults(unittest.TestCase):
    def _write_tmp(self, body: dict) -> Path:
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(body, f)
        f.close()
        return Path(f.name)

    def test_omitted_bash_var_defaults_from_name(self):
        path = self._write_tmp({"detectors": [{"name": "spiralling_petulance"}]})
        try:
            dets = _registry.detectors(path)
            self.assertEqual(dets[0]["bash_var"], "SPIRALLING_PETULANCE")
            self.assertEqual(dets[0]["fires_when"], "spiralling_petulance")
            self.assertEqual(dets[0]["reason_key"], "SPIRALLING_PETULANCE")
            self.assertEqual(dets[0]["module"], "spiralling_petulance")
        finally:
            os.unlink(path)

    def test_explicit_fields_win_over_defaults(self):
        path = self._write_tmp({"detectors": [{
            "name": "x",
            "bash_var": "CUSTOM_VAR",
            "module": "custom_module",
        }]})
        try:
            dets = _registry.detectors(path)
            self.assertEqual(dets[0]["bash_var"], "CUSTOM_VAR")
            self.assertEqual(dets[0]["module"], "custom_module")
            self.assertEqual(dets[0]["fires_when"], "x")
        finally:
            os.unlink(path)

    def test_real_registry_loads_without_drift(self):
        dets = _registry.detectors()
        self.assertGreater(len(dets), 10)
        for d in dets:
            self.assertIn("name", d)
            self.assertIn("bash_var", d)
            self.assertIn("fires_when", d)
            self.assertIn("module", d)


if __name__ == "__main__":
    unittest.main()
