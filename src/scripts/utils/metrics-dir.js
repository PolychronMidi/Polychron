'use strict';

function requireMetricsDir() {
  if (!process.env.METRICS_DIR) {
    throw new Error('METRICS_DIR is required');
  }
  return process.env.METRICS_DIR;
}

module.exports = { requireMetricsDir };
