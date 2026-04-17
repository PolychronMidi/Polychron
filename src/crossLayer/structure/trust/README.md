# crossLayer/structure/trust

Trust ecology — per-system adaptive scores, velocity nourishment, timbre mapping, and ecology character. `adaptiveTrustScores` is the authority: it maintains a `scoreBySystem` map and exposes the only legitimate write path for trust values in this subtree.

Trust ceiling and decay floor are **metaprofile-scaled** at runtime via `metaProfiles.getAxisValue('trust', ...)`. Never hardcode substitute values — they would override the metaprofile axis and break the trust concentration control loop.

The EMA weights (`_BASE_EMA_DECAY + _BASE_EMA_NEW`) must sum to exactly 1.0; this is asserted at boot. If you touch either constant, verify the invariant holds — a silent drift here warps every trust score computed thereafter.

<!-- HME-DIR-INTENT
rules:
  - Trust ceiling and decay floor are metaprofile-scaled — never substitute hardcoded values; they override the trust concentration control loop
  - EMA weights must sum to 1.0 (asserted at boot); touching _BASE_EMA_DECAY or _BASE_EMA_NEW requires re-verifying the invariant
  - No direct writes to scoreBySystem from outside this dir — all trust updates go through adaptiveTrustScores
-->
