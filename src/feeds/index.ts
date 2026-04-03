/**
 * Feed Engine - Public API
 *
 * Fully dynamic feed system - no hardcoded limitations.
 * Categories, sources, and bundles can all be extended at runtime.
 */

export {
  addFeed,
  addFeedBundle,
  listFeeds,
  getFeed,
  updateFeed,
  removeFeed,
  toggleFeed,
  pollFeed,
  pollAllFeeds,
  getDigestArticles,
  markAsDigested,
  getFeedStats,
  listCategories,
  discoverFeedUrl,
  parseFeedXml,
  registerFeedBundle,
  FEED_BUNDLES,
} from './feed-engine.js';

export type {
  FeedSource,
  FeedArticle,
  FeedDigest,
  FeedBundleEntry,
  CreateFeedParams,
} from './feed-engine.js';
