import useConfig from './useConfig.js';

function useLocale() {
  const config = useConfig('useLocale');
  return config.locale;
}

export { useLocale as default };
