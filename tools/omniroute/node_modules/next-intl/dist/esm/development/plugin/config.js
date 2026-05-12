// Avoid rollup's `replace` plugin to compile this away
const nodeEnvKey = 'NODE_ENV'.trim();

// We avoid reading `argv.includes('dev')` related to
// https://github.com/amannn/next-intl/issues/2006
const isDevelopment = process.env[nodeEnvKey] === 'development';
const isNextBuild = process.argv.includes('build');
const isDevelopmentOrNextBuild = isDevelopment || isNextBuild;

export { isDevelopment, isDevelopmentOrNextBuild, isNextBuild };
