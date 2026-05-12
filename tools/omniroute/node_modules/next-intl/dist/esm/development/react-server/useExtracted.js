import getServerExtractor from '../server/react-server/getServerExtractor.js';
import useConfig from './useConfig.js';

function useExtracted(namespace) {
  const config = useConfig('useExtracted');
  return getServerExtractor(config, namespace);
}

export { useExtracted as default };
