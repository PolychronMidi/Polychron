# Auto-commit snapshot (fail-fast-hardened — see _autocommit.sh).
# The helper owns all bookkeeping: four-channel failure logging, sticky
# fail flag, attempt counter, derivation of the project root independent
# of $PROJECT_ROOT. We must NOT die on its return code; remaining
# lifecycle work still needs to run and the helper has already recorded
# the failure to every channel it could reach.
source "${_HME_HELPERS_DIR}/_autocommit.sh"
_ac_do_commit stop.sh || true
# Clear the nexus COMMIT_FAILED marker on success. The helper already
# wrote one on failure (see _autocommit.sh); this side clears on success
# so a recovered state doesn't keep nagging.
if [ ! -f "$_AC_FAIL_FLAG" ]; then
  source "${_HME_HELPERS_DIR}/_nexus.sh"
  _nexus_clear_type COMMIT_FAILED 2>/dev/null || true
fi
