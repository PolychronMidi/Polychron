import useConfig from './useConfig.js';

function useTimeZone() {
  const config = useConfig('useTimeZone');
  return config.timeZone;
}

export { useTimeZone as default };
