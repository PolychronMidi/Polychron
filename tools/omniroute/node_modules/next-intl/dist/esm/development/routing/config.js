function receiveRoutingConfig(input) {
  return {
    ...input,
    localePrefix: receiveLocalePrefixConfig(input.localePrefix),
    localeCookie: receiveLocaleCookie(input.localeCookie),
    localeDetection: input.localeDetection ?? true,
    alternateLinks: input.alternateLinks ?? true
  };
}
function receiveLocaleCookie(localeCookie) {
  return localeCookie ?? true ? {
    name: 'NEXT_LOCALE',
    sameSite: 'lax',
    ...(typeof localeCookie === 'object' && localeCookie)

    // `path` needs to be provided based on a detected base path
    // that depends on the environment when setting a cookie
  } : false;
}
function receiveLocalePrefixConfig(localePrefix) {
  return typeof localePrefix === 'object' ? localePrefix : {
    mode: localePrefix || 'always'
  };
}

export { receiveRoutingConfig };
