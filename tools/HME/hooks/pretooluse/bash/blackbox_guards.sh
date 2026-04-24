# Block any bash access to compiled output — out/ is a black box
if echo "$CMD" | grep -q "tools/HME/chat/out"; then
  cd "${PROJECT_ROOT}/tools/HME/chat" && npx tsc 2>&1 | tail -20 >&2 || true
  _emit_block "BLOCKED: tools/HME/chat/out/ is a black box. Work with the .ts source in tools/HME/chat/src/ instead. tsc has been run to compile any pending src/ changes."
  exit 2
fi

# Block mkdir of misplaced log/, metrics/, or tmp/ directories
if echo "$CMD" | grep -qE '\bmkdir\b' && echo "$CMD" | grep -qE '/(log|tmp)($|/)'; then
  if ! echo "$CMD" | grep -qE '"?'"${PROJECT_ROOT}"'/(log|tmp)'; then
    _emit_block "BLOCKED: log/ and tmp/ only exist at project root. Do not mkdir subdirectory variants. Route output through \$PROJECT_ROOT/{log,tmp}/."
    exit 2
  fi
fi
if echo "$CMD" | grep -qE '\bmkdir\b' && echo "$CMD" | grep -qE '/metrics($|/)'; then
  if ! echo "$CMD" | grep -qE '"?'"${PROJECT_ROOT}"'/output/metrics'; then
    _emit_block "BLOCKED: metrics/ only exists at output/metrics/. Do not mkdir any other metrics/ directory."
    exit 2
  fi
fi

# Block run.lock deletion (hard rule)
if echo "$CMD" | grep -q 'run\.lock' && echo "$CMD" | grep -q 'rm'; then
  _emit_block "BLOCKED: Never delete run.lock"
  exit 2
fi
