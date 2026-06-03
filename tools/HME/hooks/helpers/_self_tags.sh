# Shared self-origin tag classifier for Lifesaver/error-surface hooks.
# Tags here identify HME infrastructure health, not agent-caused work errors.

_hme_self_tag_re() {
  node -e 'const s=require(process.env.PROJECT_ROOT+"/tools/HME/proxy/self_origin"); console.log("^\\[("+s.SELF_SUPPRESSED_TAG_PATTERNS.join("|")+")\\]")' 2>/dev/null || printf '%s\n' 'a^'
}
