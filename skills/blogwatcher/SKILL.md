---
name: blogwatcher
description: Monitor RSS/Atom feeds and blogs for new posts. Fetch, parse, and summarize the latest content from any feed URL.
version: 1.0.0
metadata: {"profclaw": {"emoji": "📰", "category": "utility", "priority": 50, "triggerPatterns": ["rss", "blog", "feed", "monitor blog", "news feed", "latest posts", "check feed", "blog updates"]}}
---

# BlogWatcher

You are an RSS/blog monitoring assistant. When users want to check for new posts, monitor feeds, or get summaries of the latest content from blogs and news sites, you fetch and parse RSS/Atom feeds.

## What This Skill Does

- Fetches and parses RSS 2.0 and Atom feeds
- Lists latest posts with titles, dates, and summaries
- Filters posts by date (today, this week, etc.)
- Summarizes article content from feed entries
- Discovers feed URLs from website homepages

## Fetching a Feed

```bash
# Fetch an RSS feed and extract items
curl -s --max-time 10 "https://example.com/feed.xml" | \
  python3 -c "
import sys, xml.etree.ElementTree as ET
from datetime import datetime

content = sys.stdin.read()
root = ET.fromstring(content)

# Handle both RSS and Atom
ns = {'atom': 'http://www.w3.org/2005/Atom'}

# RSS 2.0
items = root.findall('.//item')
if items:
    for item in items[:10]:
        title = item.findtext('title', '').strip()
        link = item.findtext('link', '').strip()
        pub = item.findtext('pubDate', item.findtext('dc:date', ''))
        desc = item.findtext('description', '')[:150].strip()
        print(f'--- {title}')
        print(f'    {pub}')
        print(f'    {link}')
        if desc:
            print(f'    {desc}...')
        print()
else:
    # Atom feed
    entries = root.findall('atom:entry', ns)
    for entry in entries[:10]:
        title = entry.findtext('atom:title', '', ns).strip()
        link_el = entry.find('atom:link', ns)
        link = link_el.get('href', '') if link_el is not None else ''
        updated = entry.findtext('atom:updated', '', ns)
        summary = entry.findtext('atom:summary', '')[:150].strip()
        print(f'--- {title}')
        print(f'    {updated}')
        print(f'    {link}')
        if summary:
            print(f'    {summary}...')
        print()
"
```

## Fetch Latest N Posts

```bash
# Get latest 5 posts from a feed
FEED_URL="https://blog.example.com/rss"
N=5
curl -s --max-time 10 "$FEED_URL" | \
  python3 -c "
import sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
items = root.findall('.//item')[:$N]
for i, item in enumerate(items, 1):
    title = item.findtext('title','').strip()
    link = item.findtext('link','').strip()
    print(f'{i}. {title}')
    print(f'   {link}')
"
```

## Discover Feed URL from Homepage

```bash
# Look for feed link in HTML head
curl -s --max-time 10 "https://example.com" | \
  grep -oE 'href="[^"]*\.(rss|xml|atom)[^"]*"' | \
  head -5

# Common feed paths to try
for path in "/feed" "/rss" "/atom.xml" "/feed.xml" "/rss.xml" "/blog/feed"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://example.com${path}")
  if [ "$STATUS" = "200" ]; then
    echo "Found feed at: https://example.com${path}"
    break
  fi
done
```

## Filter Posts by Date

```bash
# Show only posts from the last 7 days
curl -s --max-time 10 "$FEED_URL" | \
  python3 -c "
import sys, xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

root = ET.fromstring(sys.stdin.read())
cutoff = datetime.now(timezone.utc) - timedelta(days=7)

for item in root.findall('.//item'):
    pub_str = item.findtext('pubDate', '')
    try:
        pub = parsedate_to_datetime(pub_str)
        if pub > cutoff:
            print(f\"{pub.strftime('%Y-%m-%d')} - {item.findtext('title','').strip()}\")
    except Exception:
        pass
"
```

## Monitoring Multiple Feeds

Store a feed list and check all at once:

```bash
FEEDS=(
  "https://news.ycombinator.com/rss"
  "https://www.theverge.com/rss/index.xml"
  "https://lobste.rs/rss"
)

for feed in "${FEEDS[@]}"; do
  echo "=== $feed ==="
  curl -s --max-time 8 "$feed" | \
    python3 -c "
import sys, xml.etree.ElementTree as ET
try:
    root = ET.fromstring(sys.stdin.read())
    for item in root.findall('.//item')[:3]:
        print(f'  - {item.findtext(\"title\",\"\").strip()}')
except: print('  [parse error]')
"
done
```

## Example Interactions

**User**: What's new on Hacker News?
**You**: *(fetches https://news.ycombinator.com/rss, shows top 10 titles with links)*

**User**: Check the latest posts from this blog: example.com/blog
**You**: *(discovers feed URL, fetches, shows last 5 posts with dates)*

**User**: Any new posts this week from my feeds?
**You**: *(fetches configured feeds, filters to last 7 days, presents filtered results)*

## Safety Rules

- **Set timeouts** on all curl requests (max-time 10)
- **Handle** feed parse errors gracefully - some feeds are malformed
- **Rate limit** - do not poll the same feed more than once per 15 minutes
- **Respect** robots.txt and any stated polling limits from feed providers

## Best Practices

1. Always set `--max-time` on curl to avoid hanging on slow feeds
2. Try Atom format first if RSS parsing fails
3. Limit to latest 10 items by default - avoid overwhelming output
4. Cache feed responses locally when polling multiple times per session
5. Provide clickable links for every post listed
