/**
 * Admin User Management Page
 *
 * Allows admins to view, edit, and manage all users.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Search,
  MoreHorizontal,
  Shield,
  ShieldOff,
  Trash2,
  Key,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Crown,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const API_BASE = 'http://localhost:3000';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  onboardingCompleted: boolean;
}

interface UsersResponse {
  users: User[];
  total: number;
}

export function UserManagement() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetResult, setResetResult] = useState<{ password: string; codes: string[] } | null>(null);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  // Fetch all users
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/users/admin/list`, { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 403) throw new Error('Admin access required');
        throw new Error('Failed to fetch users');
      }
      return res.json() as Promise<UsersResponse>;
    },
  });

  // Update user mutation
  const updateUser = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: Partial<User> }) => {
      const res = await fetch(`${API_BASE}/api/users/admin/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update user');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User updated');
    },
    onError: () => toast.error('Failed to update user'),
  });

  // Reset password mutation
  const resetPassword = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`${API_BASE}/api/users/admin/${userId}/reset-password`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to reset password');
      return res.json() as Promise<{ temporaryPassword: string; recoveryCodes: string[] }>;
    },
    onSuccess: (data) => {
      setResetResult({ password: data.temporaryPassword, codes: data.recoveryCodes });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('Password reset successfully');
    },
    onError: () => toast.error('Failed to reset password'),
  });

  // Delete user mutation
  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`${API_BASE}/api/users/admin/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to delete user' }));
        throw new Error(err.error || 'Failed to delete user');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    setTimeout(() => setCopiedItem(null), 2000);
    toast.success(`${label} copied`);
  };

  // Filter users based on search
  const filteredUsers = data?.users?.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const handleToggleRole = (user: User) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    updateUser.mutate({ userId: user.id, updates: { role: newRole } });
  };

  const handleToggleStatus = (user: User) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    updateUser.mutate({ userId: user.id, updates: { status: newStatus } });
  };

  const handleResetPassword = (user: User) => {
    setSelectedUser(user);
    setShowResetModal(true);
    setResetResult(null);
  };

  const confirmResetPassword = () => {
    if (selectedUser) {
      resetPassword.mutate(selectedUser.id);
    }
  };

  const handleDeleteUser = (user: User) => {
    setDeleteTarget(user);
  };

  const confirmDeleteUser = () => {
    if (deleteTarget) {
      deleteUser.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Users className="h-6 w-6" />
            User Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage user accounts, roles, and permissions
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading} className="rounded-xl">
          <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 field-lg"
        />
      </div>

      {/* Users Table */}
      <div className="rounded-2xl glass shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-muted/30">
                <th className="text-left p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  User
                </th>
                <th className="text-left p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Role
                </th>
                <th className="text-left p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="text-left p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Created
                </th>
                <th className="text-right p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No users found
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="border-b border-white/5 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt={user.name}
                            className="h-10 w-10 rounded-full ring-1 ring-white/10"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-primary/60 ring-1 ring-white/10 flex items-center justify-center text-sm font-medium text-white">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                          user.role === 'admin'
                            ? 'bg-red-500/10 text-red-500'
                            : 'bg-blue-500/10 text-blue-500'
                        )}
                      >
                        {user.role === 'admin' && <Crown className="h-3 w-3" />}
                        {user.role}
                      </span>
                    </td>
                    <td className="p-4">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                          user.status === 'active'
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-amber-500/10 text-amber-500'
                        )}
                      >
                        {user.status === 'active' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        {user.status}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleToggleRole(user)}>
                              {user.role === 'admin' ? (
                                <>
                                  <ShieldOff className="h-4 w-4 mr-2" />
                                  Remove Admin
                                </>
                              ) : (
                                <>
                                  <Shield className="h-4 w-4 mr-2" />
                                  Make Admin
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggleStatus(user)}>
                              {user.status === 'active' ? (
                                <>
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Suspend User
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="h-4 w-4 mr-2" />
                                  Activate User
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleResetPassword(user)}>
                              <Key className="h-4 w-4 mr-2" />
                              Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDeleteUser(user)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl glass shadow-lg">
          <p className="text-sm text-muted-foreground">Total Users</p>
          <p className="text-2xl font-bold">{data?.total || 0}</p>
        </div>
        <div className="p-4 rounded-2xl glass shadow-lg">
          <p className="text-sm text-muted-foreground">Admins</p>
          <p className="text-2xl font-bold text-red-500">
            {data?.users?.filter((u) => u.role === 'admin').length || 0}
          </p>
        </div>
        <div className="p-4 rounded-2xl glass shadow-lg">
          <p className="text-sm text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-green-500">
            {data?.users?.filter((u) => u.status === 'active').length || 0}
          </p>
        </div>
      </div>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUser} className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Modal */}
      {showResetModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-heavy rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Key className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold">Reset Password</h3>
                <p className="text-sm text-muted-foreground">{selectedUser.name}</p>
              </div>
            </div>

            {resetResult ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-1">Temporary Password</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-sm">{resetResult.password}</code>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => copyToClipboard(resetResult.password, 'Password')}
                    >
                      {copiedItem === 'Password' ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-muted/30">
                  <p className="text-xs text-muted-foreground mb-2">Recovery Codes</p>
                  <div className="grid grid-cols-2 gap-2">
                    {resetResult.codes.map((code, i) => (
                      <code key={i} className="text-xs font-mono bg-background px-2 py-1 rounded">
                        {code}
                      </code>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-3 rounded-xl"
                    onClick={() => copyToClipboard(resetResult.codes.join('\n'), 'Codes')}
                  >
                    {copiedItem === 'Codes' ? (
                      <Check className="h-4 w-4 mr-2 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4 mr-2" />
                    )}
                    Copy All Codes
                  </Button>
                </div>

                <p className="text-xs text-amber-500 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  Share these credentials securely. The user must change their password on next login.
                </p>

                <Button className="w-full rounded-xl" onClick={() => setShowResetModal(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This will generate a new temporary password and recovery codes for{' '}
                  <strong>{selectedUser.email}</strong>. All existing sessions will be revoked.
                </p>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl"
                    onClick={() => setShowResetModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 rounded-xl"
                    onClick={confirmResetPassword}
                    disabled={resetPassword.isPending}
                  >
                    {resetPassword.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Reset Password'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
