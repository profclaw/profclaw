import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-2xl border-none field-recessed px-4 py-3 text-sm transition-all duration-300 placeholder:text-[var(--muted-foreground)]/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 font-medium",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
