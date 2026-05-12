import createSharedNavigationFns from '../shared/createSharedNavigationFns.js';
import getServerLocale from './getServerLocale.js';

function createNavigation(routing) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {
    config,
    ...fns
  } = createSharedNavigationFns(getServerLocale, routing);
  function notSupported(hookName) {
    return () => {
      throw new Error(`\`${hookName}\` is not supported in Server Components. You can use this hook if you convert the calling component to a Client Component.`);
    };
  }
  return {
    ...fns,
    usePathname: notSupported('usePathname'),
    useRouter: notSupported('useRouter')
  };
}

export { createNavigation as default };
