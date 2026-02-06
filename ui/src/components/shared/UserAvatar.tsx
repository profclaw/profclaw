/**
 * UserAvatar Component
 *
 * A reusable avatar component that displays user initials or profile image.
 * Supports different sizes, variants, and online status indicators.
 */

import { cn } from '@/lib/utils';
import { User, Bot } from 'lucide-react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarVariant = 'default' | 'primary' | 'ai' | 'muted';

interface UserAvatarProps {
  /** User's display name - used for initials fallback */
  name?: string | null;
  /** User's email - used as secondary fallback for initials */
  email?: string | null;
  /** Direct image URL for avatar */
  imageUrl?: string | null;
  /** Size of the avatar */
  size?: AvatarSize;
  /** Visual variant */
  variant?: AvatarVariant;
  /** Whether to show online status indicator */
  showStatus?: boolean;
  /** Online status */
  isOnline?: boolean;
  /** Whether this is an AI/bot avatar */
  isAI?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

const iconSizes: Record<AvatarSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
  xl: 'h-8 w-8',
};

const statusSizes: Record<AvatarSize, string> = {
  xs: 'h-1.5 w-1.5 border',
  sm: 'h-2 w-2 border',
  md: 'h-2.5 w-2.5 border-2',
  lg: 'h-3 w-3 border-2',
  xl: 'h-4 w-4 border-2',
};

const variantClasses: Record<AvatarVariant, string> = {
  default: 'bg-muted border border-border text-foreground',
  primary: 'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground border-0',
  ai: 'bg-blue-500/10 border border-blue-500/30 text-blue-500',
  muted: 'bg-muted/50 border border-border/50 text-muted-foreground',
};

/**
 * Get initials from a name or email
 */
function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  if (email) {
    const localPart = email.split('@')[0];
    return localPart.slice(0, 2).toUpperCase();
  }

  return 'U';
}

export function UserAvatar({
  name,
  email,
  imageUrl,
  size = 'md',
  variant = 'default',
  showStatus = false,
  isOnline = false,
  isAI = false,
  className,
}: UserAvatarProps) {
  const initials = getInitials(name, email);
  const actualVariant = isAI ? 'ai' : variant;

  return (
    <div className={cn('relative inline-flex', className)}>
      <div
        className={cn(
          'rounded-xl flex items-center justify-center font-bold shrink-0 overflow-hidden',
          sizeClasses[size],
          variantClasses[actualVariant]
        )}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name || 'User avatar'}
            className="h-full w-full object-cover"
            onError={(e) => {
              // Hide broken image and show initials instead
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : isAI ? (
          <Bot className={iconSizes[size]} />
        ) : initials ? (
          <span>{initials}</span>
        ) : (
          <User className={iconSizes[size]} />
        )}
      </div>

      {/* Online status indicator */}
      {showStatus && (
        <div
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full border-background',
            statusSizes[size],
            isOnline ? 'bg-green-500' : 'bg-muted-foreground/50'
          )}
        />
      )}
    </div>
  );
}

/**
 * Avatar Group - displays multiple avatars stacked
 */
interface AvatarGroupProps {
  users: Array<{
    name?: string | null;
    email?: string | null;
    imageUrl?: string | null;
    isAI?: boolean;
  }>;
  size?: AvatarSize;
  max?: number;
  className?: string;
}

export function AvatarGroup({ users, size = 'sm', max = 4, className }: AvatarGroupProps) {
  const displayUsers = users.slice(0, max);
  const remaining = users.length - max;

  return (
    <div className={cn('flex -space-x-2', className)}>
      {displayUsers.map((user, idx) => (
        <UserAvatar
          key={idx}
          name={user.name}
          email={user.email}
          imageUrl={user.imageUrl}
          isAI={user.isAI}
          size={size}
          className="ring-2 ring-background"
        />
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            'rounded-xl flex items-center justify-center font-bold bg-muted border border-border text-muted-foreground ring-2 ring-background',
            sizeClasses[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
