import { Moon, Sun, Monitor, Check } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full hover-lift transition-liquid"
          aria-label="Toggle theme"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px] glass-heavy rounded-2xl p-2">
        <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-2">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/5" />

        <DropdownMenuItem
          onClick={() => setTheme('light')}
          className="flex items-center justify-between rounded-xl px-2 py-2.5 cursor-pointer hover:bg-white/5"
        >
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4" />
            <span className="text-[13px]">Light</span>
          </div>
          {theme === 'light' && <Check className="h-4 w-4" />}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => setTheme('dark')}
          className="flex items-center justify-between rounded-xl px-2 py-2.5 cursor-pointer hover:bg-white/5"
        >
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-blue-400" />
            <span className="text-[13px]">Dark Blue</span>
          </div>
          {theme === 'dark' && <Check className="h-4 w-4" />}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => setTheme('midnight')}
          className="flex items-center justify-between rounded-xl px-2 py-2.5 cursor-pointer hover:bg-white/5"
        >
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-purple-400" />
            <span className="text-[13px]">Midnight</span>
          </div>
          {theme === 'midnight' && <Check className="h-4 w-4" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-white/5" />

        <DropdownMenuItem
          onClick={() => setTheme('system')}
          className="flex items-center justify-between rounded-xl px-2 py-2.5 cursor-pointer hover:bg-white/5"
        >
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            <span className="text-[13px]">System</span>
          </div>
          {theme === 'system' && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
