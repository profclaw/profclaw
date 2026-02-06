/**
 * TipTap Mention Extension Configuration
 *
 * Configures @mentions for users and tickets in the rich text editor.
 * Uses the MentionSuggestion component for the autocomplete dropdown.
 */

import { ReactRenderer } from '@tiptap/react';
import Mention from '@tiptap/extension-mention';
import tippy from 'tippy.js';
import type { Instance as TippyInstance } from 'tippy.js';
import { MentionSuggestion } from './mention-suggestion';
import type { MentionSuggestionRef, MentionItem } from './mention-suggestion';

export interface MentionNodeAttrs {
  id: string;
  label: string;
  entityType: 'user' | 'ticket';
  entityId: string;
}

/**
 * Create the mention extension with suggestion configuration
 */
export function createMentionExtension() {
  return Mention.configure({
    HTMLAttributes: {
      class: 'mention',
    },
    renderHTML({ options, node }) {
      const attrs = node.attrs as MentionNodeAttrs;
      return [
        'span',
        {
          class: `mention mention-${attrs.entityType}`,
          'data-type': 'mention',
          'data-id': attrs.id,
          'data-entity-type': attrs.entityType,
          'data-entity-id': attrs.entityId,
        },
        `${options.suggestion.char}${attrs.label}`,
      ];
    },
    suggestion: {
      char: '@',
      allowSpaces: false,
      startOfLine: false,

      items: (): MentionItem[] => {
        // Items are fetched by the MentionSuggestion component
        // This returns empty as the component handles fetching
        return [];
      },

      render: () => {
        let component: ReactRenderer<MentionSuggestionRef> | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props: any) => {
            component = new ReactRenderer(MentionSuggestion, {
              props,
              editor: props.editor,
            });

            if (!props.clientRect) {
              return;
            }

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
              theme: 'mention-dropdown',
              animation: 'shift-away-subtle',
              maxWidth: 'none',
              offset: [0, 8],
              zIndex: 9999,
            });
          },

          onUpdate(props: any) {
            component?.updateProps(props);

            if (!props.clientRect) {
              return;
            }

            popup?.[0]?.setProps({
              getReferenceClientRect: props.clientRect,
            });
          },

          onKeyDown(props: any) {
            if (props.event.key === 'Escape') {
              popup?.[0]?.hide();
              return true;
            }

            return component?.ref?.onKeyDown(props) ?? false;
          },

          onExit() {
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}

/**
 * CSS styles for mention nodes (add to index.css)
 */
export const mentionStyles = `
/* Mention styling in editor */
.mention {
  background-color: hsl(var(--primary) / 0.1);
  border-radius: 0.25rem;
  padding: 0.125rem 0.25rem;
  color: hsl(var(--primary));
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}

.mention:hover {
  background-color: hsl(var(--primary) / 0.2);
}

.mention-user {
  color: hsl(var(--primary));
}

.mention-ticket {
  color: hsl(var(--chart-2));
}

/* Tippy theme for mention dropdown */
.tippy-box[data-theme~='mention-dropdown'] {
  background: transparent;
  padding: 0;
  border: none;
  box-shadow: none;
}

.tippy-box[data-theme~='mention-dropdown'] .tippy-content {
  padding: 0;
}
`;
