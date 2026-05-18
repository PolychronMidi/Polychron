# Block re-running a command whose log already captured its output recently
# AND no source code has changed since. Re-running burns time, hides flapping,
# and is wasteful when the answer sits in a file. Read the log instead.
#
# Commands that write logs via src/scripts/utils/run-with-log.js:
#   npm run lint   -> log/lint.log
#   npm run tc     -> log/tc.log
#   (others writers can be added here as needed)
#
# Detection: command matches one of the above AND log mtime is fresher than
# every code mtime under src/ and tools/HME/. If the agent edited code since
# the last run, the run is legitimate and the gate steps aside.

[ -z "${PROJECT_ROOT:-}" ] && return 0

_LOG_FIRST_TARGET=""
case "$CMD" in
  "npm run lint"|"npm run lint:raw")  _LOG_FIRST_TARGET="lint.log" ;;
  "npm run tc")                        _LOG_FIRST_TARGET="tc.log" ;;
esac

if [ -n "$_LOG_FIRST_TARGET" ]; then
  _LOG_PATH="${PROJECT_ROOT}/log/${_LOG_FIRST_TARGET}"
  if [ -f "$_LOG_PATH" ]; then
    _LOG_MTIME=$(stat -c %Y "$_LOG_PATH" 2>/dev/null || echo 0)  # silent-ok: optional fallback path.
    if [ "$_LOG_MTIME" -gt 0 ]; then
      _NEWEST_CODE=$(find "${PROJECT_ROOT}/src" "${PROJECT_ROOT}/tools/HME" \
        -type f \( -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.sh" -o -name "*.json" -o -name "*.md" \) \
        -newer "$_LOG_PATH" -print -quit 2>/dev/null)  # silent-ok: optional fallback path.
      if [ -z "$_NEWEST_CODE" ]; then
        _LOG_AGE=$(( $(date +%s) - _LOG_MTIME ))
        _emit_block "BLOCKED: log/${_LOG_FIRST_TARGET} was written ${_LOG_AGE}s ago and no code under src/ or tools/HME/ has changed since. Read the existing log instead of re-running. If you have a real reason to re-run (env change, transient failure suspected), prepend ': force-rerun;' to the command."
        exit 2
      fi
    fi
  fi
fi
