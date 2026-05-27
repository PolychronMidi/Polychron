'use strict';
/**
 * NEXUS unreviewed-edit gate. Policy-shape wrapper around the existing
 * stop_chain/policies/nexus_edit_check.js. The Stop chain still loads its
 * policies from stop_chain/policies/ for backwards-compat; this entry
 * exists so the unified registry can list, enable/disable, and configure
 * the same logic without duplicating it.
 */

const path = require('path');

// Delegate to the canonical implementation. Lazy-require so the unified
// registry can load without forcing the entire stop_chain to initialize.
let _impl = null;
function _getImpl() {
  if (_impl) return _impl;
  _impl = require(path.resolve(__dirname, '..', '..', 'proxy', 'stop_chain', 'policies', 'nexus_edit_check.js'));
  return _impl;
}

module.exports = {
  name: 'nexus-edit-check',
  description: 'Block stop when unreviewed edits exist; emit i/review reminder with KB hits.',
  category: 'review-discipline',
  defaultEnabled: true,
  match: { events: ['Stop'] },
  params: {},
  async fn(ctx) {
    return _getImpl().run(ctx);
  },
};
