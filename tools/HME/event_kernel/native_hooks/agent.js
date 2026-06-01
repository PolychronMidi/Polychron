'use strict';

const {
  PROJECT_ROOT,
  allow,
  appendUnique,
  extractBgOutputPath,
  parse,
  path,
  runPython,
} = require('./common');

async function pretoolAgent(stdinJson) {
  const script = path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts', 'team_agent_router.py');
  const r = runPython([script], stdinJson, 30_000, 'pretool-agent');
  return { stdout: r.stdout || '', stderr: r.stderr || ' ', exit_code: 0 };
}

async function posttoolAgent(stdinJson) {
  const bg = extractBgOutputPath(parse(stdinJson));
  if (bg) appendUnique(path.join(PROJECT_ROOT, 'tmp', 'hme-tab.txt'), `FILE: ${bg}`);
  return allow();
}

module.exports = { pretoolAgent, posttoolAgent };
