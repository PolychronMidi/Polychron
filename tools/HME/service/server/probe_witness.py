"""Observability-of-observability — witness structure for probes.

Today a probe's PASS means only "it ran and didn't find its target
failure." That's weak: many coincidental conditions can produce the
same PASS signal. This module provides a richer idiom:

    with probe_witness("daemon uniqueness") as w:
        pids = find_daemon_pids()
        w.observed("pid_count", len(pids))
        w.observed("pid_bound_to_port", check_port_ownership(7735))
        w.asserted(len(pids) == 1, positive_evidence="one daemon, bound to expected port")
        w.caveat("can't distinguish from 'daemon just restarted, old PID gone'")

The resulting probe report carries (a) the positive witness of health
and (b) known coincidental-pass conditions. Selftest's summary can then
flag any probe whose witness is only *negative* ("no bug seen") vs
*positive* ("affirmative evidence of health") as `COINCIDENTAL-PASS`
with lower epistemic confidence.

For now this is a thin structure that probes can opt into; selftest
aggregates the markers and reports confidence at the end.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator


@dataclass
class Witness:
    """Observation record produced by one probe."""
    name: str
    positive_evidence: list[str] = field(default_factory=list)
    observations: dict[str, Any] = field(default_factory=dict)
    caveats: list[str] = field(default_factory=list)
    asserted_ok: bool = True
    falsification: str = ""

    def observed(self, key: str, value: Any) -> None:
        """Record a measured value for later analysis."""
        self.observations[key] = value

    def asserted(self, ok: bool, *, positive_evidence: str = "") -> None:
        """Record the outcome of the probe's primary assertion. Pass
        positive_evidence describing the AFFIRMATIVE signal (not mere
        absence of failure)."""
        self.asserted_ok = self.asserted_ok and ok
        if positive_evidence:
            self.positive_evidence.append(positive_evidence)

    def caveat(self, text: str) -> None:
        """Register a known coincidental-pass pattern — a condition that
        would yield the same PASS signal without corresponding to real
        health. Future selftests can use this to flag low-confidence
        passes."""
        self.caveats.append(text)

    def set_falsification(self, text: str) -> None:
        """Record what observation would falsify this probe's claim.
        A probe without a declared falsifier is epistemically weak."""
        self.falsification = text

    def confidence(self) -> str:
        """Return 'HIGH' if probe has positive_evidence AND falsification,
        'MEDIUM' if it has one of those, 'LOW' if neither."""
        has_positive = bool(self.positive_evidence)
        has_falsifier = bool(self.falsification)
        if has_positive and has_falsifier:
            return "HIGH"
        if has_positive or has_falsifier:
            return "MEDIUM"
        return "LOW"

    def summary_line(self) -> str:
        """One-line PASS/FAIL rendering including confidence marker."""
        status = "PASS" if self.asserted_ok else "FAIL"
        conf = self.confidence()
        bits = [f"{status}[{conf}]: {self.name}"]
        if self.positive_evidence:
            bits.append(" -- " + "; ".join(self.positive_evidence[:2]))
        if self.caveats and conf != "HIGH":
            bits.append(f"  (coincidental-pass risk: {self.caveats[0][:80]})")
        return "".join(bits)


@contextmanager
def probe_witness(name: str) -> Iterator[Witness]:
    """Context manager that yields a Witness. Exceptions inside the block
    mark the witness as asserted-false with the exception as falsifier."""
    w = Witness(name=name)
    try:
        yield w
    except Exception as e:
        w.asserted_ok = False
        w.caveat(f"probe raised {type(e).__name__}: {e}")


# Exported for probes that prefer direct Witness construction.
__all__ = ["Witness", "probe_witness"]
