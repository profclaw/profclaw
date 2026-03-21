/**
 * RSS/Atom Feed Engine
 *
 * Fetches, parses, and stores articles from RSS/Atom feeds.
 * Provides deduplication, categorization, and AI summarization integration.
 *
 * Fully dynamic - categories, sources, and bundles can be extended at runtime.
 * No hardcoded limitations on feed types, categories, or article counts.
 *
 * Used by cron jobs to power "morning AI news digest" and similar automations.
 */

import type { InValue } from '@libsql/client';
import { getClient } from '../storage/index.js';
import { createContextualLogger } from '../utils/logger.js';

const log = createContextualLogger('FeedEngine');

// Types - all string-based for maximum flexibility

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  /** Free-form category - any string is valid */
  category: string;
  /** Optional tags for fine-grained filtering */
  tags: string[];
  enabled: boolean;
  /** How often to poll (ms). Defaults to 1 hour */
  pollIntervalMs: number;
  lastPolledAt?: Date;
  lastError?: string;
  articleCount: number;
  /** Custom metadata - extensible per feed */
  metadata: Record<string, unknown>;
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedArticle {
  id: string;
  feedId: string;
  title: string;
  url: string;
  summary?: string;
  content?: string;
  author?: string;
  publishedAt?: Date;
  fetchedAt: Date;
  /** AI-generated summary (populated by digest job) */
  aiSummary?: string;
  /** Whether this article has been included in a digest */
  digestedAt?: Date;
  /** Content hash for deduplication */
  contentHash: string;
}

export interface CreateFeedParams {
  name: string;
  url: string;
  category?: string;
  tags?: string[];
  pollIntervalMs?: number;
  metadata?: Record<string, unknown>;
  userId?: string;
}

export interface FeedDigest {
  category?: string;
  articles: FeedArticle[];
  fetchedAt: Date;
}

export interface FeedBundleEntry {
  name: string;
  url: string;
  category?: string;
  tags?: string[];
}

// Pre-configured feed bundles (starter packs - users and agents can add more at runtime)

export const FEED_BUNDLES: Record<string, FeedBundleEntry[]> = {
  'ai-news': [
    { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml', category: 'ai' },
    { name: 'Anthropic News', url: 'https://www.anthropic.com/rss.xml', category: 'ai' },
    { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', category: 'ai' },
    { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', category: 'ai' },
    { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', category: 'ai' },
    { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/', category: 'ai' },
  ],
  'dev-news': [
    { name: 'Hacker News (Best)', url: 'https://hnrss.org/best', category: 'dev' },
    { name: 'Lobsters', url: 'https://lobste.rs/rss', category: 'dev' },
    { name: 'Dev.to Top', url: 'https://dev.to/feed', category: 'dev' },
  ],
  'security': [
    { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', category: 'security' },
    { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'security' },
    { name: 'Schneier on Security', url: 'https://www.schneier.com/feed/', category: 'security' },
  ],
};

/**
 * Register a custom feed bundle at runtime.
 * Agents and users can call this to extend the available bundles.
 */
export function registerFeedBundle(name: string, feeds: FeedBundleEntry[]): void {
  FEED_BUNDLES[name] = feeds;
  log.info(`Registered feed bundle: ${name} (${feeds.length} feeds)`);
}

// Database initialization

const FEEDS_TABLE = `
CREATE TABLE IF NOT EXISTS feed_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  poll_interval_ms INTEGER NOT NULL DEFAULT 3600000,
  last_polled_at TEXT,
  last_error TEXT,
  article_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const ARTICLES_TABLE = `
CREATE TABLE IF NOT EXISTS feed_articles (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  author TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  ai_summary TEXT,
  digested_at TEXT,
  content_hash TEXT NOT NULL,
  UNIQUE(feed_id, content_hash)
)`;

const ARTICLES_INDEX = `CREATE INDEX IF NOT EXISTS idx_articles_feed_date ON feed_articles(feed_id, fetched_at DESC)`;
const ARTICLES_URL_INDEX = `CREATE INDEX IF NOT EXISTS idx_articles_url ON feed_articles(url)`;

let tablesInitialized = false;

async function ensureTables(): Promise<void> {
  if (tablesInitialized) return;
  const client = getClient();
  await client.execute(FEEDS_TABLE);
  await client.execute(ARTICLES_TABLE);
  await client.execute(ARTICLES_INDEX);
  await client.execute(ARTICLES_URL_INDEX);
  tablesInitialized = true;
}

// Feed CRUD

export async function addFeed(params: CreateFeedParams): Promise<FeedSource> {
  await ensureTables();
  const client = getClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await client.execute({
    sql: `INSERT INTO feed_sources (id, name, url, category, tags, poll_interval_ms, metadata, user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, params.name, params.url,
      params.category || 'general',
      JSON.stringify(params.tags || []),
      params.pollIntervalMs || 3600000,
      JSON.stringify(params.metadata || {}),
      params.userId || null,
      now, now,
    ],
  });

  log.info(`Added feed: ${params.name} (${params.url})`);

  return {
    id,
    name: params.name,
    url: params.url,
    category: params.category || 'general',
    tags: params.tags || [],
    enabled: true,
    pollIntervalMs: params.pollIntervalMs || 3600000,
    articleCount: 0,
    metadata: params.metadata || {},
    userId: params.userId,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

export async function addFeedBundle(
  bundleName: string,
  userId?: string
): Promise<FeedSource[]> {
  const bundle = FEED_BUNDLES[bundleName];
  if (!bundle) {
    throw new Error(`Unknown feed bundle: ${bundleName}. Available: ${Object.keys(FEED_BUNDLES).join(', ')}`);
  }

  const results: FeedSource[] = [];
  for (const feed of bundle) {
    try {
      const source = await addFeed({ ...feed, userId });
      results.push(source);
    } catch (error) {
      // Skip duplicates silently
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        log.debug(`Feed already exists: ${feed.url}`);
      } else {
        log.error(`Failed to add feed ${feed.name}:`, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  return results;
}

export async function listFeeds(filters?: {
  category?: string;
  tag?: string;
  enabled?: boolean;
  userId?: string;
}): Promise<FeedSource[]> {
  await ensureTables();
  const client = getClient();

  let sql = 'SELECT * FROM feed_sources WHERE 1=1';
  const args: InValue[] = [];

  if (filters?.category) {
    sql += ' AND category = ?';
    args.push(filters.category);
  }
  if (filters?.tag) {
    // Search within JSON array
    sql += ' AND tags LIKE ?';
    args.push(`%"${filters.tag}"%`);
  }
  if (filters?.enabled !== undefined) {
    sql += ' AND enabled = ?';
    args.push(filters.enabled ? 1 : 0);
  }
  if (filters?.userId) {
    sql += ' AND user_id = ?';
    args.push(filters.userId);
  }

  sql += ' ORDER BY name ASC';

  const result = await client.execute({ sql, args });
  return result.rows.map(mapFeedRow);
}

export async function getFeed(id: string): Promise<FeedSource | null> {
  await ensureTables();
  const client = getClient();
  const result = await client.execute({ sql: 'SELECT * FROM feed_sources WHERE id = ?', args: [id] });
  return result.rows.length > 0 ? mapFeedRow(result.rows[0]) : null;
}

export async function updateFeed(id: string, updates: Partial<Pick<CreateFeedParams, 'name' | 'category' | 'tags' | 'pollIntervalMs' | 'metadata'>>): Promise<void> {
  await ensureTables();
  const client = getClient();

  const sets: string[] = [];
  const args: InValue[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); args.push(updates.name); }
  if (updates.category !== undefined) { sets.push('category = ?'); args.push(updates.category); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); args.push(JSON.stringify(updates.tags)); }
  if (updates.pollIntervalMs !== undefined) { sets.push('poll_interval_ms = ?'); args.push(updates.pollIntervalMs); }
  if (updates.metadata !== undefined) { sets.push('metadata = ?'); args.push(JSON.stringify(updates.metadata)); }

  if (sets.length === 0) return;

  sets.push('updated_at = datetime("now")');
  args.push(id);

  await client.execute({
    sql: `UPDATE feed_sources SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });
}

export async function removeFeed(id: string): Promise<boolean> {
  await ensureTables();
  const client = getClient();
  const result = await client.execute({ sql: 'DELETE FROM feed_sources WHERE id = ?', args: [id] });
  return result.rowsAffected > 0;
}

export async function toggleFeed(id: string, enabled: boolean): Promise<void> {
  await ensureTables();
  const client = getClient();
  await client.execute({
    sql: 'UPDATE feed_sources SET enabled = ?, updated_at = datetime("now") WHERE id = ?',
    args: [enabled ? 1 : 0, id],
  });
}

// Feed polling and parsing

/**
 * Parse an RSS/Atom XML feed into articles.
 * Lightweight regex-based parser - no external dependencies needed.
 */
export function parseFeedXml(xml: string): Array<{
  title: string;
  url: string;
  summary?: string;
  content?: string;
  author?: string;
  publishedAt?: string;
}> {
  const articles: Array<{
    title: string;
    url: string;
    summary?: string;
    content?: string;
    author?: string;
    publishedAt?: string;
  }> = [];

  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

  if (isAtom) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];
      const title = extractTag(entry, 'title');
      const link = extractAtomLink(entry);
      const summary = extractTag(entry, 'summary') || extractTag(entry, 'content');
      const author = extractTag(entry, 'name');
      const published = extractTag(entry, 'published') || extractTag(entry, 'updated');

      if (title && link) {
        articles.push({
          title: decodeHtmlEntities(title),
          url: link,
          summary: summary ? decodeHtmlEntities(stripHtml(summary)).slice(0, 500) : undefined,
          author: author ? decodeHtmlEntities(author) : undefined,
          publishedAt: published || undefined,
        });
      }
    }
  } else {
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = extractTag(item, 'title');
      const link = extractTag(item, 'link');
      const description = extractTag(item, 'description');
      const contentEncoded = extractTag(item, 'content:encoded');
      const author = extractTag(item, 'dc:creator') || extractTag(item, 'author');
      const pubDate = extractTag(item, 'pubDate');

      if (title && link) {
        articles.push({
          title: decodeHtmlEntities(title),
          url: link.trim(),
          summary: description ? decodeHtmlEntities(stripHtml(description)).slice(0, 500) : undefined,
          content: contentEncoded ? decodeHtmlEntities(stripHtml(contentEncoded)).slice(0, 2000) : undefined,
          author: author ? decodeHtmlEntities(author) : undefined,
          publishedAt: pubDate || undefined,
        });
      }
    }
  }

  return articles;
}

/**
 * Poll a single feed source and store new articles.
 */
export async function pollFeed(feedId: string): Promise<{ newArticles: number; errors?: string }> {
  await ensureTables();
  const client = getClient();

  const feedResult = await client.execute({ sql: 'SELECT * FROM feed_sources WHERE id = ?', args: [feedId] });
  if (feedResult.rows.length === 0) {
    return { newArticles: 0, errors: 'Feed not found' };
  }

  const feed = mapFeedRow(feedResult.rows[0]);
  let newArticles = 0;

  try {
    const response = await fetch(feed.url, {
      headers: {
        'User-Agent': 'profClaw/2.0 Feed Reader',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();
    const parsed = parseFeedXml(xml);

    for (const article of parsed) {
      const contentHash = hashString(`${feed.id}:${article.url}:${article.title}`);

      try {
        await client.execute({
          sql: `INSERT OR IGNORE INTO feed_articles
                (id, feed_id, title, url, summary, content, author, published_at, fetched_at, content_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
          args: [
            crypto.randomUUID(),
            feedId,
            article.title,
            article.url,
            article.summary || null,
            article.content || null,
            article.author || null,
            article.publishedAt || null,
            contentHash,
          ],
        });
        newArticles++;
      } catch {
        // Duplicate - skip
      }
    }

    await client.execute({
      sql: `UPDATE feed_sources SET
              last_polled_at = datetime('now'),
              last_error = NULL,
              article_count = article_count + ?,
              updated_at = datetime('now')
            WHERE id = ?`,
      args: [newArticles, feedId],
    });

    log.info(`Polled ${feed.name}: ${newArticles} new articles from ${parsed.length} total`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await client.execute({
      sql: `UPDATE feed_sources SET last_polled_at = datetime('now'), last_error = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [errMsg, feedId],
    });
    log.error(`Feed poll failed for ${feed.name}:`, error instanceof Error ? error : new Error(errMsg));
    return { newArticles: 0, errors: errMsg };
  }

  return { newArticles };
}

/**
 * Poll all enabled feeds that are due for polling.
 */
export async function pollAllFeeds(): Promise<{ total: number; newArticles: number; errors: number }> {
  const feeds = await listFeeds({ enabled: true });
  let total = 0;
  let newArticles = 0;
  let errors = 0;

  for (const feed of feeds) {
    if (feed.lastPolledAt) {
      const timeSincePoll = Date.now() - feed.lastPolledAt.getTime();
      if (timeSincePoll < feed.pollIntervalMs) continue;
    }

    total++;
    const result = await pollFeed(feed.id);
    newArticles += result.newArticles;
    if (result.errors) errors++;

    // Small delay between feeds to be nice to servers
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  log.info(`Feed poll complete: ${total} feeds polled, ${newArticles} new articles, ${errors} errors`);
  return { total, newArticles, errors };
}

/**
 * Get recent articles for a digest.
 * All filters are optional - the engine imposes no limits by default.
 */
export async function getDigestArticles(options?: {
  since?: Date;
  category?: string;
  tag?: string;
  feedId?: string;
  limit?: number;
  undigestedOnly?: boolean;
}): Promise<FeedArticle[]> {
  await ensureTables();
  const client = getClient();

  const since = options?.since || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const limit = options?.limit || 50;

  let sql = `
    SELECT a.*
    FROM feed_articles a
    JOIN feed_sources f ON a.feed_id = f.id
    WHERE a.fetched_at >= ?
  `;
  const args: InValue[] = [since.toISOString()];

  if (options?.category) {
    sql += ' AND f.category = ?';
    args.push(options.category);
  }
  if (options?.tag) {
    sql += ' AND f.tags LIKE ?';
    args.push(`%"${options.tag}"%`);
  }
  if (options?.feedId) {
    sql += ' AND a.feed_id = ?';
    args.push(options.feedId);
  }
  if (options?.undigestedOnly) {
    sql += ' AND a.digested_at IS NULL';
  }

  sql += ' ORDER BY a.fetched_at DESC LIMIT ?';
  args.push(limit);

  const result = await client.execute({ sql, args });
  return result.rows.map(mapArticleRow);
}

/**
 * Mark articles as digested (included in a delivered digest).
 */
export async function markAsDigested(articleIds: string[]): Promise<void> {
  if (articleIds.length === 0) return;
  await ensureTables();
  const client = getClient();

  // Batch in groups of 100 for safety
  for (let i = 0; i < articleIds.length; i += 100) {
    const batch = articleIds.slice(i, i + 100);
    const placeholders = batch.map(() => '?').join(',');
    await client.execute({
      sql: `UPDATE feed_articles SET digested_at = datetime('now') WHERE id IN (${placeholders})`,
      args: batch,
    });
  }
}

/**
 * Get feed statistics.
 */
export async function getFeedStats(): Promise<{
  totalFeeds: number;
  enabledFeeds: number;
  totalArticles: number;
  articlesToday: number;
  byCategory: Record<string, number>;
}> {
  await ensureTables();
  const client = getClient();

  const total = await client.execute('SELECT COUNT(*) as count FROM feed_sources');
  const enabled = await client.execute('SELECT COUNT(*) as count FROM feed_sources WHERE enabled = 1');
  const articles = await client.execute('SELECT COUNT(*) as count FROM feed_articles');
  const today = await client.execute(
    `SELECT COUNT(*) as count FROM feed_articles WHERE fetched_at >= datetime('now', '-1 day')`
  );

  const catResult = await client.execute(
    'SELECT category, COUNT(*) as count FROM feed_sources GROUP BY category'
  );

  const byCategory: Record<string, number> = {};
  for (const row of catResult.rows) {
    byCategory[row.category as string] = row.count as number;
  }

  return {
    totalFeeds: total.rows[0].count as number,
    enabledFeeds: enabled.rows[0].count as number,
    totalArticles: articles.rows[0].count as number,
    articlesToday: today.rows[0].count as number,
    byCategory,
  };
}

/**
 * List all distinct categories currently in use.
 */
export async function listCategories(): Promise<string[]> {
  await ensureTables();
  const client = getClient();
  const result = await client.execute('SELECT DISTINCT category FROM feed_sources ORDER BY category');
  return result.rows.map((r) => r.category as string);
}

/**
 * Auto-discover feed URL from a website.
 * Fetches the page and looks for RSS/Atom link tags.
 */
export async function discoverFeedUrl(websiteUrl: string): Promise<string | null> {
  try {
    const response = await fetch(websiteUrl, {
      headers: { 'User-Agent': 'profClaw/2.0 Feed Discovery' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Look for <link rel="alternate" type="application/rss+xml" href="..." />
    const rssMatch = html.match(/<link[^>]*type="application\/(?:rss|atom)\+xml"[^>]*href="([^"]+)"/i);
    if (rssMatch) {
      const href = rssMatch[1];
      // Resolve relative URLs
      if (href.startsWith('http')) return href;
      const base = new URL(websiteUrl);
      return new URL(href, base).toString();
    }

    // Fallback: try common feed paths
    const commonPaths = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/blog/rss.xml'];
    for (const path of commonPaths) {
      try {
        const feedUrl = new URL(path, websiteUrl).toString();
        const feedResp = await fetch(feedUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        if (feedResp.ok) return feedUrl;
      } catch {
        // Try next
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Helper functions

function extractTag(xml: string, tagName: string): string | null {
  const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, 'i');
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

function extractAtomLink(entry: string): string | null {
  const linkRegex = /<link[^>]*href="([^"]*)"[^>]*(?:rel="alternate")?[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  let bestLink: string | null = null;

  while ((match = linkRegex.exec(entry)) !== null) {
    const fullTag = match[0];
    const href = match[1];
    if (fullTag.includes('rel="alternate"') || !bestLink) {
      bestLink = href;
    }
  }
  return bestLink;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code)));
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function mapFeedRow(row: Record<string, unknown>): FeedSource {
  let tags: string[] = [];
  try { tags = JSON.parse((row.tags as string) || '[]') as string[]; } catch { /* empty */ }

  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse((row.metadata as string) || '{}') as Record<string, unknown>; } catch { /* empty */ }

  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    category: (row.category as string) || 'general',
    tags,
    enabled: row.enabled === 1,
    pollIntervalMs: (row.poll_interval_ms as number) || 3600000,
    lastPolledAt: row.last_polled_at ? new Date(row.last_polled_at as string) : undefined,
    lastError: row.last_error as string | undefined,
    articleCount: (row.article_count as number) || 0,
    metadata,
    userId: row.user_id as string | undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapArticleRow(row: Record<string, unknown>): FeedArticle {
  return {
    id: row.id as string,
    feedId: row.feed_id as string,
    title: row.title as string,
    url: row.url as string,
    summary: row.summary as string | undefined,
    content: row.content as string | undefined,
    author: row.author as string | undefined,
    publishedAt: row.published_at ? new Date(row.published_at as string) : undefined,
    fetchedAt: new Date(row.fetched_at as string),
    aiSummary: row.ai_summary as string | undefined,
    digestedAt: row.digested_at ? new Date(row.digested_at as string) : undefined,
    contentHash: row.content_hash as string,
  };
}
