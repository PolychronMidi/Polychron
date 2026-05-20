'use strict';
// Stop-chain autocommit must never run git/precommit synchronously. Request-side
// proxy_autocommit owns commits and sticky fail-flag maintenance; Stop only
// preserves policy slot/telemetry so lifesaver can surface any existing flag.
module.exports = {
  name: 'autocommit',
  async run(ctx) {
    return ctx.allow();
  },
};
