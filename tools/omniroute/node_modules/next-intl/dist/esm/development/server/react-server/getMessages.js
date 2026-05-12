import { cache } from 'react';
import getConfig from './getConfig.js';

function getMessagesFromConfig(config) {
  if (!config.messages) {
    throw new Error('No messages found. Have you configured them correctly? See https://next-intl.dev/docs/configuration#messages');
  }
  return config.messages;
}
async function getMessagesCachedImpl(locale) {
  const config = await getConfig(locale);
  return getMessagesFromConfig(config);
}
const getMessagesCached = cache(getMessagesCachedImpl);
async function getMessages(opts) {
  return getMessagesCached(opts?.locale);
}

export { getMessages as default, getMessagesFromConfig };
