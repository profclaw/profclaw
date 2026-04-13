/**
 * User Menu Component
 *
 * Displays user avatar with dropdown menu for profile/settings/logout.
 */

import { Link, useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  User,
  Settings,
  LogOut,
  Github,
  CreditCard,
  Bell,
  Shield,
  Users,
  Crown,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';

export function UserMenu() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading, authMode, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out successfully');
      navigate('/login');
    } catch {
      toast.error('Logout failed');
    }
  };

  // Don't flash sign-in buttons while auth is loading
  if (isLoading) {
    return (
      <div className="w-24 h-8 rounded-md bg-muted/30 animate-pulse" />
    );
  }

  // Local mode without auth — show local user indicator, not sign-in buttons
  if (authMode === 'local' && !isAuthenticated) {
    return (
      <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" asChild>
        <Link to="/settings">
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium">
            L
          </div>
          <span className="text-xs">Local Mode</span>
        </Link>
      </Button>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/login">Sign in</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/signup">Sign up</Link>
        </Button>
      </div>
    );
  }

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 px-2"
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
              {initials}
            </div>
          )}
          <span className="hidden sm:inline max-w-[100px] truncate">
            {user.name}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{user.name}</p>
              {user.role === 'admin' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/10 text-red-500">
                  <Crown className="h-3 w-3" />
                  Admin
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/settings/account" className="flex items-center gap-2 cursor-pointer">
            <User className="h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link to="/settings" className="flex items-center gap-2 cursor-pointer">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link to="/settings/notifications" className="flex items-center gap-2 cursor-pointer">
            <Bell className="h-4 w-4" />
            Notifications
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Admin-only section */}
        {user.role === 'admin' && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Administration
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/admin/users" className="flex items-center gap-2 cursor-pointer">
                <Users className="h-4 w-4" />
                Manage Users
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem asChild>
          <Link to="/costs" className="flex items-center gap-2 cursor-pointer">
            <CreditCard className="h-4 w-4" />
            Usage & Costs
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link to="/settings/api-keys" className="flex items-center gap-2 cursor-pointer">
            <Shield className="h-4 w-4" />
            API Keys
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Connected accounts */}
        {user.connectedAccounts && user.connectedAccounts.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Connected Accounts
            </DropdownMenuLabel>
            {user.connectedAccounts.map((account) => (
              <DropdownMenuItem key={account.provider} disabled className="opacity-70">
                <Github className="h-4 w-4 mr-2" />
                @{account.username}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem
          onClick={handleLogout}
          className="text-destructive focus:text-destructive cursor-pointer"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
