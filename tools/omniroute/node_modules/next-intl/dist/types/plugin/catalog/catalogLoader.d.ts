import type { CatalogLoaderConfig } from '../../extractor/types.js';
import type { TurbopackLoaderContext } from '../types.js';
/**
 * Parses and optimizes catalog files.
 *
 * Note that if we use a dynamic import like `import(`${locale}.json`)`, then
 * the loader will optimistically run for all candidates in this folder (both
 * during dev as well as at build time).
 */
export default function catalogLoader(this: TurbopackLoaderContext<CatalogLoaderConfig>, source: string): void;
