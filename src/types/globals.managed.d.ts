// Managed globals single source of truth for both:
// 1) TypeScript ambient declarations (`src/types/**/*.d.ts` include)
// 2) ESLint global map (parsed directly by `eslint.config.mjs`)
//
// Keep one declaration per line in the form:
//   declare var NAME: any;
//
// This file is intentionally hand-edited.

declare var COMPOSER_POOL_SELECTION_STRATEGY: any;
declare var COMPOSER_PROFILE_AUDIT: any;
declare var COMPOSER_PROFILE_POOLS: any;
declare var COMPOSER_TYPE_PROFILES: any;
declare var COMPOSER_TYPE_PROFILE_SOURCES: any;
declare var ComposerProfileUtils: any;
declare var ComposerProfileValidation: any;
declare var ComposerRuntimeProfileAdapter: any;
declare var getComposerPoolOrFail: any;
declare var getComposerProfileAuditOrFail: any;
declare var getComposerTypeProfileOrFail: any;
declare var getComposerTypeProfilesOrFail: any;
declare var getDefaultComposerPoolOrFail: any;
declare var selectComposerPoolOrFail: any;
