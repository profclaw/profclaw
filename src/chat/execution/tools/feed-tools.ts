/**
 * Feed Tools
 *
 * AI agent tools for managing RSS/Atom feeds and news digests.
 * Allows agents to add feeds, poll for articles, and generate digests.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../types.js';

// Param schemas

const FeedListParams = z.object({
  category: z.string().optional().describe('Filter by category (e.g., "ai", "security", "dev")'),
  enabled: z.boolean().optional().describe('Filter by enabled status'),
});

const FeedAddParams = z.object({
  name: z.string().min(1).describe('Name for the feed'),
  url: z.string().url().describe('RSS/Atom feed URL'),
  category: z.string().optional().describe('Category (e.g., "ai", "security", "dev")'),
  tags: z.array(z.string()).optional().describe('Tags for filtering'),
});

const FeedBundleInstallParams = z.object({
  bundle: z.string().describe('Bundle name to install (e.g., "ai-news", "dev-news", "security")'),
});

const FeedPollParams = z.object({
  feedId: z.string().optional().describe('Specific feed ID to poll. If omitted, polls all due feeds.'),
});

const FeedDigestParams = z.object({
  category: z.string().optional().describe('Filter articles by feed category'),
  hours: z.number().optional().describe('Look back N hours (default: 24)'),
  limit: z.number().optional().describe('Max articles to return (default: 20)'),
});

const FeedDiscoverParams = z.object({
  url: z.string().url().describe('Website URL to discover feed from'),
});

// Tools

export const feedListTool: ToolDefinition<z.infer<typeof FeedListParams>, unknown> = {
  name: 'feed_list',
  description: 'List configured RSS/Atom feeds. Shows feed names, URLs, categories, and article counts.',
  category: 'data',
  parameters: FeedListParams,
  securityLevel: 'safe',
  async execute(_context, params) {
    const { listFeeds } = await import('../../../feeds/index.js');
    const feeds = await listFeeds({ category: params.category, enabled: params.enabled });
    if (feeds.length === 0) {
      return { success: true, output: 'No feeds configured. Use feed_add to add feeds or feed_bundle_install to add a bundle.' };
    }
    const lines = feeds.map((f) => `- ${f.name} (${f.category}) - ${f.articleCount} articles${f.enabled ? '' : ' [disabled]'}`);
    return { success: true, output: `${feeds.length} feeds:\n${lines.join('\n')}`, data: feeds };
  },
};

export const feedAddTool: ToolDefinition<z.infer<typeof FeedAddParams>, unknown> = {
  name: 'feed_add',
  description: 'Add a new RSS/Atom feed source. The feed will be polled automatically for new articles.',
  category: 'data',
  parameters: FeedAddParams,
  securityLevel: 'safe',
  async execute(_context, params) {
    const { addFeed } = await import('../../../feeds/index.js');
    try {
      const feed = await addFeed(params);
      return { success: true, output: `Added feed: ${feed.name} (${feed.category}) - ${feed.url}`, data: feed };
    } catch (error) {
      return { success: false, error: { code: 'FEED_ADD_FAILED', message: error instanceof Error ? error.message : 'Failed' } };
    }
  },
};

export const feedBundleInstallTool: ToolDefinition<z.infer<typeof FeedBundleInstallParams>, unknown> = {
  name: 'feed_bundle_install',
  description: 'Install a pre-configured bundle of RSS feeds. Available bundles: ai-news, dev-news, security.',
  category: 'data',
  parameters: FeedBundleInstallParams,
  securityLevel: 'safe',
  async execute(_context, params) {
    const { addFeedBundle, FEED_BUNDLES } = await import('../../../feeds/index.js');
    if (!FEED_BUNDLES[params.bundle]) {
      return { success: false, error: { code: 'BUNDLE_NOT_FOUND', message: `Unknown bundle: ${params.bundle}. Available: ${Object.keys(FEED_BUNDLES).join(', ')}` } };
    }
    const feeds = await addFeedBundle(params.bundle);
    return { success: true, output: `Installed ${feeds.length} feeds from "${params.bundle}" bundle:\n${feeds.map((f) => `- ${f.name}`).join('\n')}`, data: { installed: feeds.length, feeds } };
  },
};

export const feedPollTool: ToolDefinition<z.infer<typeof FeedPollParams>, unknown> = {
  name: 'feed_poll',
  description: 'Poll RSS/Atom feeds for new articles. Can poll a specific feed or all due feeds.',
  category: 'data',
  parameters: FeedPollParams,
  securityLevel: 'safe',
  async execute(_context, params) {
    if (params.feedId) {
      const { pollFeed } = await import('../../../feeds/index.js');
      const result = await pollFeed(params.feedId);
      return { success: !result.errors, output: result.errors ? `Poll failed: ${result.errors}` : `Found ${result.newArticles} new articles`, data: result };
    }
    const { pollAllFeeds } = await import('../../../feeds/index.js');
    const result = await pollAllFeeds();
    return { success: true, output: `Polled ${result.total} feeds: ${result.newArticles} new articles, ${result.errors} errors`, data: result };
  },
};

export const feedDigestTool: ToolDefinition<z.infer<typeof FeedDigestParams>, unknown> = {
  name: 'feed_digest',
  description: 'Get recent articles from RSS feeds for building a news digest. Returns article titles, summaries, and URLs.',
  category: 'data',
  parameters: FeedDigestParams,
  securityLevel: 'safe',
  async execute(_context, params) {
    const { getDigestArticles, markAsDigested } = await import('../../../feeds/index.js');
    const hours = params.hours || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const articles = await getDigestArticles({ since, category: params.category, limit: params.limit || 20, undigestedOnly: true });
    if (articles.length === 0) {
      return { success: true, output: `No new articles in the last ${hours} hours${params.category ? ` for category "${params.category}"` : ''}. Try polling feeds first with feed_poll.` };
    }
    await markAsDigested(articles.map((a) => a.id));
    const lines = articles.map((a, i) => `${i + 1}. ${a.title}\n   ${a.url}\n   ${a.summary || '(no summary)'}`);
    return { success: true, output: `${articles.length} articles from the last ${hours} hours:\n\n${lines.join('\n\n')}`, data: articles };
  },
};

export const feedDiscoverTool: ToolDefinition<z.infer<typeof FeedDiscoverParams>, unknown> = {
  name: 'feed_discover',
  description: 'Auto-discover an RSS/Atom feed URL from a website. Checks link tags and common feed paths.',
  category: 'data',
  parameters: FeedDiscoverParams,
  securityLevel: 'safe',
  async execute(_context, params) {
    const { discoverFeedUrl } = await import('../../../feeds/index.js');
    const feedUrl = await discoverFeedUrl(params.url);
    if (feedUrl) {
      return { success: true, output: `Found feed: ${feedUrl}\nUse feed_add to subscribe.`, data: { feedUrl } };
    }
    return { success: true, output: `No feed found at ${params.url}. The site may not have an RSS/Atom feed.` };
  },
};

// Export all feed tools as array (cast for generic compatibility)
export const feedTools = [
  feedListTool,
  feedAddTool,
  feedBundleInstallTool,
  feedPollTool,
  feedDigestTool,
  feedDiscoverTool,
] as unknown as ToolDefinition[];
