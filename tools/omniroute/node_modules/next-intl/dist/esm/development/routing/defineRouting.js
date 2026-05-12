function defineRouting(config) {
  if (config.domains) {
    validateUniqueLocalesPerDomain(config.domains);
  }
  return config;
}
function validateUniqueLocalesPerDomain(domains) {
  const domainsByLocale = new Map();
  for (const {
    domain,
    locales
  } of domains) {
    for (const locale of locales) {
      const localeDomains = domainsByLocale.get(locale) || new Set();
      localeDomains.add(domain);
      domainsByLocale.set(locale, localeDomains);
    }
  }
  const duplicateLocaleMessages = Array.from(domainsByLocale.entries()).filter(([, localeDomains]) => localeDomains.size > 1).map(([locale, localeDomains]) => `- "${locale}" is used by: ${Array.from(localeDomains).join(', ')}`);
  if (duplicateLocaleMessages.length > 0) {
    console.warn('Locales are expected to be unique per domain, but found overlap:\n' + duplicateLocaleMessages.join('\n') + '\nPlease see https://next-intl.dev/docs/routing/configuration#domains');
  }
}

export { defineRouting as default };
