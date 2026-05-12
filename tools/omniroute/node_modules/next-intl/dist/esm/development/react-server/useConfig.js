import getConfig from '../server/react-server/getConfig.js';
import use from '../shared/use.js';

function useHook(hookName, promise) {
  try {
    return use(promise);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("Cannot read properties of null (reading 'use')")) {
      throw new Error(`\`${hookName}\` is not callable within an async component. Please refer to https://next-intl.dev/docs/environments/server-client-components#async-components`, {
        cause: error
      });
    } else {
      throw error;
    }
  }
}
function useConfig(hookName) {
  return useHook(hookName, getConfig());
}

export { useConfig as default };
