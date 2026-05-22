'use strict';

const { servicePort, resolver } = require('./contexts/upstream_dispatch');

function targetChain(body, directUrl, loadConfig, env = process.env) {
  return resolver.codexTargetChain({ body, upstreamUrl: directUrl, cfg: loadConfig(), env, servicePort });
}

function targetSummary(targets) {
  return targets.map((target) => ({
    kind: target.kind,
    url: target.url,
    model: target.body && target.body.model ? target.body.model : '',
  }));
}

module.exports = { targetChain, targetSummary };
