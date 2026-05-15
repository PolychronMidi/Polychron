# Block KB writes whose title starts with "Feedback:" -- same posture as the
# deprecated memory-directory block. Behavioral feedback for the agent does
# NOT belong in the KB: it goes in CLAUDE.md (durable rules) or in a hook
# (auto-enforced gate). KB titles starting with "Feedback:" are agent
# self-notes that pile up as spam and bury actual project knowledge.
#
# Triggered when the bash command is an `i/learn` invocation with a

case "$CMD" in
  *"i/learn"*)
    if echo "$CMD" | grep -qE 'title=(["'\'']?)Feedback:'; then
      _emit_block "BLOCKED: KB titles starting with 'Feedback:' are agent self-notes that spam the KB. Behavioral feedback for the agent belongs in CLAUDE.md (durable rules) or in a pretooluse hook (auto-enforced gate) -- not in the project KB. If this is genuinely a project-level feedback fact (e.g. user prefers approach X for Y), drop the 'Feedback:' prefix and rephrase the title so it stands as project knowledge rather than a self-correction note."
      exit 2
    fi
    ;;
esac
