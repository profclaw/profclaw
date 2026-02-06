import * as React from "react"
import { Command } from "cmdk"
import {
  Search, ListTodo, FileText, Bot,
  Settings, Plus, Moon, Sun,
  Terminal, Sparkles, Activity, Coins, RotateCcw, BarChart3,
  AudioLines,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import { useOnboardingTour } from "./OnboardingTour"

// Custom event for opening command palette programmatically
const OPEN_COMMAND_PALETTE_EVENT = 'open-command-palette'

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT))
}

export function CommandPalette() {
  const [open, setOpen] = React.useState(false)
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { resetTour, startTour } = useOnboardingTour()

  React.useEffect(() => {
    // Listen for keyboard shortcut - use capture phase to ensure it fires first
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to toggle command palette
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        setOpen((prev) => !prev)
      }
      // Escape to close when open
      if (e.key === "Escape" && open) {
        e.preventDefault()
        setOpen(false)
      }
    }

    // Listen for custom event to open programmatically
    const handleOpenEvent = () => setOpen(true)

    // Use window with capture to catch before other handlers
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent)

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent)
    }
  }, [open])

  const runCommand = React.useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  if (!open) return null

  return (
    <button 
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] sm:pt-[15vh] px-4 backdrop-blur-md bg-black/20 dark:bg-black/60 animate-in fade-in duration-300 w-full h-full border-none cursor-default"
      onClick={() => setOpen(false)}
      aria-label="Close command palette"
    >
      <div 
        className="w-full max-w-2xl overflow-hidden glass-heavy rounded-[32px] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.5)] border border-white/10 animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="flex flex-col h-full bg-transparent">
          <div className="flex items-center px-6 border-b border-white/5">
            <Search className="h-5 w-5 text-muted-foreground mr-3" />
            <Command.Input
              autoFocus
              placeholder="Type a command or search..."
              className="flex-1 h-20 bg-transparent outline-none text-lg placeholder:text-muted-foreground/50"
            />
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 border border-white/5">
                <span className="text-[10px] font-bold text-muted-foreground">ESC</span>
            </div>
          </div>

          <Command.List className="max-h-[60vh] sm:max-h-[450px] overflow-y-auto p-3 scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <Command.Empty className="py-16 text-center">
              <div className="flex flex-col items-center gap-3 opacity-40">
                <Search className="h-10 w-10" />
                <p className="text-sm font-medium">No results found for your search</p>
              </div>
            </Command.Empty>

            <Command.Group heading="General" className="px-3 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2">
                <CommandItem onSelect={() => runCommand(() => navigate('/'))} icon={Sparkles}>
                  Chat
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate('/tasks'))} icon={ListTodo}>
                  Tasks
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate('/analytics'))} icon={BarChart3}>
                  Analytics
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate('/summaries'))} icon={FileText}>
                  Summaries
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate('/costs'))} icon={Coins}>
                  Costs
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate('/agents'))} icon={Bot}>
                  Agents
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => navigate('/settings'))} icon={Settings}>
                  Settings
                </CommandItem>
              </div>
            </Command.Group>

            <Command.Separator className="h-px bg-white/5 mx-3 my-2" />

            <Command.Group heading="Quick Actions" className="px-3 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
              <div className="space-y-1 mt-2">
                <CommandItem onSelect={() => runCommand(() => {})} icon={Plus}>
                  Create New Task
                </CommandItem>
                <CommandItem
                  onSelect={() => runCommand(() => {
                    resetTour();
                    setTimeout(() => startTour(), 100);
                  })}
                  icon={RotateCcw}
                >
                  Start Onboarding Tour
                </CommandItem>
                <CommandItem
                  onSelect={() => runCommand(() => setTheme(theme === 'light' ? 'dark' : 'light'))}
                  icon={theme === 'light' ? Moon : Sun}
                >
                  {theme === 'light' ? 'Switch to Dark Blue' : 'Switch to Light Mode'}
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => setTheme('midnight'))} icon={Sparkles}>
                  Switch to Midnight Black
                </CommandItem>
              </div>
            </Command.Group>

            <Command.Group heading="Voice" className="px-3 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
              <div className="space-y-1 mt-2">
                <CommandItem
                  onSelect={() => runCommand(() => {
                    window.dispatchEvent(new CustomEvent('profclaw:talk-mode-toggle'))
                  })}
                  icon={AudioLines}
                >
                  Toggle Talk Mode
                </CommandItem>
              </div>
            </Command.Group>

            <Command.Group heading="Diagnostics" className="px-3 py-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
              <div className="space-y-1 mt-2">
                <CommandItem icon={Terminal}>Open Debug Terminal</CommandItem>
                <CommandItem icon={Activity}>System Health Report</CommandItem>
              </div>
            </Command.Group>
          </Command.List>

          <footer className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-white/[0.03] backdrop-blur-md">
             <div className="flex gap-6 items-center">
                <div className="flex items-center gap-2">
                   <kbd className="flex h-5 w-5 items-center justify-center rounded border border-white/20 bg-white/10 text-[10px] font-bold font-sans">↵</kbd>
                   <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">Enter</span>
                </div>
                <div className="flex items-center gap-2">
                   <kbd className="flex h-5 w-8 items-center justify-center rounded border border-white/20 bg-white/10 text-[10px] font-bold font-sans">↑↓</kbd>
                   <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">Navigate</span>
                </div>
             </div>
             <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-3 w-3" />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em]">profClaw INTELLIGENCE</span>
             </div>
          </footer>
        </Command>
      </div>
    </button>
  )
}

function CommandItem({ children, icon: Icon, onSelect }: { children: React.ReactNode, icon: React.ComponentType<{ className?: string }>, onSelect?: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-4 py-3.5 rounded-2xl cursor-default select-none aria-selected:bg-primary/10 dark:aria-selected:bg-white/10 aria-selected:text-foreground transition-all duration-200 group"
    >
      <div className="h-9 w-9 rounded-[12px] glass-heavy flex items-center justify-center border-white/5 group-aria-selected:border-primary/30 dark:group-aria-selected:border-white/20 group-aria-selected:scale-110 transition-transform">
        <Icon className="h-[18px] w-[18px] text-muted-foreground group-aria-selected:text-primary dark:group-aria-selected:text-blue-400 group-aria-selected:drop-shadow-[0_0_8px_rgba(96,165,250,0.5)] transition-all" />
      </div>
      <span className="text-[14px] font-medium tracking-tight">{children}</span>
    </Command.Item>
  )
}
