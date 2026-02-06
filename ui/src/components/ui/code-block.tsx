import * as React from "react"
import { useState } from "react"
import { Check, Copy, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"

interface CodeBlockProps {
  children: string
  language?: string
  filename?: string
  showLineNumbers?: boolean
  className?: string
}

/**
 * CodeBlock - A reusable code block component with copy functionality
 *
 * Features:
 * - Dark background in both light and dark modes (standard for code)
 * - Copy to clipboard button
 * - Optional filename/language header
 * - Optional line numbers
 */
export function CodeBlock({
  children,
  language,
  filename,
  showLineNumbers = false,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lines = children.trim().split('\n')

  return (
    <div className={cn("rounded-xl overflow-hidden border border-zinc-800", className)}>
      {/* Header */}
      {(filename || language) && (
        <div className="bg-zinc-900 px-4 py-2 flex items-center justify-between border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400">
              {filename || language}
            </span>
          </div>
          <CopyButton copied={copied} onCopy={handleCopy} />
        </div>
      )}

      {/* Code Content */}
      <div className="relative bg-zinc-950 group">
        {/* Copy button (if no header) */}
        {!filename && !language && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton copied={copied} onCopy={handleCopy} />
          </div>
        )}

        <pre className="p-4 overflow-x-auto">
          <code className="text-sm font-mono text-zinc-200 leading-relaxed">
            {showLineNumbers ? (
              lines.map((line, i) => (
                <div key={i} className="flex">
                  <span className="select-none w-8 text-zinc-600 text-right pr-4">
                    {i + 1}
                  </span>
                  <span>{line || ' '}</span>
                </div>
              ))
            ) : (
              children.trim()
            )}
          </code>
        </pre>
      </div>
    </div>
  )
}

/**
 * InlineCode - For inline code snippets
 */
export function InlineCode({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "relative rounded bg-zinc-900 px-[0.4rem] py-[0.2rem] font-mono text-sm text-zinc-200",
        className
      )}
    >
      {children}
    </code>
  )
}

/**
 * CodeWithCopy - Simple code line with copy button (for URLs, commands, etc.)
 */
export function CodeWithCopy({
  children,
  label,
  className
}: {
  children: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && (
        <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      )}
      <div className="flex-1 flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 border border-zinc-800">
        <code className="flex-1 font-mono text-xs text-zinc-200 truncate">
          {children}
        </code>
        <button
          onClick={handleCopy}
          className={cn(
            "shrink-0 p-1 rounded transition-colors",
            copied
              ? "text-emerald-400"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}

// Internal copy button component
function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button
      onClick={onCopy}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors",
        copied
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  )
}
