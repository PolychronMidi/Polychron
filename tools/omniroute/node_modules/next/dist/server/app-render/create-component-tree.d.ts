import type { ComponentType } from 'react';
import type { CacheNodeSeedData } from '../../shared/lib/app-router-types';
import type { PreloadCallbacks } from './types';
import type { LoaderTree } from '../lib/app-dir-module';
import type { AppRenderContext, GetDynamicParamFromSegment } from './app-render';
import type { Params } from '../request/params';
type HTTPAccessErrorStatusCode = 404 | 403 | 401;
export type PrerenderHTTPErrorState = {
    boundaryTree: LoaderTree;
    triggeredStatus: HTTPAccessErrorStatusCode;
};
/**
 * Use the provided loader tree to create the React Component tree.
 */
export declare function createComponentTree(props: {
    loaderTree: LoaderTree;
    parentParams: Params;
    parentOptionalCatchAllParamName: string | null;
    parentRuntimePrefetchable: false;
    rootLayoutIncluded: boolean;
    injectedCSS: Set<string>;
    injectedJS: Set<string>;
    injectedFontPreloadTags: Set<string>;
    ctx: AppRenderContext;
    missingSlots?: Set<string>;
    preloadCallbacks: PreloadCallbacks;
    authInterrupts: boolean;
    MetadataOutlet: ComponentType;
    prerenderHTTPError?: PrerenderHTTPErrorState;
}): Promise<CacheNodeSeedData>;
export declare function getRootParams(loaderTree: LoaderTree, getDynamicParamFromSegment: GetDynamicParamFromSegment): Params;
export {};
