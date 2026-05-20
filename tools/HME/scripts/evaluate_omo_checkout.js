#!/usr/bin/env node
'use strict';
const { evaluateOmoCheckout } = require('../omo_bridge/checkout_evaluator');
const result = evaluateOmoCheckout({
  enabled: true,
  source: process.env.HME_OMO_SOURCE,
  path: process.env.HME_OMO_PATH,
  packageName: process.env.HME_OMO_PACKAGE,
  loadEntrypoint: process.argv.includes('--load-entrypoint'),
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.dependency.status === 'ok' ? 0 : 1);
