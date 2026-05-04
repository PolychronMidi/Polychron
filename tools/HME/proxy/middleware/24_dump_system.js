'use strict';
// Post-pipeline payload dump middleware. Util lives at proxy/_dump.js so
// hme_proxy.js can call writeDump directly for the pre-pipeline snapshot.

const { writeDump } = require('../_dump');

module.exports = {
  name: 'dump_system',
  onRequest({ payload, ctx }) {
    if (process.env.HME_PROXY_LEAN_MODE === '1') return;
    writeDump(payload, ctx.PROJECT_ROOT, 'post', (m) => ctx.warn(m));
  },
};
