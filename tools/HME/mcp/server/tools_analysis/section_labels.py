"""Coupling label display helpers for section analysis."""

# Coupling label → musical meaning (from Polychron coupling engine semantics)
_COUPLING_LABEL_MEANING: dict[str, str] = {
    "locked": "tightly synchronized — movements mirror each other",
    "drifting": "loosely coupled — independent but aware",
    "opposing": "antagonistic — one rises as other falls",
    "converging": "approaching sync — building toward lock",
    "diverging": "separating — increasing independence",
    "resonant": "harmonic reinforcement — shared frequency peaks",
    "decoupled": "fully independent — no interaction",
    "entangled": "complex bidirectional — hard to predict one from other",
}


def _coupling_label_display(raw_label: str) -> str:
    """Format a coupling label with musical meaning."""
    parts = raw_label.split(":")
    if len(parts) >= 2:
        pair = parts[0]
        label = parts[-1]
        meaning = _COUPLING_LABEL_MEANING.get(label, "")
        suffix = f" ({meaning})" if meaning else ""
        return f"{label}{suffix} [{pair}]"
    return raw_label
