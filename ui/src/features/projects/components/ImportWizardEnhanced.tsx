/**
 * Enhanced GitHub Projects Import Wizard
 *
 * Multi-step wizard with full data preview, field mapping, and conflict detection.
 * Supports both OAuth (recommended) and PAT authentication.
 */

import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  Github,
  Key,
  FolderGit2,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Sparkles,
  User,
  Copy,
  Shield,
  Settings,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ProjectIcon } from './ProjectIcon';
import {
  FieldMappingEditor,
  ImportPreviewTable,
  ImportSummaryCard,
  type GitHubProject,
  type GitHubProjectPreview,
  type FieldMappings,
  type ImportSummary,
  type ImportPreviewItem,
} from './import';

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type WizardStep = 'connect' | 'select' | 'mapping' | 'preview' | 'configure' | 'import';
type AuthMethod = 'oauth' | 'pat';

const STEPS: WizardStep[] = ['connect', 'select', 'mapping', 'preview', 'configure', 'import'];

const STEP_TITLES: Record<WizardStep, string> = {
  connect: 'Connect',
  select: 'Select',
  mapping: 'Map Fields',
  preview: 'Preview',
  configure: 'Configure',
  import: 'Import',
};

const PROJECT_ICONS = ['📋', '🚀', '💡', '🎯', '⚡', '🔧', '📱', '🌐', '🎨', '📊'];
const PROJECT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

const REQUIRED_SCOPES = ['read:project', 'repo', 'user:email'];

interface AuthStatus {
  authenticated: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    hasGitHubToken?: boolean;
    connectedAccounts?: Array<{ provider: string; username: string }>;
  };
}

export function ImportWizardEnhanced({ open, onOpenChange, onSuccess }: ImportWizardProps) {
  const queryClient = useQueryClient();

  // Wizard state
  const [step, setStep] = useState<WizardStep>('connect');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('oauth');
  const [token, setToken] = useState('');
  const [showPatGuide, setShowPatGuide] = useState(false);

  // Project selection
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Preview data
  const [preview, setPreview] = useState<GitHubProjectPreview | null>(null);

  // Field mappings
  const [fieldMappings, setFieldMappings] = useState<FieldMappings>({
    status: {},
    priority: {},
    type: {},
  });

  // Item selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Dry run result
  const [dryRunResult, setDryRunResult] = useState<{
    summary: ImportSummary;
    items: ImportPreviewItem[];
  } | null>(null);

  // Configuration
  const [projectKey, setProjectKey] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectIcon, setProjectIcon] = useState('📋');
  const [projectColor, setProjectColor] = useState('#6366f1');
  const [importIterations, setImportIterations] = useState(true);
  const [enableSync, setEnableSync] = useState(true);
  const [preserveTimestamps, setPreserveTimestamps] = useState(true);

  // Import result
  const [importResult, setImportResult] = useState<{
    project: { id: string; key: string; name: string };
    summary: {
      projectCreated: boolean;
      sprintsCreated: number;
      ticketsCreated: number;
    };
  } | null>(null);

  // Check auth status
  const { data: authStatus, isLoading: checkingAuth } = useQuery({
    queryKey: ['auth-status'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return { authenticated: false };
      return res.json() as Promise<AuthStatus>;
    },
    enabled: open,
  });

  // Check if already connected
  const { data: tokenStatus, isLoading: checkingToken } = useQuery({
    queryKey: ['github-token-status'],
    queryFn: async () => {
      const res = await fetch('/api/import/github/status');
      if (!res.ok) throw new Error('Failed to check token');
      return res.json();
    },
    enabled: open && !authStatus?.user?.hasGitHubToken,
  });

  const isGitHubConnected = authStatus?.user?.hasGitHubToken || tokenStatus?.hasToken;
  const githubUsername = authStatus?.user?.connectedAccounts?.find(a => a.provider === 'github')?.username || tokenStatus?.username;

  // Auto-advance if already connected
  useEffect(() => {
    if (isGitHubConnected && step === 'connect') {
      setStep('select');
    }
  }, [isGitHubConnected, step]);

  // Fetch projects
  const { data: projectsData, isLoading: projectsLoading, refetch: refetchProjects } = useQuery({
    queryKey: ['github-projects'],
    queryFn: async () => {
      const res = await fetch('/api/import/github/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json() as Promise<{ projects: GitHubProject[] }>;
    },
    enabled: step === 'select',
  });

  // GitHub OAuth URL
  const { data: oauthUrl } = useQuery({
    queryKey: ['github-oauth-url'],
    queryFn: async () => {
      const res = await fetch('/api/auth/github/url');
      if (!res.ok) return null;
      return res.json() as Promise<{ url: string; state: string }>;
    },
    enabled: open && authMethod === 'oauth',
  });

  // Validate token mutation
  const validateToken = useMutation({
    mutationFn: async (patToken: string) => {
      const res = await fetch('/api/import/github/validate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: patToken }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Token validation failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Connected as ${data.username}`);
      queryClient.invalidateQueries({ queryKey: ['github-token-status'] });
      queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      setStep('select');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Fetch project preview
  const fetchPreview = useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`/api/import/github/projects/${encodeURIComponent(projectId)}/preview`);
      if (!res.ok) throw new Error('Failed to fetch project preview');
      return res.json() as Promise<GitHubProjectPreview>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setFieldMappings(data.fieldMappings);
      // Select all items by default
      setSelectedItemIds(new Set(data.items.map(i => i.id)));
      // Auto-generate project key and name
      const suggestedKey = data.project.title
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
      setProjectKey(suggestedKey);
      setProjectName(data.project.title);
      setStep('mapping');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Dry run mutation
  const runDryRun = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/import/github/projects/${encodeURIComponent(selectedProjectId!)}/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldMappings,
          selectedItemIds: Array.from(selectedItemIds),
        }),
      });
      if (!res.ok) throw new Error('Dry run failed');
      return res.json();
    },
    onSuccess: (data) => {
      setDryRunResult(data);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Execute import
  const executeImport = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/import/github/projects/${encodeURIComponent(selectedProjectId!)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey,
          projectName,
          icon: projectIcon,
          color: projectColor,
          importIterations,
          enableSync,
          preserveTimestamps,
          selectedItemIds: Array.from(selectedItemIds),
          fieldMappings,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project imported successfully!');
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Disconnect GitHub
  const disconnect = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/import/github/disconnect', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Disconnected from GitHub');
      queryClient.invalidateQueries({ queryKey: ['github-token-status'] });
      queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      setStep('connect');
      setToken('');
    },
  });

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(isGitHubConnected ? 'select' : 'connect');
        setToken('');
        setAuthMethod('oauth');
        setShowPatGuide(false);
        setSelectedProjectId(null);
        setPreview(null);
        setDryRunResult(null);
        setImportResult(null);
        setProjectKey('');
        setProjectName('');
        setProjectIcon('📋');
        setProjectColor('#6366f1');
        setImportIterations(true);
        setEnableSync(true);
        setPreserveTimestamps(true);
        setSelectedItemIds(new Set());
        setFieldMappings({ status: {}, priority: {}, type: {} });
      }, 200);
    }
  }, [open, isGitHubConnected]);

  const stepIndex = STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const canGoBack = step !== 'connect' && step !== 'import';
  const canGoNext = () => {
    switch (step) {
      case 'connect':
        return authMethod === 'oauth' || token.length > 0;
      case 'select':
        return selectedProjectId !== null;
      case 'mapping':
        return true; // Can proceed with unmapped values (will use defaults)
      case 'preview':
        return selectedItemIds.size > 0;
      case 'configure':
        return projectKey.length >= 2 && projectName.length >= 1;
      default:
        return false;
    }
  };

  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) {
      setStep(STEPS[idx - 1]);
    }
  };

  const goNext = async () => {
    switch (step) {
      case 'connect':
        if (authMethod === 'oauth' && oauthUrl?.url) {
          window.location.href = oauthUrl.url;
        } else {
          validateToken.mutate(token);
        }
        break;
      case 'select':
        if (selectedProjectId) {
          fetchPreview.mutate(selectedProjectId);
        }
        break;
      case 'mapping':
        setStep('preview');
        break;
      case 'preview':
        // Run dry-run before configure
        await runDryRun.mutateAsync();
        setStep('configure');
        break;
      case 'configure':
        setStep('import');
        executeImport.mutate();
        break;
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  // Calculate summary for ImportSummaryCard
  const importSummary: ImportSummary = useMemo(() => {
    if (dryRunResult) {
      return dryRunResult.summary;
    }
    // Fallback calculation
    const items = preview?.items || [];
    const selected = selectedItemIds;

    const unmappedStatus = new Set<string>();
    const unmappedPriority = new Set<string>();
    const unmappedType = new Set<string>();

    for (const item of items) {
      if (item.status && !fieldMappings.status[item.status]) unmappedStatus.add(item.status);
      if (item.priority && !fieldMappings.priority[item.priority]) unmappedPriority.add(item.priority);
      if (item.type && !fieldMappings.type[item.type]) unmappedType.add(item.type);
    }

    return {
      totalItems: items.length,
      itemsToCreate: selected.size,
      itemsToSkip: items.length - selected.size,
      iterations: preview?.iterations.length || 0,
      conflicts: {
        errors: 0,
        warnings: unmappedStatus.size + unmappedPriority.size + unmappedType.size,
      },
      unmappedValues: {
        status: Array.from(unmappedStatus),
        priority: Array.from(unmappedPriority),
        type: Array.from(unmappedType),
      },
    };
  }, [preview, selectedItemIds, fieldMappings, dryRunResult]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Import from GitHub Projects
          </DialogTitle>
        </DialogHeader>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cn(
                  'transition-colors',
                  i <= stepIndex ? 'text-primary font-medium' : ''
                )}
              >
                {STEP_TITLES[s]}
              </span>
            ))}
          </div>
          <Progress value={progress} className="h-1" />
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto py-4 min-h-[400px]">
          {/* Step 1: Connect */}
          {step === 'connect' && (
            <div className="space-y-6">
              {/* Already authenticated user */}
              {authStatus?.authenticated && authStatus.user && !authStatus.user.hasGitHubToken && (
                <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
                  {authStatus.user.avatarUrl ? (
                    <img
                      src={authStatus.user.avatarUrl}
                      alt={authStatus.user.name}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <User className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-medium">{authStatus.user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Connect GitHub to import your projects
                    </p>
                  </div>
                </div>
              )}

              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center mx-auto mb-4">
                  <Github className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Connect Your GitHub</h3>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  Connect your GitHub account to import Projects, Issues, and more.
                </p>
              </div>

              {/* Auth Method Tabs */}
              <div className="flex items-center justify-center gap-2 p-1 bg-muted rounded-lg max-w-xs mx-auto">
                <button
                  onClick={() => setAuthMethod('oauth')}
                  className={cn(
                    'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all',
                    authMethod === 'oauth'
                      ? 'bg-background shadow-sm'
                      : 'hover:bg-background/50 text-muted-foreground'
                  )}
                >
                  <Shield className="h-4 w-4 inline-block mr-2" />
                  OAuth
                </button>
                <button
                  onClick={() => setAuthMethod('pat')}
                  className={cn(
                    'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all',
                    authMethod === 'pat'
                      ? 'bg-background shadow-sm'
                      : 'hover:bg-background/50 text-muted-foreground'
                  )}
                >
                  <Key className="h-4 w-4 inline-block mr-2" />
                  Token
                </button>
              </div>

              {/* OAuth Option */}
              {authMethod === 'oauth' && (
                <div className="max-w-md mx-auto space-y-4">
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                    <h4 className="font-medium text-green-600 flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Recommended Method
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-green-500" />
                        One-click authentication
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-green-500" />
                        Automatic token refresh
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-3 w-3 text-green-500" />
                        Secure OAuth 2.0 flow
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              {/* PAT Option */}
              {authMethod === 'pat' && (
                <div className="max-w-md mx-auto space-y-4">
                  {!showPatGuide ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowPatGuide(true)}
                    >
                      <Key className="h-4 w-4 mr-2" />
                      I have a Personal Access Token
                    </Button>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                        <h4 className="font-medium text-sm">Create a Personal Access Token</h4>
                        <div className="space-y-2">
                          <div className="flex items-start gap-3 text-sm">
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</span>
                            <a
                              href="https://github.com/settings/tokens?type=beta"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                            >
                              Open GitHub Token Settings <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <div className="flex items-start gap-3 text-sm">
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</span>
                            <span>Click "Generate new token" and choose "Fine-grained token"</span>
                          </div>
                          <div className="flex items-start gap-3 text-sm">
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</span>
                            <div className="flex-1 space-y-2">
                              <span>Enable these permissions:</span>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {REQUIRED_SCOPES.map((scope) => (
                                  <button
                                    key={scope}
                                    onClick={() => copyToClipboard(scope)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-background rounded text-xs font-mono border border-border hover:border-primary transition-colors"
                                  >
                                    {scope}
                                    <Copy className="h-3 w-3 opacity-50" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 text-sm">
                            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">4</span>
                            <span>Copy the token and paste it below</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="pat">Personal Access Token</Label>
                        <Input
                          id="pat"
                          type="password"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          placeholder="github_pat_xxxxxxxxxxxxxxxxxxxxxxxx"
                          className="font-mono bg-muted/50"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Select Project */}
          {step === 'select' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Your GitHub Projects</h3>
                  {githubUsername && (
                    <p className="text-xs text-muted-foreground">
                      Connected as <span className="font-medium">@{githubUsername}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refetchProjects()}
                    disabled={projectsLoading}
                  >
                    <RefreshCw className={cn('h-4 w-4', projectsLoading && 'animate-spin')} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>

              {projectsLoading || checkingToken || checkingAuth ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : projectsData?.projects?.length === 0 ? (
                <div className="text-center py-12">
                  <FolderGit2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No GitHub Projects found</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Make sure you have at least one Project V2 in your account
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => window.open('https://github.com/new/project', '_blank')}
                  >
                    Create a GitHub Project <ExternalLink className="h-3 w-3 ml-2" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {projectsData?.projects?.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                      className={cn(
                        'w-full text-left p-4 rounded-lg border transition-all',
                        selectedProjectId === project.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/30 hover:bg-muted/50'
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium truncate">{project.title}</h4>
                            {project.public ? (
                              <Badge variant="outline" className="text-[10px]">Public</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">Private</Badge>
                            )}
                          </div>
                          {project.shortDescription && (
                            <p className="text-sm text-muted-foreground mt-1 truncate">
                              {project.shortDescription}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>{project.items.totalCount} items</span>
                            <span>{project.fields.totalCount} fields</span>
                            {project.creator && <span>by {project.creator.login}</span>}
                          </div>
                        </div>
                        {selectedProjectId === project.id && (
                          <Check className="h-5 w-5 text-primary shrink-0 ml-2" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Field Mapping */}
          {step === 'mapping' && preview && (
            <FieldMappingEditor
              items={preview.items}
              mappings={fieldMappings}
              onMappingsChange={setFieldMappings}
            />
          )}

          {/* Step 4: Preview Items */}
          {step === 'preview' && preview && (
            <ImportPreviewTable
              items={preview.items}
              mappings={fieldMappings}
              selectedIds={selectedItemIds}
              onSelectionChange={setSelectedItemIds}
            />
          )}

          {/* Step 5: Configure */}
          {step === 'configure' && (
            <div className="space-y-6">
              <Tabs defaultValue="project" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="project" className="gap-2">
                    <Settings className="h-4 w-4" />
                    Project Settings
                  </TabsTrigger>
                  <TabsTrigger value="summary" className="gap-2">
                    <FileText className="h-4 w-4" />
                    Import Summary
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="project" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="project-key">
                        Project Key <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="project-key"
                        value={projectKey}
                        onChange={(e) => setProjectKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                        placeholder="PROJ"
                        className="font-mono uppercase bg-muted/50"
                        maxLength={10}
                      />
                      <p className="text-xs text-muted-foreground">
                        Used as ticket prefix (e.g., {projectKey || 'PROJ'}-1)
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="project-name">
                        Project Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="project-name"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="My Project"
                        className="bg-muted/50"
                      />
                    </div>
                  </div>

                  {/* Icon & Color */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Icon</Label>
                      <div className="flex flex-wrap gap-2">
                        {PROJECT_ICONS.map((icon) => (
                          <button
                            key={icon}
                            type="button"
                            onClick={() => setProjectIcon(icon)}
                            className={cn(
                              'w-10 h-10 flex items-center justify-center rounded-lg border text-xl transition-all',
                              projectIcon === icon
                                ? 'border-primary bg-primary/10'
                                : 'border-border hover:border-primary/30'
                            )}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Color</Label>
                      <div className="flex flex-wrap gap-2">
                        {PROJECT_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setProjectColor(color)}
                            className={cn(
                              'w-10 h-10 rounded-lg border-2 transition-all',
                              projectColor === color ? 'border-primary scale-110' : 'border-transparent'
                            )}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-2">Preview</p>
                    <div className="flex items-center gap-3">
                      <ProjectIcon icon={projectIcon} color={projectColor} size="lg" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-mono font-bold px-2 py-0.5 rounded"
                            style={{ backgroundColor: `${projectColor}20`, color: projectColor }}
                          >
                            {projectKey || 'KEY'}
                          </span>
                        </div>
                        <p className="font-medium mt-1">{projectName || 'Project Name'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Import Options */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">Import Iterations as Sprints</p>
                        <p className="text-xs text-muted-foreground">
                          {preview?.iterations.length || 0} iterations will become sprints
                        </p>
                      </div>
                      <Switch checked={importIterations} onCheckedChange={setImportIterations} />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div>
                        <p className="font-medium text-sm flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          Enable Bidirectional Sync
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Keep tickets synchronized with GitHub issues
                        </p>
                      </div>
                      <Switch checked={enableSync} onCheckedChange={setEnableSync} />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">Preserve Original Timestamps</p>
                        <p className="text-xs text-muted-foreground">
                          Use GitHub's created/updated dates
                        </p>
                      </div>
                      <Switch checked={preserveTimestamps} onCheckedChange={setPreserveTimestamps} />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="summary" className="mt-4">
                  <ImportSummaryCard
                    summary={importSummary}
                    iterations={preview?.iterations || []}
                    projectKey={projectKey}
                    enableSync={enableSync}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Step 6: Import */}
          {step === 'import' && (
            <div className="space-y-6 py-8">
              {executeImport.isPending && (
                <div className="text-center">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                  <p className="font-medium">Importing from GitHub...</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Creating project, sprints, and tickets
                  </p>
                </div>
              )}

              {executeImport.isError && (
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="h-6 w-6 text-destructive" />
                  </div>
                  <p className="font-medium text-destructive">Import Failed</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {executeImport.error?.message || 'An error occurred'}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => executeImport.mutate()}
                  >
                    Try Again
                  </Button>
                </div>
              )}

              {importResult && (
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                  </div>
                  <p className="text-lg font-semibold">Import Complete!</p>

                  <div className="grid grid-cols-3 gap-4 mt-6 max-w-md mx-auto">
                    <div className="bg-card rounded-lg border border-border p-3 text-center">
                      <p className="text-2xl font-bold text-primary">1</p>
                      <p className="text-xs text-muted-foreground">Project</p>
                    </div>
                    <div className="bg-card rounded-lg border border-border p-3 text-center">
                      <p className="text-2xl font-bold text-amber-500">
                        {importResult.summary.sprintsCreated}
                      </p>
                      <p className="text-xs text-muted-foreground">Sprints</p>
                    </div>
                    <div className="bg-card rounded-lg border border-border p-3 text-center">
                      <p className="text-2xl font-bold text-green-500">
                        {importResult.summary.ticketsCreated}
                      </p>
                      <p className="text-xs text-muted-foreground">Tickets</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3 mt-6">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                      Close
                    </Button>
                    <Button
                      onClick={() => {
                        onOpenChange(false);
                        window.location.href = `/projects/${importResult.project.id}`;
                      }}
                    >
                      View Project
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {step !== 'import' && (
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <Button
              variant="ghost"
              onClick={goBack}
              disabled={!canGoBack}
              className={cn(!canGoBack && 'invisible')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>

            <Button
              onClick={goNext}
              disabled={
                !canGoNext() ||
                validateToken.isPending ||
                fetchPreview.isPending ||
                runDryRun.isPending ||
                (authMethod === 'pat' && step === 'connect' && !showPatGuide)
              }
              className="gap-2"
            >
              {(validateToken.isPending || fetchPreview.isPending || runDryRun.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {step === 'connect' && authMethod === 'oauth' ? (
                <>
                  <Github className="h-4 w-4" />
                  Continue with GitHub
                </>
              ) : step === 'configure' ? (
                'Start Import'
              ) : (
                'Continue'
              )}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
