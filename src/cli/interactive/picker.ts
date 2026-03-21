/**
 * Interactive Picker
 *
 * Arrow-key navigable selection menu for the terminal.
 * Used for session picker, model picker, provider picker, etc.
 *
 * @package profclaw-interactive (future standalone)
 */

import chalk from 'chalk';
import * as readline from 'node:readline';

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
  dimLabel?: boolean;
}

export interface PickerOptions {
  title: string;
  items: PickerItem[];
  /** Allow filtering by typing */
  filterable?: boolean;
  /** Max items to show at once (scrolls) */
  pageSize?: number;
}

/**
 * Show an interactive picker menu.
 * Returns the selected item ID, or null if cancelled (Escape/Ctrl+C).
 */
export function showPicker(options: PickerOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const { title, items, pageSize = 10 } = options;
    const filterable = options.filterable !== false;

    if (items.length === 0) {
      console.log(chalk.dim('  No items to select.'));
      resolve(null);
      return;
    }

    let selectedIndex = 0;
    let filter = '';
    let filteredItems = [...items];
    let scrollOffset = 0;

    const gold = chalk.hex('#F6C453');
    const dim = chalk.dim;
    const mint = chalk.hex('#7DD3A5');
    const border = chalk.hex('#3C414B');
    const H = '\u2500';
    const POINTER = '\u25b8'; // ▸
    const w = Math.min((process.stdout.columns || 80) - 4, 68);

    function applyFilter(): void {
      if (!filter) {
        filteredItems = [...items];
      } else {
        const lower = filter.toLowerCase();
        filteredItems = items.filter(
          (item) =>
            item.label.toLowerCase().includes(lower) ||
            item.id.toLowerCase().includes(lower) ||
            (item.description || '').toLowerCase().includes(lower),
        );
      }
      selectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));
      scrollOffset = Math.max(0, Math.min(scrollOffset, filteredItems.length - pageSize));
    }

    function render(): void {
      // Clear previous render
      const totalLines = 3 + Math.min(filteredItems.length, pageSize) + (filterable ? 1 : 0) + 2;
      process.stdout.write(`\x1b[${totalLines}A\x1b[J`);

      // Header
      console.log('');
      console.log(`  ${border(H.repeat(w))}`);
      console.log(`  ${gold.bold(title)}${filter ? dim(`  filter: ${filter}`) : ''}`);

      // Items
      const visibleStart = scrollOffset;
      const visibleEnd = Math.min(filteredItems.length, scrollOffset + pageSize);

      if (visibleStart > 0) {
        console.log(dim(`  ${'  '}... ${visibleStart} more above`));
      }

      for (let i = visibleStart; i < visibleEnd; i++) {
        const item = filteredItems[i];
        const isSelected = i === selectedIndex;
        const pointer = isSelected ? gold(POINTER) : ' ';
        const label = isSelected
          ? chalk.bold(item.label)
          : item.dimLabel ? dim(item.label) : item.label;
        const desc = item.description ? dim(` ${item.description}`) : '';
        const id = dim(` ${item.id.slice(0, 8)}`);
        console.log(`  ${pointer} ${label}${desc}${id}`);
      }

      if (visibleEnd < filteredItems.length) {
        console.log(dim(`  ${'  '}... ${filteredItems.length - visibleEnd} more below`));
      }

      // Footer
      console.log(`  ${border(H.repeat(w))}`);
      console.log(dim(`  \u2191\u2193 navigate \u00b7 enter select \u00b7 esc cancel${filterable ? ' \u00b7 type to filter' : ''}`));
    }

    // Print initial blank lines to give render() space to overwrite
    const initialLines = 3 + Math.min(items.length, pageSize) + 2;
    for (let i = 0; i < initialLines; i++) console.log('');

    render();

    // Enter raw mode to capture keystrokes
    if (!process.stdin.isRaw) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeypress = (chunk: Buffer) => {
      const key = chunk.toString();

      // Escape
      if (key === '\x1b' || key === '\x03') {
        cleanup();
        resolve(null);
        return;
      }

      // Enter
      if (key === '\r' || key === '\n') {
        if (filteredItems.length > 0) {
          const selected = filteredItems[selectedIndex];
          cleanup();
          resolve(selected.id);
          return;
        }
      }

      // Arrow up
      if (key === '\x1b[A') {
        if (selectedIndex > 0) {
          selectedIndex--;
          if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
        }
        render();
        return;
      }

      // Arrow down
      if (key === '\x1b[B') {
        if (selectedIndex < filteredItems.length - 1) {
          selectedIndex++;
          if (selectedIndex >= scrollOffset + pageSize) scrollOffset = selectedIndex - pageSize + 1;
        }
        render();
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (filter.length > 0) {
          filter = filter.slice(0, -1);
          applyFilter();
          render();
        }
        return;
      }

      // Printable character (filter)
      if (filterable && key.length === 1 && key >= ' ' && key <= '~') {
        filter += key;
        applyFilter();
        render();
        return;
      }
    };

    function cleanup(): void {
      process.stdin.removeListener('data', onKeypress);
      process.stdin.setRawMode(false);
      // Clear the picker display
      const totalLines = 3 + Math.min(filteredItems.length, pageSize) + 2;
      process.stdout.write(`\x1b[${totalLines}A\x1b[J`);
    }

    process.stdin.on('data', onKeypress);
  });
}
