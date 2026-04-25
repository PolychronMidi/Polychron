'use strict';
/**
 * Block writes to credential filenames (.pem, .key, id_rsa, etc.). JS port
 * of the gate in tools/HME/hooks/pretooluse/pretooluse_write.sh. The bash
 * gate remains primary in the current dispatch path; this entry exists for
 * unified discovery + configuration via the policy registry.
 */

const path = require('path');

const CRED_FILENAME =
  /^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$|\.(pem|key|pfx|p12|jks)$|^credentials(\.json)?$|^service[-_]account.*\.json$|^\.npmrc$|^\.pypirc$|^\.netrc$/i;

const REASON =
  'BLOCKED: writing to a credential filename. Polychron does not store keys, certs, or auth tokens in the repo. If this is a test fixture, name it with a non-credential prefix (e.g. fixture-*.pem); if it is an accidental real key, do NOT proceed.';

module.exports = {
  name: 'block-secrets-write',
  description: 'Block Write tool calls targeting credential filenames (id_rsa, *.pem, .npmrc, etc.).',
  category: 'security',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write'] },
  params: {},
  async fn(ctx) {
    const filePath = (ctx.toolInput && ctx.toolInput.file_path) || '';
    if (!filePath) return ctx.allow();
    const base = path.basename(filePath);
    if (CRED_FILENAME.test(base)) return ctx.deny(`${REASON} (filename: ${base})`);
    return ctx.allow();
  },
};
