#!/usr/bin/env node
'use strict';
const path = require('path');
const { loadEnv } = require('../proxy/shared/load_env');
loadEnv(path.resolve(__dirname, '..', '..', '..', '.env'));
const { evaluateOmoCheckout } = require('../omo_bridge/checkout_evaluator');
(async () => {
  const result = await evaluateOmoCheckout({
    enabled: true,
    source: process.env.HME_OMO_SOURCE,
    path: process.env.HME_OMO_PATH,
    packageName: process.env.HME_OMO_PACKAGE,
    requiredVersion: process.env.HME_OMO_REQUIRED_VERSION,
    loadEntrypoint: process.argv.includes('--load-entrypoint'),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.dependency.status === 'ok' && result.contract.status === 'ok' && result.import_status !== 'error' ? 0 : 1);
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
