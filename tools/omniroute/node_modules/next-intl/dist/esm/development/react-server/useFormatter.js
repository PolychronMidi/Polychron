import getFormatterCached from '../server/react-server/getServerFormatter.js';
import useConfig from './useConfig.js';

function useFormatter() {
  const config = useConfig('useFormatter');
  return getFormatterCached(config);
}

export { useFormatter as default };
