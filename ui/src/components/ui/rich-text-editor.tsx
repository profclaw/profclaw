/**
 * RichTextEditor Component
 *
 * A TipTap-based rich text editor with formatting toolbar.
 * Inspired by Plane.so's editor implementation.
 *
 * Automatically detects markdown content and converts to HTML for editing.
 */

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { marked } from 'marked';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  Code2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { useCallback, useEffect, useMemo } from 'react';
import { MarkdownRenderer } from './markdown-renderer';
import { createMentionExtension } from './mention-extension';

const lowlight = createLowlight(common);

/**
 * Detect if content is markdown vs HTML
 * Returns true if content appears to be markdown
 */
function isMarkdownContent(content: string): boolean {
  if (!content) return false;

  // If it starts with an HTML tag, it's likely HTML
  if (content.trim().startsWith('<') && content.includes('</')) {
    return false;
  }

  // Common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // Headers: # ## ### etc.
    /\*\*[^*]+\*\*/,         // Bold: **text**
    /__[^_]+__/,             // Bold: __text__
    /^```/m,                 // Code blocks
    /^[-*+]\s+/m,            // Unordered lists: - item, * item, + item
    /^\d+\.\s+/m,            // Ordered lists: 1. item
    /\[.+\]\(.+\)/,          // Links: [text](url)
    /^>\s+/m,                // Blockquotes: > text
    /^\|.+\|/m,              // Tables: | col |
    /`[^`]+`/,               // Inline code: `code`
  ];

  return markdownPatterns.some(pattern => pattern.test(content));
}

/**
 * Convert markdown to HTML using marked
 */
function markdownToHtml(markdown: string): string {
  if (!markdown) return '';

  // Configure marked for safe HTML output
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  return marked.parse(markdown, { async: false }) as string;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  minHeight?: string;
  showToolbar?: boolean;
  autofocus?: boolean;
  enableMentions?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write something...',
  editable = true,
  className,
  minHeight = '150px',
  showToolbar = true,
  autofocus = false,
  enableMentions = false,
}: RichTextEditorProps) {
  // Convert markdown to HTML if needed (memoized to avoid re-conversion)
  const initialContent = useMemo(() => {
    if (!value) return '';
    if (isMarkdownContent(value)) {
      return markdownToHtml(value);
    }
    return value;
  }, [value]);

  // Build extensions list
  const extensions = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseExtensions: any[] = [
      StarterKit.configure({
        codeBlock: false, // We use CodeBlockLowlight instead
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Underline,
      TextStyle,
      CodeBlockLowlight.configure({
        lowlight,
      }),
    ];

    if (enableMentions) {
      baseExtensions.push(createMentionExtension());
    }

    return baseExtensions;
  }, [placeholder, enableMentions]);

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    autofocus,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          'prose-headings:font-semibold prose-headings:text-foreground',
          'prose-p:text-foreground prose-p:leading-relaxed',
          'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
          'prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
          'prose-pre:bg-muted prose-pre:border prose-pre:border-border',
          'prose-blockquote:border-l-primary prose-blockquote:bg-muted/30',
          'prose-ul:list-disc prose-ol:list-decimal',
          // Task list styling is handled by CSS in index.css
        ),
      },
    },
  });

  // Sync external value changes (convert markdown if needed)
  useEffect(() => {
    if (editor) {
      const htmlContent = isMarkdownContent(value) ? markdownToHtml(value) : value;
      if (htmlContent !== editor.getHTML()) {
        editor.commands.setContent(htmlContent);
      }
    }
  }, [value, editor]);

  const ToolbarButton = useCallback(
    ({
      onClick,
      isActive,
      children,
      title,
    }: {
      onClick: () => void;
      isActive?: boolean;
      children: React.ReactNode;
      title: string;
    }) => (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        className={cn(
          'h-8 w-8 p-0',
          isActive && 'bg-primary/10 text-primary'
        )}
        title={title}
      >
        {children}
      </Button>
    ),
    []
  );

  if (!editor) {
    return null;
  }

  return (
    <div className={cn('rounded-lg border border-border overflow-hidden', className)}>
      {/* Toolbar */}
      {showToolbar && editable && (
        <div className="flex flex-wrap items-center gap-0.5 p-1 border-b border-border bg-muted/30">
          {/* Text Formatting */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title="Bold (Ctrl+B)"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title="Italic (Ctrl+I)"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive('underline')}
            title="Underline (Ctrl+U)"
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive('strike')}
            title="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={editor.isActive('code')}
            title="Inline Code"
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Headings */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive('heading', { level: 3 })}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Lists */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            title="Numbered List"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            isActive={editor.isActive('taskList')}
            title="Task List"
          >
            <ListTodo className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Blocks */}
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive('blockquote')}
            title="Quote"
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive('codeBlock')}
            title="Code Block"
          >
            <Code2 className="h-4 w-4" />
          </ToolbarButton>

          <div className="flex-1" />

          {/* Undo/Redo */}
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo (Ctrl+Z)"
          >
            <Undo className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo (Ctrl+Y)"
          >
            <Redo className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )}

      {/* Editor Content */}
      <EditorContent
        editor={editor}
        className={cn('p-3', !editable && 'cursor-default')}
        style={{ minHeight }}
      />
    </div>
  );
}

/**
 * Smart content renderer that handles both HTML and Markdown
 * Automatically detects content type and renders appropriately
 */
export function RichTextDisplay({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  // Detect if content is markdown
  if (isMarkdownContent(content)) {
    return (
      <MarkdownRenderer
        content={content}
        className={cn(
          'prose-headings:text-foreground',
          'prose-p:text-foreground prose-p:leading-relaxed',
          'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
          className
        )}
      />
    );
  }

  // Render as HTML (TipTap output)
  // Uses .rich-text-display class which has CSS in index.css for consistent styling
  return (
    <div
      className={cn(
        'rich-text-display max-w-none text-sm leading-relaxed',
        '[&_p]:my-2',
        className
      )}
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
