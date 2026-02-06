/**
 * Search Provider Plugins
 *
 * Export all built-in search provider definitions.
 */

export { SERPER_DEFINITION } from './serper.js';
export { TAVILY_DEFINITION } from './tavily.js';
export { BRAVE_DEFINITION } from './brave.js';
export { DUCKDUCKGO_DEFINITION } from './duckduckgo.js';
export { SEARXNG_DEFINITION } from './searxng.js';

import { SERPER_DEFINITION } from './serper.js';
import { TAVILY_DEFINITION } from './tavily.js';
import { BRAVE_DEFINITION } from './brave.js';
import { DUCKDUCKGO_DEFINITION } from './duckduckgo.js';
import { SEARXNG_DEFINITION } from './searxng.js';
import type { SearchPluginDefinition } from '../types.js';

export const ALL_SEARCH_PLUGINS: SearchPluginDefinition[] = [
  SERPER_DEFINITION,
  TAVILY_DEFINITION,
  BRAVE_DEFINITION,
  DUCKDUCKGO_DEFINITION,
  SEARXNG_DEFINITION,
];
