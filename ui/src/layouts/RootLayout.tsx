import { type ReactNode, useState, useMemo, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ListTodo, FileText, Settings, Bot, Search, Coins, Menu, X, ChevronLeft, ChevronRight, Webhook, AlertTriangle, PanelLeftClose, PanelLeft, Command, Zap, Ticket, Sparkles, FolderKanban, Users, Clock, ChevronDown, LogOut, CreditCard, KeyRound, Bell } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { CommandPalette, openCommandPalette } from '@/components/shared/CommandPalette';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { Logo } from '@/components/shared/Logo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { api } from '@/core/api/client';
import { UserMenu, useAuth } from '@/features/auth';
import { FloatingChatbot } from '@/components/shared/FloatingChatbot';

interface RootLayoutProps {
  children: ReactNode;
}

// Navigation grouped by category with collapsible support (inspired by Plane.so)
const navGroups = [
  {
    id: 'home',
    label: 'Home',
    items: [
      { name: 'Chat', href: '/', icon: Sparkles, shortcut: '⌘1' },
    ],
  },
  {
    id: 'ai-studio',
    label: 'AI Studio',
    items: [
      { name: 'Agents', href: '/agents', icon: Bot, shortcut: '⌘2' },
      { name: 'Gateway', href: '/gateway', icon: Zap },
    ],
  },
  {
    id: 'scrum',
    label: 'Scrum',
    items: [
      { name: 'Projects', href: '/projects', icon: FolderKanban, shortcut: '⌘3' },
      { name: 'Tickets', href: '/tickets', icon: Ticket, shortcut: '⌘4' },
      { name: 'Tasks', href: '/tasks', icon: ListTodo, shortcut: '⌘5', hasBadge: 'pending' },
      { name: 'Failed', href: '/failed', icon: AlertTriangle, hasBadge: 'dlq' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { name: 'Analytics', href: '/analytics', icon: BarChart3, shortcut: '⌘6' },
      { name: 'Activity', href: '/activity', icon: Bell },
      { name: 'Summaries', href: '/summaries', icon: FileText, shortcut: '⌘7' },
      { name: 'Costs', href: '/costs', icon: Coins, shortcut: '⌘8' },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      { name: 'Cron Jobs', href: '/cron', icon: Clock },
      { name: 'Webhooks', href: '/webhooks', icon: Webhook },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { name: 'Settings', href: '/settings', icon: Settings, shortcut: '⌘0' },
    ],
  },
];

const adminNav = {
  id: 'admin',
  label: 'Admin',
  items: [
    { name: 'Users', href: '/admin/users', icon: Users },
    { name: 'Invite Codes', href: '/admin/invite-codes', icon: KeyRound },
  ],
};

const navigation = navGroups.flatMap(g => g.items);

// Quick access toolbar items (subset for header)
const toolbarNav = [
  { name: 'Chat', href: '/', icon: Sparkles },
  { name: 'Tasks', href: '/tasks', icon: ListTodo },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Agents', href: '/agents', icon: Bot },
];

// Nav group header component
interface NavGroupHeaderProps {
  label: string;
  collapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
  itemCount: number;
}

function NavGroupHeader({ label, collapsed, isOpen, onToggle, itemCount }: NavGroupHeaderProps) {
  // Single-item groups don't need collapsible header
  const isCollapsible = itemCount > 1;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1.5">
        <div className="h-px w-5 bg-[var(--border)]/40" />
      </div>
    );
  }

  // Non-collapsible single-item groups just show the label
  if (!isCollapsible) {
    return (
      <div className="px-3 py-1.5">
        <span className="nav-group-label">{label}</span>
      </div>
    );
  }

  return (
    <button
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${label} group`}
      className="group flex items-center w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)]/80 transition-colors"
    >
      <ChevronDown
        className={cn(
          "h-3 w-3 mr-1 transition-transform duration-200 opacity-60",
          !isOpen && "-rotate-90"
        )}
        aria-hidden="true"
      />
      <span className="nav-group-label">{label}</span>
    </button>
  );
}

// Nav item component with tooltip and badge support
interface NavItemProps {
  item: { name: string; href: string; icon: React.ComponentType<{ className?: string }>; shortcut?: string };
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
  badge?: number;
}

function NavItem({ item, isActive, collapsed, onClick, badge }: NavItemProps) {
  return (
    <Link
      to={item.href}
      onClick={onClick}
      aria-label={collapsed ? item.name : undefined}
      className={cn(
        "group relative flex items-center rounded-xl transition-all duration-300",
        collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-2.5 mx-1",
        isActive
          ? "bg-[#0a0a0b] text-white shadow-lg shadow-black/20 nav-item-active"
          : "text-[var(--muted-foreground)]/70 hover:nav-item-hover hover:text-[var(--foreground)]"
      )}
    >
      <div className="relative flex items-center justify-center">
        <item.icon className={cn(
          "shrink-0 transition-all duration-200",
          collapsed ? "h-[18px] w-[18px]" : "h-4 w-4",
          isActive ? "text-white" : "text-[var(--muted-foreground)]/70 group-hover:text-[var(--foreground)]"
        )} />
        {/* Badge indicator */}
        {badge !== undefined && badge > 0 && (
          <span className={cn(
            "absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[8px] font-bold",
            "h-3.5 min-w-3.5 px-0.5",
            "bg-[var(--destructive)] text-white"
          )}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {/* Active indicator - Handled by CSS ::before on nav-item-active */}
      </div>
      {!collapsed && (
        <>
          <span className="text-[13px] font-medium flex-1 truncate">{item.name}</span>
          {/* Keyboard shortcut hint */}
          {item.shortcut && (
            <kbd className="hidden lg:inline-flex h-5 items-center gap-0.5 rounded bg-[var(--muted)]/60 px-1.5 text-[10px] font-mono text-[var(--muted-foreground)]/70 opacity-0 group-hover:opacity-100 transition-opacity">
              {item.shortcut}
            </kbd>
          )}
        </>
      )}
      {/* Tooltip for collapsed state */}
      {collapsed && (
        <div className="pointer-events-none absolute left-full ml-2 opacity-0 group-hover:opacity-100 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--popover)] text-[12px] font-medium text-[var(--foreground)] border border-[var(--border)] whitespace-nowrap shadow-lg z-[100] transition-all duration-150">
          <span>{item.name}</span>
          {badge !== undefined && badge > 0 && (
            <span className="flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-[var(--destructive)] text-white text-[9px] font-bold">
              {badge}
            </span>
          )}
          {item.shortcut && (
            <kbd className="text-[10px] text-[var(--muted-foreground)]">{item.shortcut}</kbd>
          )}
        </div>
      )}
    </Link>
  );
}

export function RootLayout({ children }: RootLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { resolvedTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });
  const [scrolled, setScrolled] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const historyStack = useRef<string[]>([]);
  const historyIndex = useRef(0);

  // Collapsible nav group state
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('sidebar-groups');
    return saved ? JSON.parse(saved) : {
      home: true,
      'ai-studio': true,
      scrum: true,
      insights: true,
      automation: true,
      settings: true,
      admin: true
    };
  });

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      localStorage.setItem('sidebar-groups', JSON.stringify(next));
      return next;
    });
  };

  // Track navigation history for forward/back buttons
  useEffect(() => {
    const currentPath = location.pathname + location.search;

    // Check if we're navigating to a new page or using back/forward
    if (historyStack.current.length === 0) {
      // Initialize with current path
      historyStack.current = [currentPath];
      historyIndex.current = 0;
    } else if (currentPath !== historyStack.current[historyIndex.current]) {
      // Check if navigating forward in existing history
      if (historyIndex.current < historyStack.current.length - 1 &&
          currentPath === historyStack.current[historyIndex.current + 1]) {
        historyIndex.current++;
      }
      // Check if navigating back in existing history
      else if (historyIndex.current > 0 &&
               currentPath === historyStack.current[historyIndex.current - 1]) {
        historyIndex.current--;
      }
      // New navigation - truncate forward history and add new path
      else {
        historyStack.current = historyStack.current.slice(0, historyIndex.current + 1);
        historyStack.current.push(currentPath);
        historyIndex.current = historyStack.current.length - 1;
      }
    }

    // Update forward button state
    setCanGoForward(historyIndex.current < historyStack.current.length - 1);
  }, [location]);

  // Fetch stats for badge counts
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.stats.get,
    refetchInterval: 30000,
    staleTime: 25000, // Prevent duplicate fetches within 25s
  });

  // Fetch DLQ count for failed badge
  const { data: dlqStats } = useQuery({
    queryKey: ['dlq', 'stats'],
    queryFn: api.dlq.stats,
    refetchInterval: 30000,
    staleTime: 25000,
  });

  // Persist collapsed state
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed.toString());
  }, [collapsed]);

  // Track scroll position for header effects
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Keyboard shortcuts for navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger with Cmd/Ctrl + number
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const shortcuts: Record<string, string> = {
          '1': '/',           // Home - Chat
          '2': '/agents',     // AI Studio - Agents
          '3': '/projects',   // Scrum - Projects
          '4': '/tickets',    // Scrum - Tickets
          '5': '/tasks',      // Scrum - Tasks
          '6': '/analytics',  // Insights - Analytics
          '7': '/summaries',  // Insights - Summaries
          '8': '/costs',      // Insights - Costs
          '0': '/settings',   // Settings
        };
        if (shortcuts[e.key]) {
          e.preventDefault();
          navigate(shortcuts[e.key]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  // Get current page info for dynamic header
  const currentPage = useMemo(() => {
    const path = location.pathname;
    // Check for detail pages first
    if (path.startsWith('/projects/') && path !== '/projects') {
      return { name: 'Project Details', parent: 'Projects', parentHref: '/projects' };
    }
    if (path.startsWith('/tickets/') && path !== '/tickets') {
      return { name: 'Ticket Details', parent: 'Tickets', parentHref: '/tickets' };
    }
    if (path.startsWith('/tasks/') && path !== '/tasks') {
      return { name: 'Task Details', parent: 'Tasks', parentHref: '/tasks' };
    }
    if (path.startsWith('/summaries/') && path !== '/summaries') {
      return { name: 'Summary Details', parent: 'Summaries', parentHref: '/summaries' };
    }
    // Find matching nav item
    const navItem = navigation.find(item =>
      item.href === path || (item.href !== '/' && path.startsWith(item.href))
    );
    return navItem ? { name: navItem.name } : { name: 'Chat' };
  }, [location.pathname]);

  const canGoBack = window.history.length > 1;

  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>
      <CommandPalette />
      
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <button 
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden w-full h-full border-none cursor-default"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* Floating Liquid Glass Sidebar */}
      <aside className={cn(
        "global-sidebar fixed inset-y-0 left-0 z-50 p-2 transition-all duration-300 ease-out",
        collapsed ? "w-[72px]" : "w-64",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="glass h-full rounded-2xl flex flex-col overflow-hidden">
          {/* Logo Section */}
          <div className={cn(
            "flex items-center flex-shrink-0 transition-all h-14",
            collapsed ? "justify-center px-2" : "justify-between px-3"
          )}>
            <Link to="/" className="flex items-center group/logo" aria-label="profClaw Home">
              {collapsed ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl glass-heavy shadow-lg shadow-primary/5 transition-transform group-hover/logo:scale-105">
                  <Logo className="h-7 w-7 text-primary" aria-hidden="true" />
                </div>
              ) : (
                <img
                  src={resolvedTheme === 'light' ? '/brand/profclaw-wordmark-light.svg' : '/brand/profclaw-wordmark-dark.svg'}
                  alt="profClaw"
                  className="h-10 transition-transform group-hover/logo:scale-[1.02]"
                />
              )}
            </Link>

            {/* Mobile Close / Desktop Collapse */}
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                onClick={() => {
                  if (window.innerWidth < 1024) {
                    setSidebarOpen(false);
                  } else {
                    setCollapsed(true);
                  }
                }}
                aria-label={window.innerWidth < 1024 ? "Close sidebar" : "Collapse sidebar"}
              >
                {window.innerWidth < 1024 ? (
                  <X className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>

          {/* Search Button */}
          <div className={cn("px-2 pb-2", collapsed && "px-1.5")}>
            <button
              onClick={openCommandPalette}
              aria-label="Search"
              className={cn(
                "flex items-center w-full rounded-lg text-[var(--muted-foreground)] bg-[var(--muted)]/40 hover:bg-[var(--muted)]/60 border border-transparent hover:border-[var(--border)]/50 transition-all",
                collapsed ? "justify-center h-9 w-9 mx-auto" : "gap-2 px-2.5 py-2"
              )}
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left text-[12px]">Search...</span>
                  <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] opacity-50 font-mono" aria-hidden="true">
                    <Command className="h-2.5 w-2.5" />K
                  </kbd>
                </>
              )}
            </button>
          </div>

          {/* Navigation */}
          <nav className={cn(
            "flex flex-col flex-1 overflow-y-auto py-1",
            collapsed ? "px-1.5" : "px-2"
          )} data-tour="sidebar-nav">
            {/* Navigation Groups */}
            {navGroups.map((group, groupIndex) => (
              <div key={group.id} className={cn(groupIndex > 0 && "mt-1")}>
                <NavGroupHeader
                  label={group.label}
                  collapsed={collapsed}
                  isOpen={openGroups[group.id] ?? true}
                  onToggle={() => toggleGroup(group.id)}
                  itemCount={group.items.length}
                />
                {(openGroups[group.id] ?? true) && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const isActive = item.href === '/'
                        ? location.pathname === '/'
                        : location.pathname === item.href || location.pathname.startsWith(item.href + '/');

                      // Get badge count based on item config
                      let badge: number | undefined;
                      if ((item as any).hasBadge === 'pending') badge = stats?.pending;
                      if ((item as any).hasBadge === 'dlq') badge = dlqStats?.total;

                      return (
                        <NavItem
                          key={item.href}
                          item={item}
                          isActive={isActive}
                          collapsed={collapsed}
                          onClick={() => setSidebarOpen(false)}
                          badge={badge}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Admin Navigation - Only visible to admins */}
            {user?.role === 'admin' && (
              <div className="mt-1">
                <NavGroupHeader
                  label={adminNav.label}
                  collapsed={collapsed}
                  isOpen={openGroups[adminNav.id] ?? true}
                  onToggle={() => toggleGroup(adminNav.id)}
                  itemCount={adminNav.items.length}
                />
                {(openGroups[adminNav.id] ?? true) && (
                  <div className="space-y-0.5">
                    {adminNav.items.map((item) => (
                      <NavItem
                        key={item.href}
                        item={item}
                        isActive={location.pathname === item.href}
                        collapsed={collapsed}
                        onClick={() => setSidebarOpen(false)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Bottom Section - User Profile */}
          <div className={cn(
            "flex-shrink-0 border-t border-[var(--border)]/30",
            collapsed ? "p-1.5" : "p-2"
          )}>
            {collapsed ? (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={() => navigate('/settings/profile')}
                  className="relative group"
                  aria-label={`View ${user?.name || 'User'} profile settings`}
                >
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.name || 'User avatar'}
                      className="h-8 w-8 rounded-lg ring-1 ring-[var(--border)]/50"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[var(--primary)] to-indigo-500 flex items-center justify-center text-xs font-semibold text-white">
                      {user?.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                  )}
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 px-2 py-1 rounded-lg bg-[var(--popover)] text-[11px] font-medium text-[var(--foreground)] border border-[var(--border)] whitespace-nowrap shadow-lg z-[100] transition-all">
                    {user?.name || 'Profile'}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-[var(--muted-foreground)]"
                  onClick={() => setCollapsed(false)}
                  title="Expand sidebar"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button 
                    className="flex items-center gap-2.5 w-full px-2 py-2 rounded-lg hover:bg-[var(--muted)]/50 transition-colors"
                    aria-label={`Open user menu for ${user?.name || 'User'}`}
                  >
                    {user?.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.name || 'User avatar'}
                        className="h-8 w-8 rounded-lg ring-1 ring-[var(--border)]/50"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[var(--primary)] to-indigo-500 flex items-center justify-center text-xs font-semibold text-white">
                        {user?.name?.charAt(0).toUpperCase() || 'U'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-[13px] font-medium truncate">{user?.name || 'User'}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)] truncate">{user?.email || 'user@example.com'}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-56">
                  <DropdownMenuItem onClick={() => navigate('/settings/profile')}>
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/costs')}>
                    <CreditCard className="h-4 w-4 mr-2" />
                    Billing & Costs
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <span className="text-[12px] text-[var(--muted-foreground)]">Theme</span>
                    <ThemeToggle />
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-[var(--destructive)]">
                    <LogOut className="h-4 w-4 mr-2" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className={cn(
        "global-content flex flex-1 flex-col transition-all duration-300",
        collapsed ? "lg:pl-[88px]" : "lg:pl-[272px]"
      )}>
        {/* Header - macOS Liquid Toolbar Style with scroll effects */}
        <header className={cn(
          "global-header sticky top-0 z-40 mx-3 mt-3 mb-0 transition-all duration-300",
          scrolled && "mt-0"
        )}>
          <div className={cn(
            "flex h-14 items-center justify-between px-4 transition-all duration-300",
            scrolled
              ? "glass-heavy rounded-none rounded-b-2xl shadow-xl shadow-black/5"
              : "glass rounded-2xl"
          )}>
            <div className="flex items-center gap-4">
              {/* Mobile Menu Button */}
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden rounded-full"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" />
              </Button>

              {/* Browser-style Navigation Controls */}
              <div className="hidden md:flex items-center gap-0.5 px-1 py-1 rounded-lg bg-black/5 dark:bg-white/5">
                <button
                  onClick={() => canGoBack && navigate(-1)}
                  disabled={!canGoBack}
                  className={cn(
                    "p-1.5 px-2 rounded-md transition-colors",
                    canGoBack
                      ? "hover:bg-white/10 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      : "text-[var(--muted-foreground)]/30 cursor-not-allowed"
                  )}
                  title="Go back"
                  aria-label="Go back"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <div className="w-[1px] h-3 bg-[var(--border)]" />
                <button
                  onClick={() => canGoForward && navigate(1)}
                  disabled={!canGoForward}
                  className={cn(
                    "p-1.5 px-2 rounded-md transition-colors",
                    canGoForward
                      ? "hover:bg-white/10 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      : "text-[var(--muted-foreground)]/30 cursor-not-allowed"
                  )}
                  title="Go forward"
                  aria-label="Go forward"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Dynamic Page Title with Breadcrumb */}
              <div className="flex flex-col text-left">
                {currentPage.parent ? (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <Link
                        to={currentPage.parentHref!}
                        className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                      >
                        {currentPage.parent}
                      </Link>
                      <ChevronRight className="h-3 w-3 text-[var(--muted-foreground)]/50" />
                      <span className="font-semibold">{currentPage.name}</span>
                    </div>
                  </>
                ) : (
                  <h1 className="text-[13px] font-semibold tracking-tight leading-tight">{currentPage.name}</h1>
                )}
                <div className="hidden sm:flex items-center gap-2 mt-0.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_var(--primary-glow)] animate-pulse" />
                  <span className="text-[9px] text-muted-foreground font-black uppercase tracking-widest opacity-80">Orchestrator Active</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Quick Navigation Toolbar - Functional Links */}
              <div className="hidden md:flex items-center gap-0.5 px-1 py-1 rounded-lg bg-black/5 dark:bg-white/5 mr-2">
                {toolbarNav.map((item) => {
                  const isActive = location.pathname === item.href ||
                    (item.href !== '/' && location.pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      title={item.name}
                      className={cn(
                        "p-2 rounded-xl transition-all relative group",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-[0_0_20px_-5px_var(--primary-glow)] scale-110"
                          : "text-muted-foreground hover:bg-primary/15 hover:text-primary hover:scale-105"
                      )}
                    >
                      <item.icon className={cn("h-4.5 w-4.5 transition-transform group-active:scale-90", isActive && "stroke-[2.5px]")} />
                      {/* Tooltip */}
                      <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 hidden group-hover:flex items-center px-2.5 py-1.5 rounded-xl glass-heavy text-[9px] font-black uppercase tracking-widest text-foreground shadow-2xl z-50">
                        {item.name}
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="hidden sm:block h-8 w-[1px] bg-[var(--border)] mx-1" />

              <div className="flex items-center gap-1">
                <button
                  className="p-2 hover:bg-white/5 rounded-full transition-colors group relative"
                  onClick={openCommandPalette}
                  data-tour="command-palette"
                  aria-label="Search"
                >
                  <Search className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden="true" />
                  <div className="absolute top-full mt-2 right-0 hidden group-hover:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/90 text-[9px] font-bold text-white border border-white/10 whitespace-nowrap shadow-xl z-50">
                    <span className="opacity-50">⌘</span>
                    <span>K</span>
                  </div>
                </button>
                <NotificationBell />
                <div data-tour="theme-toggle">
                  <ThemeToggle />
                </div>
                <UserMenu />
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" className="flex-1 p-4 sm:p-6 outline-none" tabIndex={-1}>
          {children}
        </main>
        <FloatingChatbot />
      </div>
    </div>
  );
}
