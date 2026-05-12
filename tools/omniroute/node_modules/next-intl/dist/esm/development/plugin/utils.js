function formatMessage(message) {
  return `\n[next-intl] ${message}\n`;
}
function throwError(message) {
  throw new Error(formatMessage(message));
}
function warn(message) {
  console.warn(formatMessage(message));
}

/**
 * Returns a function that runs the provided callback only once per process.
 * Next.js can call the config multiple times - this ensures we only run once.
 * Uses an environment variable to track execution across config loads.
 */
function once(namespace) {
  return function runOnce(fn) {
    if (process.env[namespace] === '1') {
      return;
    }
    process.env[namespace] = '1';
    fn();
  };
}

export { once, throwError, warn };
