/**
 * Admin Invite Code Management Page
 *
 * Allows admins to generate, list, and manage invite codes,
 * and toggle between open/invite registration modes.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Search,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Copy,
  Check,
  MoreHorizontal,
  Globe,
  Lock,
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
import {
  inviteCodesApi,
  type InviteCode,
  type GeneratedCode,
} from '@/core/api/domains/inviteCodes';

export function InviteCodeManagement() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showCodesModal, setShowCodesModal] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<GeneratedCode[]>([]);
  const [generateCount, setGenerateCount] = useState(1);
  const [generateLabel, setGenerateLabel] = useState('');
  const [generateExpiresDays, setGenerateExpiresDays] = useState('');
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InviteCode | null>(null);
  const [showModeConfirm, setShowModeConfirm] = useState(false);

  // Fetch invite codes
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'inviteCodes'],
    queryFn: () => inviteCodesApi.list(),
  });

  // Fetch registration mode
  const { data: modeData } = useQuery({
    queryKey: ['admin', 'registrationMode'],
    queryFn: () => inviteCodesApi.getRegistrationMode(),
  });

  // Generate invite codes mutation
  const generateCodes = useMutation({
    mutationFn: inviteCodesApi.generate,
    onSuccess: (result) => {
      setGeneratedCodes(result.codes);
      setShowGenerateModal(false);
      setShowCodesModal(true);
      setGenerateCount(1);
      setGenerateLabel('');
      setGenerateExpiresDays('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'inviteCodes'] });
      toast.success(`Generated ${result.codes.length} invite code(s)`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete invite code mutation
  const deleteCode = useMutation({
    mutationFn: inviteCodesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'inviteCodes'] });
      toast.success('Invite code deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Toggle registration mode mutation
  const toggleMode = useMutation({
    mutationFn: (mode: 'open' | 'invite') => inviteCodesApi.setRegistrationMode(mode),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'registrationMode'] });
      toast.success(`Registration mode set to ${result.mode}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    setTimeout(() => setCopiedItem(null), 2000);
    toast.success(`${label} copied`);
  };

  const getCodeStatus = (invite: InviteCode): { label: string; color: string; icon: typeof CheckCircle2 } => {
    if (invite.usedBy) {
      return { label: 'Used', color: 'bg-zinc-500/10 text-zinc-500', icon: CheckCircle2 };
    }
    if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
      return { label: 'Expired', color: 'bg-red-500/10 text-red-500', icon: XCircle };
    }
    return { label: 'Available', color: 'bg-green-500/10 text-green-500', icon: CheckCircle2 };
  };

  // Filter invites based on search
  const filteredInvites = data?.invites?.filter(
    (invite) =>
      (invite.label || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      invite.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (invite.createdBy || '').toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const handleGenerate = () => {
    generateCodes.mutate({
      count: generateCount,
      label: generateLabel || undefined,
      expiresInDays: generateExpiresDays ? parseInt(generateExpiresDays, 10) : undefined,
    });
  };

  const handleDelete = (invite: InviteCode) => {
    setDeleteTarget(invite);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteCode.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const handleToggleMode = () => {
    const newMode = modeData?.mode === 'invite' ? 'open' : 'invite';
    if (newMode === 'open') {
      setShowModeConfirm(true);
      return;
    }
    toggleMode.mutate(newMode);
  };

  const confirmToggleMode = () => {
    toggleMode.mutate('open');
    setShowModeConfirm(false);
  };

  const availableCount = data?.invites?.filter(
    (i) => !i.usedBy && (!i.expiresAt || new Date() <= new Date(i.expiresAt))
  ).length || 0;

  const usedCount = data?.invites?.filter((i) => i.usedBy).length || 0;

  const expiredCount = data?.invites?.filter(
    (i) => !i.usedBy && i.expiresAt && new Date() > new Date(i.expiresAt)
  ).length || 0;

  if (error) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">{(error as Error).message}</p>
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
            <KeyRound className="h-6 w-6" />
            Invite Codes
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate and manage invite codes for user registration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading} className="rounded-xl">
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button onClick={() => setShowGenerateModal(true)} className="rounded-xl">
            <Plus className="h-4 w-4 mr-2" />
            Generate Codes
          </Button>
        </div>
      </div>

      {/* Registration Mode Toggle */}
      <div className="rounded-2xl glass shadow-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {modeData?.mode === 'invite' ? (
            <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Lock className="h-5 w-5 text-amber-500" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <Globe className="h-5 w-5 text-green-500" />
            </div>
          )}
          <div>
            <p className="font-medium">Registration Mode: <span className="capitalize">{modeData?.mode || '...'}</span></p>
            <p className="text-sm text-muted-foreground">
              {modeData?.mode === 'invite'
                ? 'New users need an invite code to sign up'
                : 'Anyone can sign up without an invite code'}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleToggleMode}
          disabled={toggleMode.isPending}
          className="rounded-xl"
        >
          {toggleMode.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : modeData?.mode === 'invite' ? (
            <Globe className="h-4 w-4 mr-2" />
          ) : (
            <Lock className="h-4 w-4 mr-2" />
          )}
          Switch to {modeData?.mode === 'invite' ? 'Open' : 'Invite'}
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by label or ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 field-lg"
        />
      </div>

      {/* Invite Codes Table */}
      <div className="rounded-2xl glass shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-muted/30">
                <th className="text-left p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Label
                </th>
                <th className="text-left p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="text-left p-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Expires
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
              ) : filteredInvites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    {searchQuery ? 'No matching invite codes' : 'No invite codes yet. Generate some to get started.'}
                  </td>
                </tr>
              ) : (
                filteredInvites.map((invite) => {
                  const status = getCodeStatus(invite);
                  const StatusIcon = status.icon;
                  return (
                    <tr key={invite.id} className="border-b border-white/5 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="p-4">
                        <div>
                          <p className="font-medium">{invite.label || <span className="text-muted-foreground">No label</span>}</p>
                          <p className="text-xs text-muted-foreground font-mono">{invite.id.slice(0, 8)}...</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                            status.color
                          )}
                        >
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {invite.expiresAt ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(invite.expiresAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">Never</span>
                        )}
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {invite.createdAt ? new Date(invite.createdAt).toLocaleDateString() : '-'}
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
                              <DropdownMenuItem onClick={() => copyToClipboard(invite.id, 'ID')}>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy ID
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(invite)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl glass shadow-lg">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-bold">{data?.total || 0}</p>
        </div>
        <div className="p-4 rounded-2xl glass shadow-lg">
          <p className="text-sm text-muted-foreground">Available</p>
          <p className="text-2xl font-bold text-green-500">{availableCount}</p>
        </div>
        <div className="p-4 rounded-2xl glass shadow-lg">
          <p className="text-sm text-muted-foreground">Used</p>
          <p className="text-2xl font-bold text-zinc-500">{usedCount}</p>
        </div>
        <div className="p-4 rounded-2xl glass shadow-lg">
          <p className="text-sm text-muted-foreground">Expired</p>
          <p className="text-2xl font-bold text-red-500">{expiredCount}</p>
        </div>
      </div>

      {/* Generate Invite Codes Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-heavy rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Generate Invite Codes</h3>
                <p className="text-sm text-muted-foreground">Create new codes for user registration</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Number of codes</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-full field-lg"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Label (optional)</label>
                <input
                  type="text"
                  value={generateLabel}
                  onChange={(e) => setGenerateLabel(e.target.value)}
                  placeholder='e.g., "For onboarding batch 2"'
                  className="w-full field-lg"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Expires in (days, optional)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={generateExpiresDays}
                  onChange={(e) => setGenerateExpiresDays(e.target.value)}
                  placeholder="e.g., 7"
                  className="w-full field-lg"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl"
                  onClick={() => setShowGenerateModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 rounded-xl"
                  onClick={handleGenerate}
                  disabled={generateCodes.isPending}
                >
                  {generateCodes.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Generate'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Invite Code Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invite Code</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this invite code? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Switch to Open Registration Confirmation */}
      <AlertDialog open={showModeConfirm} onOpenChange={setShowModeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Open Registration?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone will be able to sign up without an invite code. You can switch back to invite-only at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmToggleMode} className="rounded-xl">
              Switch to Open
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generated Codes Display Modal */}
      {showCodesModal && generatedCodes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-heavy rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold">Invite Codes Generated</h3>
                <p className="text-sm text-muted-foreground">{generatedCodes.length} code(s) ready to share</p>
              </div>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {generatedCodes.map((gc) => (
                <div key={gc.id} className="flex items-center gap-2 p-3 rounded-xl bg-muted/30">
                  <code className="flex-1 font-mono text-sm font-semibold">{gc.code}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => copyToClipboard(gc.code, gc.id)}
                  >
                    {copiedItem === gc.id ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>

            <Button
              size="sm"
              variant="outline"
              className="w-full mt-3 rounded-xl"
              onClick={() =>
                copyToClipboard(generatedCodes.map((c) => c.code).join('\n'), 'all-codes')
              }
            >
              {copiedItem === 'all-codes' ? (
                <Check className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              Copy All
            </Button>

            <p className="text-xs text-amber-500 flex items-start gap-2 mt-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              Save these codes now. They cannot be retrieved later.
            </p>

            <Button className="w-full rounded-xl mt-3" onClick={() => setShowCodesModal(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
