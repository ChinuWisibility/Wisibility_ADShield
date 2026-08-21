/**
 * Page catalog — re-exports from Benchmark Registry (v2 compatibility).
 */
import { buildPageCatalogMaps, SHARED_BACKENDS } from "./registry/index.mjs";

const maps = buildPageCatalogMaps();

export const PAGE_FE = maps.PAGE_FE;
export const PAGE_METRIC = maps.PAGE_METRIC;
export const PAGE_ROUTES = maps.PAGE_ROUTES;
export { SHARED_BACKENDS };

export function sharedBackendForPage(pageId) {
  return SHARED_BACKENDS.find((g) => g.pages.includes(pageId)) || null;
}
