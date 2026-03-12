/**
 * Devices Section - Manage paired devices and pairing requests
 */

import { useState } from 'react';
import {
  Smartphone,
  Laptop,
  Monitor,
  Trash2,
  Check,
  X,
  Copy,
  RefreshCw,
  Loader2,
  QrCode,
  Clock,
  Shield,
  AlertCircle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { API_BASE } from '../constants';

// Types
interface Device {
  id: string;
  deviceId: string;
  displayName: string;
  platform?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

interface PairingRequest {
  id: string;
  code: string;
  formattedCode: string;
  requesterId: string;
  meta?: Record<string, string>;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
}

interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  displayName?: string;
  platform?: string;
}

// Platform icon helper
function getPlatformIcon(platform?: string) {
  switch (platform?.toLowerCase()) {
    case 'macos':
    case 'darwin':
      return Laptop;
    case 'windows':
      return Monitor;
    case 'linux':
      return Monitor;
    default:
      return Smartphone;
  }
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return date.toLocaleDateString();
}

export function DevicesSection() {
  const queryClient = useQueryClient();
  const [deviceToRevoke, setDeviceToRevoke] = useState<Device | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Fetch current device identity
  const { data: identity, isLoading: identityLoading } = useQuery({
    queryKey: ['device-identity'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/devices/identity`, { credentials: 'include' });
      const data = await res.json();
      return data.identity as DeviceIdentity;
    },
  });

  // Fetch paired devices
  const { data: pairedDevices, isLoading: devicesLoading } = useQuery({
    queryKey: ['paired-devices'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/devices/paired`, { credentials: 'include' });
      const data = await res.json();
      return data.devices as Device[];
    },
  });

  // Fetch pending pairing requests
  const { data: pendingRequests, isLoading: requestsLoading } = useQuery({
    queryKey: ['pending-pairing-requests'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/devices/pairing/pending`, { credentials: 'include' });
      const data = await res.json();
      return data.requests as PairingRequest[];
    },
    refetchInterval: 10000, // Poll every 10s
  });

  // Request new pairing code
  const requestCodeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/devices/pairing/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pending-pairing-requests'] });
      toast.success('Pairing code generated', {
        description: `Code: ${data.formattedCode}`,
      });
    },
    onError: (error) => {
      toast.error('Failed to generate pairing code', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Approve pairing request
  const approveMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(`${API_BASE}/api/devices/pairing/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paired-devices'] });
      queryClient.invalidateQueries({ queryKey: ['pending-pairing-requests'] });
      toast.success('Device approved');
    },
    onError: (error) => {
      toast.error('Failed to approve device', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Reject pairing request
  const rejectMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(`${API_BASE}/api/devices/pairing/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-pairing-requests'] });
      toast.success('Device rejected');
    },
    onError: (error) => {
      toast.error('Failed to reject device', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  // Revoke device access
  const revokeMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const res = await fetch(`${API_BASE}/api/devices/paired/${deviceId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paired-devices'] });
      setDeviceToRevoke(null);
      toast.success('Device access revoked');
    },
    onError: (error) => {
      toast.error('Failed to revoke device', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
    toast.success('Code copied to clipboard');
  };

  return (
    <div className="space-y-6">
      {/* Current Device Identity */}
      <div className="rounded-2xl glass shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="font-medium">This Device</h3>
          </div>
          {identity && (
            <Badge variant="outline" className="font-mono text-xs">
              {identity.deviceId.slice(0, 12)}...
            </Badge>
          )}
        </div>

        {identityLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading device identity...</span>
          </div>
        ) : identity ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              {(() => {
                const Icon = getPlatformIcon(identity.platform);
                return <Icon className="h-4 w-4 text-muted-foreground" />;
              })()}
              <span>{identity.displayName || 'Unnamed Device'}</span>
              {identity.platform && (
                <Badge variant="secondary" className="text-xs">
                  {identity.platform}
                </Badge>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No device identity found. One will be created automatically.
          </p>
        )}
      </div>

      {/* Pending Pairing Requests */}
      <div className="rounded-2xl glass shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-amber-500" />
            <h3 className="font-medium">Pending Requests</h3>
            {pendingRequests && pendingRequests.length > 0 && (
              <Badge variant="secondary">{pendingRequests.length}</Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => requestCodeMutation.mutate()}
            disabled={requestCodeMutation.isPending}
          >
            {requestCodeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <QrCode className="h-4 w-4 mr-2" />
            )}
            Generate Code
          </Button>
        </div>

        {requestsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading requests...</span>
          </div>
        ) : pendingRequests && pendingRequests.length > 0 ? (
          <div className="space-y-3">
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10">
                    <Smartphone className="h-4 w-4 text-amber-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">
                        {request.formattedCode}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyCode(request.code)}
                      >
                        {copiedCode === request.code ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        Expires{' '}
                        {new Date(request.expiresAt).toLocaleTimeString()}
                      </span>
                      {request.meta?.displayName && (
                        <>
                          <span>•</span>
                          <span>{request.meta.displayName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                    onClick={() => approveMutation.mutate(request.code)}
                    disabled={approveMutation.isPending}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => rejectMutation.mutate(request.code)}
                    disabled={rejectMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <QrCode className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No pending pairing requests</p>
            <p className="text-xs mt-1">
              Click "Generate Code" to create a new pairing code
            </p>
          </div>
        )}
      </div>

      {/* Paired Devices */}
      <div className="rounded-2xl glass shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-green-500" />
            <h3 className="font-medium">Paired Devices</h3>
            {pairedDevices && pairedDevices.length > 0 && (
              <Badge variant="secondary">{pairedDevices.length}</Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['paired-devices'] })
            }
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {devicesLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading devices...</span>
          </div>
        ) : pairedDevices && pairedDevices.length > 0 ? (
          <div className="space-y-3">
            {pairedDevices.map((device) => {
              const Icon = getPlatformIcon(device.platform);
              const isCurrentDevice = device.deviceId === identity?.deviceId;

              return (
                <div
                  key={device.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border',
                    isCurrentDevice
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-muted/50 border-border'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'p-2 rounded-lg',
                        isCurrentDevice ? 'bg-primary/10' : 'bg-green-500/10'
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4',
                          isCurrentDevice
                            ? 'text-primary'
                            : 'text-green-500'
                        )}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{device.displayName}</span>
                        {isCurrentDevice && (
                          <Badge variant="default" className="text-xs">
                            This Device
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {device.platform && (
                          <>
                            <span>{device.platform}</span>
                            <span>•</span>
                          </>
                        )}
                        <span>
                          Paired {formatRelativeTime(device.approvedAt || device.createdAt)}
                        </span>
                        {device.approvedBy && (
                          <>
                            <span>•</span>
                            <span>by {device.approvedBy}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {!isCurrentDevice && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setDeviceToRevoke(device)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Smartphone className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No paired devices</p>
            <p className="text-xs mt-1">
              Pair a device to enable multi-device access
            </p>
          </div>
        )}
      </div>

      {/* Security Notice */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              Security Notice
            </p>
            <p className="text-muted-foreground mt-1">
              Only approve pairing requests from devices you trust. Paired
              devices have full access to your profClaw account. Revoke access
              immediately for any device you no longer use.
            </p>
          </div>
        </div>
      </div>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog
        open={!!deviceToRevoke}
        onOpenChange={() => setDeviceToRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Device Access?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke access for{' '}
              <strong>{deviceToRevoke?.displayName}</strong>. The device will
              need to be paired again to regain access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() =>
                deviceToRevoke && revokeMutation.mutate(deviceToRevoke.id)
              }
            >
              {revokeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
