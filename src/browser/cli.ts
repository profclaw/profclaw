#!/usr/bin/env npx tsx
/**
 * Browser Automation CLI
 *
 * Command-line interface for testing browser automation tools.
 * This simulates how AI agents will call these tools.
 *
 * Usage:
 *   npx tsx src/browser/cli.ts navigate https://example.com
 *   npx tsx src/browser/cli.ts snapshot
 *   npx tsx src/browser/cli.ts click e5
 *   npx tsx src/browser/cli.ts type e3 "search query"
 *   npx tsx src/browser/cli.ts search "button"
 *   npx tsx src/browser/cli.ts screenshot
 *   npx tsx src/browser/cli.ts pages
 *   npx tsx src/browser/cli.ts close
 */

import { getBrowserService, resetBrowserService } from './service.js';
import { formatSnapshotResponse, formatSearchResponse } from './service.js';

const browser = getBrowserService();

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command) {
    printHelp();
    process.exit(1);
  }

  try {
    switch (command) {
      case 'navigate':
      case 'nav':
      case 'goto': {
        const url = args[0];
        if (!url) {
          console.error('Error: URL required');
          console.log('Usage: navigate <url>');
          process.exit(1);
        }
        console.log(`Navigating to ${url}...`);
        const result = await browser.navigate(url);
        console.log(`✓ Navigated to: ${result.url}`);
        console.log(`  Page ID: ${result.pageId}`);
        console.log(`  Title: ${result.title}`);

        // Also capture snapshot
        const snapshot = await browser.snapshot({ pageId: result.pageId });
        console.log('\n' + formatSnapshotResponse(snapshot));
        break;
      }

      case 'snapshot':
      case 'snap': {
        const pageId = args[0];
        const interactive = args.includes('--interactive') || args.includes('-i');
        const compress = !args.includes('--no-compress');

        console.log('Capturing snapshot...');
        const snapshot = await browser.snapshot({
          pageId,
          compress,
          interactive,
        });
        console.log(formatSnapshotResponse(snapshot));
        break;
      }

      case 'click': {
        const ref = args[0];
        if (!ref) {
          console.error('Error: Element ref required');
          console.log('Usage: click <ref> [--page <pageId>]');
          process.exit(1);
        }
        const pageId = getArg(args, '--page', '-p');

        console.log(`Clicking element ${ref}...`);
        const result = await browser.click({ ref, pageId });
        console.log(`✓ Clicked: ${result.ref}`);
        console.log(`  Executed: ${result.executed}`);

        // Show updated snapshot
        const snapshot = await browser.snapshot({ pageId });
        console.log('\n' + formatSnapshotResponse(snapshot));
        break;
      }

      case 'type': {
        const ref = args[0];
        const text = args[1];
        if (!ref || !text) {
          console.error('Error: Element ref and text required');
          console.log('Usage: type <ref> "<text>" [--submit] [--clear]');
          process.exit(1);
        }
        const pageId = getArg(args, '--page', '-p');
        const submit = args.includes('--submit') || args.includes('-s');
        const clear = args.includes('--clear') || args.includes('-c');

        console.log(`Typing "${text}" into ${ref}...`);
        const result = await browser.type({ ref, text, pageId, submit, clear });
        console.log(`✓ Typed: "${result.text}"`);
        console.log(`  Executed:\n${result.executed}`);

        // Show updated snapshot
        const snapshot = await browser.snapshot({ pageId });
        console.log('\n' + formatSnapshotResponse(snapshot));
        break;
      }

      case 'search':
      case 'find': {
        const pattern = args[0];
        if (!pattern) {
          console.error('Error: Search pattern required');
          console.log('Usage: search <pattern> [--limit <n>]');
          process.exit(1);
        }
        const pageId = getArg(args, '--page', '-p');
        const limitStr = getArg(args, '--limit', '-l');
        const limit = limitStr ? parseInt(limitStr, 10) : 20;
        const ignoreCase = !args.includes('--case-sensitive');

        console.log(`Searching for "${pattern}"...`);
        const results = await browser.search({ pattern, pageId, limit, ignoreCase });
        console.log(formatSearchResponse(results));
        break;
      }

      case 'screenshot':
      case 'ss': {
        const pageId = getArg(args, '--page', '-p');
        const fullPage = args.includes('--full') || args.includes('-f');
        const ref = getArg(args, '--ref', '-r');
        const output = getArg(args, '--output', '-o') || 'screenshot.png';

        console.log('Taking screenshot...');
        const result = await browser.screenshot({ pageId, fullPage, ref });

        // Save to file
        const fs = await import('fs');
        const buffer = Buffer.from(result.base64, 'base64');
        fs.writeFileSync(output, buffer);
        console.log(`✓ Screenshot saved: ${output} (${buffer.length} bytes)`);
        break;
      }

      case 'pages':
      case 'list':
      case 'tabs': {
        const pages = await browser.listPages();
        if (pages.length === 0) {
          console.log('No open pages. Use "navigate <url>" to open a page.');
        } else {
          console.log(`Open pages (${pages.length}):\n`);
          pages.forEach((p, i) => {
            console.log(`${i + 1}. [${p.id}] ${p.title}`);
            console.log(`   URL: ${p.url}`);
          });
        }
        break;
      }

      case 'close': {
        const pageId = args[0];
        if (pageId) {
          console.log(`Closing page ${pageId}...`);
          await browser.closePage(pageId);
          console.log(`✓ Page ${pageId} closed`);
        } else {
          console.log('Closing browser...');
          await browser.close();
          console.log('✓ Browser closed');
        }
        break;
      }

      case 'status': {
        const status = browser.getStatus();
        console.log('Browser Status:');
        console.log(`  Running: ${status.running ? 'Yes' : 'No'}`);
        console.log(`  Pages: ${status.pages}`);
        console.log(`  Headless: ${status.config.headless}`);
        console.log(`  Timeout: ${status.config.timeout}ms`);
        break;
      }

      case 'demo': {
        // Full demo workflow
        console.log('=== Browser Automation Demo ===\n');

        console.log('1. Navigating to GitHub...');
        const nav = await browser.navigate('https://github.com');
        console.log(`   ✓ Loaded: ${nav.title}\n`);

        console.log('2. Capturing snapshot...');
        const snapshot = await browser.snapshot({ pageId: nav.pageId, interactive: true });
        console.log(`   ✓ Found ${snapshot.refs.size} elements\n`);
        console.log('   Snapshot preview:');
        console.log(snapshot.snapshot.split('\n').slice(0, 15).map(l => '   ' + l).join('\n'));
        console.log('   ...\n');

        console.log('3. Searching for "Sign in"...');
        const search = await browser.search({ pattern: 'Sign in', pageId: nav.pageId });
        console.log(`   ✓ Found ${search.matchCount} matches`);
        if (search.results.length > 0) {
          console.log(`   First match: ${search.results[0].ref} - "${search.results[0].name}"\n`);
        }

        console.log('4. Taking screenshot...');
        const ss = await browser.screenshot({ pageId: nav.pageId });
        console.log(`   ✓ Screenshot: ${ss.base64.length} bytes\n`);

        console.log('5. Closing browser...');
        await browser.close();
        console.log('   ✓ Done!\n');

        console.log('=== Demo Complete ===');
        break;
      }

      case 'help':
      case '-h':
      case '--help':
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function getArg(args: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) {
      return args[idx + 1];
    }
  }
  return undefined;
}

function printHelp() {
  console.log(`
Browser Automation CLI - Test browser tools for AI agents

USAGE:
  npx tsx src/browser/cli.ts <command> [options]

COMMANDS:
  navigate <url>         Navigate to URL (alias: nav, goto)
  snapshot               Capture accessibility snapshot (alias: snap)
  click <ref>            Click element by ref
  type <ref> "<text>"    Type text into element
  search <pattern>       Search content with regex (alias: find)
  screenshot             Take screenshot (alias: ss)
  pages                  List open pages (alias: list, tabs)
  close [pageId]         Close page or browser
  status                 Show browser status
  demo                   Run full demo workflow
  help                   Show this help

OPTIONS:
  --page, -p <id>        Specify page ID
  --interactive, -i      Only interactive elements (snapshot)
  --no-compress          Don't compress snapshot
  --submit, -s           Press Enter after typing
  --clear, -c            Clear field before typing
  --full, -f             Full page screenshot
  --ref, -r <ref>        Screenshot specific element
  --output, -o <file>    Screenshot output file
  --limit, -l <n>        Search result limit

EXAMPLES:
  # Navigate and get snapshot
  npx tsx src/browser/cli.ts navigate https://example.com

  # Search for buttons
  npx tsx src/browser/cli.ts search "button|submit"

  # Click an element
  npx tsx src/browser/cli.ts click e5

  # Type and submit
  npx tsx src/browser/cli.ts type e3 "hello world" --submit

  # Full demo
  npx tsx src/browser/cli.ts demo
`);
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nCleaning up...');
  await resetBrowserService();
  process.exit(0);
});

main().catch(console.error);
