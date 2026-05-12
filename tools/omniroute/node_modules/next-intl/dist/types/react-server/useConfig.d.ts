import getConfig from '../server/react-server/getConfig.js';
export default function useConfig(hookName: string): Awaited<ReturnType<typeof getConfig>>;
