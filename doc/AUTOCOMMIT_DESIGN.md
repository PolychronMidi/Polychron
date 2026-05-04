# Autocommit helper — design rationale

Source-of-truth for `tools/HME/hooks/helpers/_autocommit.sh`. Inline
comments there were trimmed per CLAUDE.md ("Inline comments single-line
and terse"); full rationale lives here.

## Why this exists in its own helper

The historical failure mode: stop.sh and userpromptsubmit.sh each had
their own inline git-add / git-commit block that depended on
`$PROJECT_ROOT` being set by `.env`. When `.env` failed to load (moved
path, filesystem error, permissions), `PROJECT_ROOT` was empty;
`git -C ""` silently no-op'd; the error went to stderr which
`_proxy_bridge.sh` drops; and because the error log itself lives under
`$PROJECT_ROOT/log/`, the fallback LIFESAVER path could not write either.
All four channels collapsed together. The user observed autocommits fail
20 times without a single LIFESAVER alert.

## Decoupling

This helper decouples every failure channel from every other channel:

1. `_AC_ROOT` is derived from THIS file's own location; it cannot be
   broken by .env misconfiguration.
2. A sticky fail-flag file (`_AC_FAIL_FLAG`) is written on every failure
   path and deleted only on success. `userpromptsubmit.sh` LIFESAVER
   scan checks for this file's existence independently of log content.
3. A monotonic attempt counter (`_AC_COUNTER`) increments on entry,
   resets on success. If it climbs to 3+, the
   `AutocommitHealthVerifier` fails the HCI at weight 5.0 — same tier as
   `LifesaverIntegrity`.
4. Failures are logged to FOUR independent channels in parallel. All
   four must fail simultaneously for the error to go silent; any one
   surviving reveals the failure.

## Channels on failure

| Channel | Surfaces via |
|---|---|
| A. sticky fail-flag file | checked every `UserPromptSubmit` directly |
| B. `hme-errors.log` | LIFESAVER scan picks up new lines |
| C. stderr | `_proxy_bridge` drops, but visible locally |
| D. activity bridge | `coherence_violation` event, picked up by downstream metrics and the HCI verifier |

## Caller contract

Callers use:

    _ac_do_commit "caller-name"

and MUST NOT die on its return code — this function owns its own failure
bookkeeping. The return code is informational for the caller only.
