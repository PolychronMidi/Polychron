#!/usr/bin/env python3
"""Smoke + gate tests for verify_coherence.dispatcher_routes."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "_lib"))
from helpers import assert_class_shape, smoke_run


def _classes():
    from verify_coherence.dispatcher_routes import DispatcherRouteContractVerifier
    return (DispatcherRouteContractVerifier,)


class DispatcherRoutesModuleTests(unittest.TestCase):
    def test_class_shape(self):
        for cls in _classes():
            assert_class_shape(self, cls)

    def test_smoke_run(self):
        smoke_run(self, _classes())


class RouteContractGateTests(unittest.TestCase):
    """The route contract must PASS on the real tree and be able to FAIL when a
    declared route is removed -- proving the dispatcher-routes.json <-> switch
    diff actually gates."""

    def _verifier(self):
        from verify_coherence.dispatcher_routes import DispatcherRouteContractVerifier
        return DispatcherRouteContractVerifier()

    def test_real_tree_passes(self):
        r = self._verifier().run()
        self.assertEqual(r.status, "PASS", r.summary)

    def test_missing_route_fails(self):
        import json
        import tempfile
        import verify_coherence.dispatcher_routes as mod
        with open(mod._ROUTES, encoding="utf-8") as fh:
            data = json.load(fh)
        data["routes"] = [r for r in data["routes"] if r["event"] != "PermissionRequest"]
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, tmp)
        tmp.close()
        orig = mod._ROUTES
        mod._ROUTES = tmp.name
        try:
            r = self._verifier().run()
            self.assertEqual(r.status, "FAIL", r.summary)
        finally:
            mod._ROUTES = orig
            Path(tmp.name).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
