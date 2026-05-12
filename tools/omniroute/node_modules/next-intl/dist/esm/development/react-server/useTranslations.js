import getServerTranslator from '../server/react-server/getServerTranslator.js';
import useConfig from './useConfig.js';

function useTranslations(...[namespace]) {
  const config = useConfig('useTranslations');
  return getServerTranslator(config, namespace);
}

export { useTranslations as default };
