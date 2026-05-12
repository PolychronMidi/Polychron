import getDefaultNow from '../server/react-server/getDefaultNow.js';
import useConfig from './useConfig.js';

function useNow(options) {
  if (options?.updateInterval != null) {
    console.error("`useNow` doesn't support the `updateInterval` option in Server Components, the value will be ignored. If you need the value to update, you can convert the component to a Client Component.");
  }
  const config = useConfig('useNow');
  return config.now ?? getDefaultNow();
}

export { useNow as default };
