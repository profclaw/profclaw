/**
 * Mention Suggestion Component
 *
 * A dropdown component for showing mention suggestions (@user, @ticket)
 * Used by the TipTap mention extension for autocomplete.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
} from 'react';
import { User, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from "@/lib/logger";
import { api } from '@/core/api/client';
import { debounce } from '@/lib/utils';

export interface MentionItem {
  id: string;
  entity_identifier: string;
  entity_name: 'user' | 'ticket';
  title: string;
  subTitle?: string;
}

export interface MentionSection {
  key: string;
  title: string;
  items: MentionItem[];
}

// Props passed from TipTap suggestion
export interface MentionSuggestionProps {
  items: MentionItem[];
  command: (attrs: Record<string, unknown>) => void;
  query: string;
  editor: unknown;
}

export interface MentionSuggestionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionSuggestion = forwardRef<MentionSuggestionRef, MentionSuggestionProps>(
  function MentionSuggestion(props, ref) {
    const { command, query } = props;
    const [sections, setSections] = useState<MentionSection[]>([]);
    const [selectedIndex, setSelectedIndex] = useState({ section: 0, item: 0 });
    const [isLoading, setIsLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Debounced search
    const debouncedSearch = useCallback(
      debounce(async (searchQuery: string) => {
        if (!searchQuery) {
          setSections([]);
          setIsLoading(false);
          return;
        }

        try {
          const result = await api.search.mentions(searchQuery, 'all', 5);
          setSections(result.sections);
        } catch (error) {
          logger.error('Mention search failed', error);
          setSections([]);
        } finally {
          setIsLoading(false);
        }
      }, 200),
      []
    );

    useEffect(() => {
      setIsLoading(true);
      debouncedSearch(query);
    }, [query, debouncedSearch]);

    // Reset selected index when sections change
    useEffect(() => {
      setSelectedIndex({ section: 0, item: 0 });
    }, [sections]);

    const selectItem = useCallback(
      (sectionIndex: number, itemIndex: number) => {
        const item = sections[sectionIndex]?.items[itemIndex];
        if (item) {
          command({
            id: item.id,
            label: item.entity_name === 'user' ? item.title : item.subTitle || item.title,
            entityType: item.entity_name,
            entityId: item.entity_identifier,
          });
        }
      },
      [sections, command]
    );

    // Get all items flattened for keyboard navigation
    const getAllItems = useCallback(() => {
      const items: { sectionIndex: number; itemIndex: number }[] = [];
      sections.forEach((section, sectionIndex) => {
        section.items.forEach((_, itemIndex) => {
          items.push({ sectionIndex, itemIndex });
        });
      });
      return items;
    }, [sections]);

    const getCurrentFlatIndex = useCallback(() => {
      const items = getAllItems();
      return items.findIndex(
        (item) =>
          item.sectionIndex === selectedIndex.section &&
          item.itemIndex === selectedIndex.item
      );
    }, [getAllItems, selectedIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        const items = getAllItems();
        if (items.length === 0) return false;

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const currentFlatIndex = getCurrentFlatIndex();
          const newFlatIndex = currentFlatIndex <= 0 ? items.length - 1 : currentFlatIndex - 1;
          const newItem = items[newFlatIndex];
          setSelectedIndex({ section: newItem.sectionIndex, item: newItem.itemIndex });
          return true;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const currentFlatIndex = getCurrentFlatIndex();
          const newFlatIndex = currentFlatIndex >= items.length - 1 ? 0 : currentFlatIndex + 1;
          const newItem = items[newFlatIndex];
          setSelectedIndex({ section: newItem.sectionIndex, item: newItem.itemIndex });
          return true;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          selectItem(selectedIndex.section, selectedIndex.item);
          return true;
        }

        if (event.key === 'Escape') {
          return true;
        }

        return false;
      },
    }));

    // Scroll selected item into view
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const selectedElement = container.querySelector(
        `#mention-item-${selectedIndex.section}-${selectedIndex.item}`
      ) as HTMLElement;

      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }, [selectedIndex]);

    const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);

    if (isLoading) {
      return (
        <div className="z-50 min-w-[200px] max-w-[280px] overflow-hidden rounded-lg border border-border bg-popover p-2 shadow-lg">
          <div className="text-center text-sm text-muted-foreground py-3">
            Searching...
          </div>
        </div>
      );
    }

    if (totalItems === 0 && query) {
      return (
        <div className="z-50 min-w-[200px] max-w-[280px] overflow-hidden rounded-lg border border-border bg-popover p-2 shadow-lg">
          <div className="text-center text-sm text-muted-foreground py-3">
            No results found
          </div>
        </div>
      );
    }

    if (totalItems === 0) {
      return null;
    }

    return (
      <div
        ref={containerRef}
        className="z-50 min-w-[220px] max-w-[300px] max-h-[300px] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover shadow-lg"
      >
        {sections.map((section, sectionIndex) => (
          <div key={section.key} className="py-1">
            {section.title && (
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </div>
            )}
            {section.items.map((item, itemIndex) => {
              const isSelected =
                sectionIndex === selectedIndex.section &&
                itemIndex === selectedIndex.item;

              return (
                <button
                  key={item.id}
                  id={`mention-item-${sectionIndex}-${itemIndex}`}
                  type="button"
                  onClick={() => selectItem(sectionIndex, itemIndex)}
                  onMouseEnter={() =>
                    setSelectedIndex({ section: sectionIndex, item: itemIndex })
                  }
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm cursor-pointer',
                    'hover:bg-accent transition-colors',
                    isSelected && 'bg-accent'
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted">
                    {item.entity_name === 'user' ? (
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Ticket className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <div className="flex-1 truncate text-left">
                    {item.subTitle && (
                      <span className="text-xs text-muted-foreground mr-1.5">
                        {item.subTitle}
                      </span>
                    )}
                    <span>{item.title}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }
);
