/**
 * Navigation configuration
 *
 * Shared nav items, groups, and types used by RootLayout and CommandPalette.
 */

import type { ComponentType } from 'react';
import {
  BarChart3,
  ListTodo,
  FileText,
  Settings,
  Bot,
  Coins,
  Webhook,
  AlertTriangle,
  Zap,
  Ticket,
  Sparkles,
  FolderKanban,
  Users,
  Clock,
  KeyRound,
  Bell,
  MessageSquare,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  hasBadge?: 'pending' | 'dlq';
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    id: 'home',
    label: 'Home',
    items: [
      { name: 'Chat', href: '/', icon: Sparkles, shortcut: '\u23181' },
    ],
  },
  {
    id: 'ai-studio',
    label: 'AI Studio',
    items: [
      { name: 'Agents', href: '/agents', icon: Bot, shortcut: '\u23182' },
      { name: 'Messaging', href: '/messaging', icon: MessageSquare },
      { name: 'Gateway', href: '/gateway', icon: Zap },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    items: [
      { name: 'Projects', href: '/projects', icon: FolderKanban, shortcut: '\u23183' },
      { name: 'Tickets', href: '/tickets', icon: Ticket, shortcut: '\u23184' },
      { name: 'Tasks', href: '/tasks', icon: ListTodo, shortcut: '\u23185', hasBadge: 'pending' },
      { name: 'Failed', href: '/failed', icon: AlertTriangle, hasBadge: 'dlq' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { name: 'Analytics', href: '/analytics', icon: BarChart3, shortcut: '\u23186' },
      { name: 'Activity', href: '/activity', icon: Bell },
      { name: 'Summaries', href: '/summaries', icon: FileText, shortcut: '\u23187' },
      { name: 'Costs', href: '/costs', icon: Coins, shortcut: '\u23188' },
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
      { name: 'Settings', href: '/settings', icon: Settings, shortcut: '\u23180' },
    ],
  },
];

export const adminNav: NavGroup = {
  id: 'admin',
  label: 'Admin',
  items: [
    { name: 'Users', href: '/admin/users', icon: Users },
    { name: 'Invite Codes', href: '/admin/invite-codes', icon: KeyRound },
  ],
};

/** Flat list of all nav items (excluding admin) */
export const allNavItems: NavItem[] = navGroups.flatMap(g => g.items);

/** Quick access toolbar items for the header */
export const toolbarNav: NavItem[] = [
  { name: 'Chat', href: '/', icon: Sparkles },
  { name: 'Tasks', href: '/tasks', icon: ListTodo },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Agents', href: '/agents', icon: Bot },
];
