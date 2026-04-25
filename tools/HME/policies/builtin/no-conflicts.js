'use strict';
/**
 * Block stop when an unresolved git merge/rebase is in progress. Policy-
 * shape wrapper around stop_chain/policies/no_conflicts.js.
 */

const path = require('path');

let _impl = null;
function _getImpl() {
  if (_impl) return _impl;
  _impl = require(path.resolve(__dirname, '..', '..', 'proxy', 'stop_chain', 'policies', 'no_conflicts.js'));
  return _impl;
}

module.exports = {
  name: 'no-conflicts',
  description: 'Block stop when git merge/rebase is in progress with unresolved conflicts.',
  category: 'git-discipline',
  defaultEnabled: true,
  match: { events: ['Stop'] },
  params: {},
  async fn(ctx) {
    return _getImpl().run(ctx);
  },
};
