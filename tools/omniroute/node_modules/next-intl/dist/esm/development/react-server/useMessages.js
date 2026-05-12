import { getMessagesFromConfig } from '../server/react-server/getMessages.js';
import useConfig from './useConfig.js';

function useMessages() {
  const config = useConfig('useMessages');
  return getMessagesFromConfig(config);
}

export { useMessages as default };
