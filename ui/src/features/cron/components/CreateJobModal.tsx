/**
 * Create Job Modal - Enhanced Wizard with Simple/Advanced Modes
 *
 * Features:
 * - Simple mode: Quick setup with templates and presets
 * - Advanced mode: Full control over all options
 * - Inline guides and disclaimers
 * - Built-in templates for common use cases
 * - Real-time validation and preview
 */

import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Globe,
  Wrench,
  Terminal,
  MessageSquare,
  Clock,
  Timer,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Info,
  Calendar,
  Zap,
  FileCode,
  RefreshCcw,
  Bell,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Check,
  Play,
  ArrowRight,
  Settings2,
  Eye,
  AlertTriangle,
  Lightbulb,
  Shield,
  Database,
  GitBranch,
  Webhook,
  HelpCircle,
  Wand2,
  SlidersHorizontal,
  Activity,
  HardDrive,
  RefreshCw,
  Megaphone,
  Link2,
  Trash2,
  BarChart3,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { api } from '@/core/api/client';
import type { CreateJobModalProps, JobType } from '../types';

// =============================================================================
// Types & Constants
// =============================================================================

type Step = 'type' | 'schedule' | 'config' | 'review';
type ScheduleType = 'cron' | 'interval' | 'oneshot' | 'event';
type Mode = 'simple' | 'advanced';
type TemplateSelection = {
  id: string;
  name: string;
  category: string;
  description?: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  suggestedCron?: string;
  guide?: string;
  warning?: string;
};

interface StepConfig {
  id: Step;
  label: string;
  icon: typeof Clock;
  description: string;
}

const STEPS: StepConfig[] = [
  { id: 'type', label: 'Type', icon: Sparkles, description: 'What kind of job?' },
  { id: 'schedule', label: 'Schedule', icon: Clock, description: 'When to run?' },
  { id: 'config', label: 'Configure', icon: Settings2, description: 'Job details' },
  { id: 'review', label: 'Review', icon: Eye, description: 'Confirm & create' },
];

// Built-in templates with categories
const BUILTIN_TEMPLATES = [
  {
    id: 'health-check',
    name: 'Health Check',
    category: 'monitoring',
    icon: Activity,
    description: 'Monitor service health with HTTP pings',
    jobType: 'http' as JobType,
    suggestedCron: '*/5 * * * *',
    payload: { url: 'https://your-api.com/health', method: 'GET' },
    guide: 'Regularly checks if your service is responding. Great for uptime monitoring.',
  },
  {
    id: 'db-backup',
    name: 'Database Backup',
    category: 'maintenance',
    icon: HardDrive,
    description: 'Schedule automated database backups',
    jobType: 'script' as JobType,
    suggestedCron: '0 2 * * *',
    payload: { command: 'pg_dump', args: ['-h', 'localhost', 'mydb'] },
    guide: 'Runs daily at 2 AM. Adjust the command for your database type.',
    warning: 'Ensure backup storage has sufficient space.',
  },
  {
    id: 'git-sync',
    name: 'Git Repository Sync',
    category: 'development',
    icon: RefreshCw,
    description: 'Pull latest changes from remote',
    jobType: 'tool' as JobType,
    suggestedCron: '*/30 * * * *',
    payload: { tool: 'git_pull', params: { branch: 'main' } },
    guide: 'Keeps local repositories in sync with remote.',
  },
  {
    id: 'slack-standup',
    name: 'Daily Standup Reminder',
    category: 'notifications',
    icon: Megaphone,
    description: 'Send daily standup reminders to Slack',
    jobType: 'message' as JobType,
    suggestedCron: '0 9 * * 1-5',
    payload: { channel: '#team', message: 'Good morning! Time for standup!' },
    guide: 'Sends at 9 AM on weekdays. Change channel and message as needed.',
  },
  {
    id: 'api-sync',
    name: 'External API Sync',
    category: 'integration',
    icon: Link2,
    description: 'Sync data from external APIs',
    jobType: 'http' as JobType,
    suggestedCron: '0 */4 * * *',
    payload: { url: 'https://api.example.com/sync', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    guide: 'Runs every 4 hours. Add authentication headers if required.',
  },
  {
    id: 'cleanup',
    name: 'Cleanup Old Files',
    category: 'maintenance',
    icon: Trash2,
    description: 'Remove temporary and old files',
    jobType: 'script' as JobType,
    suggestedCron: '0 3 * * 0',
    payload: { command: 'find', args: ['/tmp', '-mtime', '+7', '-delete'] },
    guide: 'Runs weekly on Sunday at 3 AM.',
    warning: 'Double-check paths before enabling to avoid data loss.',
  },
  {
    id: 'report-gen',
    name: 'Generate Reports',
    category: 'analytics',
    icon: BarChart3,
    description: 'Generate and send automated reports',
    jobType: 'tool' as JobType,
    suggestedCron: '0 8 * * 1',
    payload: { tool: 'generate_report', params: { type: 'weekly', format: 'pdf' } },
    guide: 'Generates weekly reports every Monday at 8 AM.',
  },
  {
    id: 'webhook-trigger',
    name: 'Webhook Trigger',
    category: 'integration',
    icon: Zap,
    description: 'Trigger external webhooks on schedule',
    jobType: 'http' as JobType,
    suggestedCron: '0 */6 * * *',
    payload: { url: 'https://hooks.example.com/trigger', method: 'POST', body: { event: 'scheduled' } },
    guide: 'Triggers every 6 hours. Customize the webhook URL and payload.',
  },
];

const TEMPLATE_CATEGORIES = [
  { id: 'all', label: 'All', icon: Sparkles },
  { id: 'monitoring', label: 'Monitoring', icon: Eye },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'development', label: 'Development', icon: GitBranch },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'integration', label: 'Integration', icon: Webhook },
  { id: 'analytics', label: 'Analytics', icon: Database },
];

const JOB_TYPES = [
  {
    type: 'http' as JobType,
    label: 'HTTP Request',
    icon: Globe,
    description: 'Call an API endpoint',
    color: 'from-blue-500/20 to-cyan-500/20',
    examples: ['Sync data from API', 'Health checks', 'Webhook triggers'],
    defaultPayload: { url: 'https://api.example.com/endpoint', method: 'POST', headers: {} },
    guide: 'Make HTTP requests to external services. Supports GET, POST, PUT, DELETE methods.',
  },
  {
    type: 'tool' as JobType,
    label: 'Tool Execution',
    icon: Wrench,
    description: 'Run a profClaw tool',
    color: 'from-indigo-500/20 to-pink-500/20',
    examples: ['Git operations', 'File sync', 'Database backups'],
    defaultPayload: { tool: 'git_status', params: {} },
    guide: 'Execute any registered profClaw tool with custom parameters.',
  },
  {
    type: 'script' as JobType,
    label: 'Shell Script',
    icon: Terminal,
    description: 'Execute a command',
    color: 'from-green-500/20 to-emerald-500/20',
    examples: ['Build scripts', 'Cleanup tasks', 'System checks'],
    defaultPayload: { command: 'echo "Hello World"', args: [] },
    guide: 'Run shell commands on the server. Use with caution.',
    warning: 'Scripts run with server permissions. Avoid sensitive operations.',
  },
  {
    type: 'message' as JobType,
    label: 'Notification',
    icon: MessageSquare,
    description: 'Send a message',
    color: 'from-orange-500/20 to-amber-500/20',
    examples: ['Daily standup reminder', 'Status reports', 'Alerts'],
    defaultPayload: { channel: '#general', message: 'Scheduled notification' },
    guide: 'Send messages to Slack channels, email, or webhooks.',
  },
];

const SCHEDULE_TYPES = [
  { type: 'cron' as ScheduleType, label: 'Cron', icon: Clock, description: 'Classic cron syntax' },
  { type: 'interval' as ScheduleType, label: 'Interval', icon: Timer, description: 'Every X seconds' },
  { type: 'oneshot' as ScheduleType, label: 'One-Time', icon: Calendar, description: 'Run once' },
  { type: 'event' as ScheduleType, label: 'Event', icon: Zap, description: 'On trigger' },
];

const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *', humanize: 'Runs every minute' },
  { label: 'Every 5 min', value: '*/5 * * * *', humanize: 'Runs every 5 minutes' },
  { label: 'Every 15 min', value: '*/15 * * * *', humanize: 'Runs every 15 minutes' },
  { label: 'Hourly', value: '0 * * * *', humanize: 'Runs at the start of every hour' },
  { label: 'Daily midnight', value: '0 0 * * *', humanize: 'Runs daily at midnight' },
  { label: 'Weekdays 9am', value: '0 9 * * 1-5', humanize: 'Runs at 9am on weekdays' },
];

const INTERVAL_PRESETS = [
  { label: '30 sec', value: 30, humanize: 'Every 30 seconds' },
  { label: '1 min', value: 60, humanize: 'Every minute' },
  { label: '5 min', value: 300, humanize: 'Every 5 minutes' },
  { label: '15 min', value: 900, humanize: 'Every 15 minutes' },
  { label: '30 min', value: 1800, humanize: 'Every 30 minutes' },
  { label: '1 hour', value: 3600, humanize: 'Every hour' },
];

const EVENT_TYPES = [
  { type: 'webhook', label: 'Webhook', description: 'HTTP webhook endpoint' },
  { type: 'ticket', label: 'Ticket', description: 'Ticket changes' },
  { type: 'github', label: 'GitHub', description: 'Push, PR, issues' },
  { type: 'file', label: 'File', description: 'File changes' },
];

// =============================================================================
// Helper Components
// =============================================================================

function GuideBox({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'warning' | 'tip' }) {
  const styles = {
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300',
    tip: 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-300',
  };
  const icons = {
    info: Info,
    warning: AlertTriangle,
    tip: Lightbulb,
  };
  const Icon = icons[type];

  return (
    <div className={cn('flex items-start gap-2 p-3 rounded-lg border text-xs', styles[type])}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  return (
    <span className="relative group">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded bg-popover border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {content}
      </span>
    </span>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

function humanizeCron(expr: string): string {
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  if (preset) return preset.humanize;

  const parts = expr.split(' ');
  if (parts.length !== 5) return `Cron: ${expr}`;

  const [min, hour, day, month, weekday] = parts;

  if (min.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return `Every ${min.slice(2)} minutes`;
  }
  if (min === '0' && hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') {
    return `Every ${hour.slice(2)} hours`;
  }
  if (min === '0' && hour === '0' && day === '*' && month === '*' && weekday === '*') {
    return 'Daily at midnight';
  }

  return `Cron: ${expr}`;
}

function validateJson(value: string): { valid: boolean; error?: string; parsed?: unknown } {
  try {
    const parsed = JSON.parse(value);
    return { valid: true, parsed };
  } catch {
    return { valid: false, error: 'Invalid JSON syntax' };
  }
}

// =============================================================================
// Main Component
// =============================================================================

export function CreateJobModal({ open: controlledOpen, onOpenChange }: CreateJobModalProps) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  // Mode and step
  const [mode, setMode] = useState<Mode>('simple');
  const [step, setStep] = useState<Step>('type');
  const currentStepIndex = STEPS.findIndex((s) => s.id === step);

  // Template filter
  const [templateCategory, setTemplateCategory] = useState('all');

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [jobType, setJobType] = useState<JobType | null>(null);
  const [scheduleType, setScheduleType] = useState<ScheduleType | null>(null);
  const [cronExpression, setCronExpression] = useState('*/5 * * * *');
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [runAtDate, setRunAtDate] = useState('');
  const [runAtTime, setRunAtTime] = useState('');
  const [eventType, setEventType] = useState('webhook');
  const [eventConfig, setEventConfig] = useState('{}');
  const [payload, setPayload] = useState('{}');
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSelection | null>(null);

  // Advanced options (only in advanced mode)
  const [timezone, setTimezone] = useState('UTC');
  const [retryEnabled, setRetryEnabled] = useState(true);
  const [retryMaxRetries, setRetryMaxRetries] = useState(3);
  const [retryBackoff, setRetryBackoff] = useState('exponential');
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState('');
  const [deliveryOnSuccess, setDeliveryOnSuccess] = useState(false);
  const [deliveryOnFailure, setDeliveryOnFailure] = useState(true);
  const [deleteOnComplete, setDeleteOnComplete] = useState(false);
  const [maxRuns, setMaxRuns] = useState<number | null>(null);
  const [maxFailures, setMaxFailures] = useState<number | null>(null);

  // Validation
  const payloadValidation = useMemo(() => validateJson(payload), [payload]);

  // Fetch custom templates
  const { data: templatesData } = useQuery({
    queryKey: ['cron-templates'],
    queryFn: () => api.cron.listTemplates?.() || Promise.resolve({ templates: [] }),
    enabled: open,
  });
  const customTemplates = templatesData?.templates || [];

  // Filter templates
  const filteredTemplates = useMemo(() => {
    if (templateCategory === 'all') return BUILTIN_TEMPLATES;
    return BUILTIN_TEMPLATES.filter((t) => t.category === templateCategory);
  }, [templateCategory]);

  // Set defaults when job type changes
  useEffect(() => {
    if (jobType && !selectedTemplate) {
      const typeConfig = JOB_TYPES.find((t) => t.type === jobType);
      if (typeConfig) {
        setPayload(JSON.stringify(typeConfig.defaultPayload, null, 2));
      }
    }
  }, [jobType, selectedTemplate]);

  // Handle template selection
  const handleTemplateSelect = (template: TemplateSelection) => {
    // Toggle selection if already selected
    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(null);
      return;
    }

    setSelectedTemplate(template);
    setName(template.name);
    setDescription(template.description ?? '');
    setJobType(template.jobType);
    setPayload(JSON.stringify(template.payload, null, 2));
    if (template.suggestedCron) {
      setScheduleType('cron');
      setCronExpression(template.suggestedCron);
    }
    // Don't auto-jump - let user click Continue to proceed
  };

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () => {
      const parsedPayload = JSON.parse(payload);

      let runAt: string | undefined;
      if (scheduleType === 'oneshot' && runAtDate && runAtTime) {
        runAt = new Date(`${runAtDate}T${runAtTime}`).toISOString();
      }

      let eventTrigger: { type: string; config: Record<string, unknown> } | undefined;
      if (scheduleType === 'event') {
        try {
          eventTrigger = { type: eventType, config: JSON.parse(eventConfig) as Record<string, unknown> };
        } catch {
          eventTrigger = { type: eventType, config: {} };
        }
      }

      type DeliveryConfig = { channels: Array<{ type: string; target: string; onSuccess: boolean; onFailure: boolean }> };
      let delivery: DeliveryConfig | undefined;
      if (mode === 'advanced' && deliveryEnabled && deliveryChannel) {
        delivery = {
          channels: [
            {
              type: deliveryChannel.includes('@') ? 'email' : deliveryChannel.startsWith('http') ? 'webhook' : 'slack',
              target: deliveryChannel,
              onSuccess: deliveryOnSuccess,
              onFailure: deliveryOnFailure,
            },
          ],
        };
      }

      return api.cron.create({
        name,
        description: description || undefined,
        jobType: jobType!,
        cronExpression: scheduleType === 'cron' ? cronExpression : undefined,
        intervalMs: scheduleType === 'interval' ? intervalSeconds * 1000 : undefined,
        runAt,
        eventTrigger,
        payload: parsedPayload,
        timezone: mode === 'advanced' ? timezone : 'UTC',
        deleteOnComplete: scheduleType === 'oneshot' ? deleteOnComplete : undefined,
        retryPolicy: mode === 'advanced' ? { enabled: retryEnabled, maxRetries: retryMaxRetries, backoff: retryBackoff } : undefined,
        delivery,
        maxRuns: mode === 'advanced' ? maxRuns || undefined : undefined,
        maxFailures: mode === 'advanced' ? maxFailures || undefined : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['cron-stats'] });
      setOpen(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setStep('type');
    setMode('simple');
    setTemplateCategory('all');
    setName('');
    setDescription('');
    setJobType(null);
    setScheduleType(null);
    setCronExpression('*/5 * * * *');
    setIntervalSeconds(300);
    setRunAtDate('');
    setRunAtTime('');
    setEventType('webhook');
    setEventConfig('{}');
    setPayload('{}');
    setSelectedTemplate(null);
    setTimezone('UTC');
    setRetryEnabled(true);
    setRetryMaxRetries(3);
    setRetryBackoff('exponential');
    setDeliveryEnabled(false);
    setDeliveryChannel('');
    setDeliveryOnSuccess(false);
    setDeliveryOnFailure(true);
    setDeleteOnComplete(false);
    setMaxRuns(null);
    setMaxFailures(null);
  };

  // Step validation
  const canProceed = useMemo(() => {
    switch (step) {
      case 'type':
        return jobType !== null;
      case 'schedule':
        if (!scheduleType) return false;
        if (scheduleType === 'oneshot') return runAtDate && runAtTime;
        return true;
      case 'config':
        return name.trim().length > 0 && payloadValidation.valid;
      case 'review':
        return true;
      default:
        return false;
    }
  }, [step, jobType, scheduleType, runAtDate, runAtTime, name, payloadValidation]);

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setStep(STEPS[currentStepIndex + 1].id);
    }
  };

  const goBack = () => {
    if (currentStepIndex > 0) {
      setStep(STEPS[currentStepIndex - 1].id);
    }
  };

  // Schedule summary
  const scheduleSummary = useMemo(() => {
    switch (scheduleType) {
      case 'cron':
        return humanizeCron(cronExpression);
      case 'interval':
        return INTERVAL_PRESETS.find((p) => p.value === intervalSeconds)?.humanize || `Every ${intervalSeconds} seconds`;
      case 'oneshot':
        if (runAtDate && runAtTime) {
          return `Once at ${new Date(`${runAtDate}T${runAtTime}`).toLocaleString()}`;
        }
        return 'One-time (not scheduled)';
      case 'event':
        return `On ${eventType} event`;
      default:
        return 'Not configured';
    }
  }, [scheduleType, cronExpression, intervalSeconds, runAtDate, runAtTime, eventType]);

  // Get current job type config for guides
  const currentJobTypeConfig = JOB_TYPES.find((t) => t.type === jobType);

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow">
          <Plus className="h-4 w-4" />
          Create Job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl w-[90vw] max-h-[85vh] my-8 flex flex-col p-0 overflow-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Header */}
        <div className="border-b border-border/20 bg-linear-to-r from-primary/5 to-transparent">
          <DialogHeader className="px-6 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <span className="block">Create Scheduled Job</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {STEPS[currentStepIndex].description}
                  </span>
                </div>
              </DialogTitle>

              {/* Mode Toggle */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-muted">
                <button
                  onClick={() => setMode('simple')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    mode === 'simple' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Wand2 className="h-3 w-3" />
                  Simple
                </button>
                <button
                  onClick={() => setMode('advanced')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                    mode === 'advanced' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  Advanced
                </button>
              </div>
            </div>
          </DialogHeader>

          {/* Step Progress */}
          <div className="px-6 pb-4">
            <div className="flex items-center gap-2">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const isActive = s.id === step;
                const isComplete = i < currentStepIndex;
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <button
                      onClick={() => i <= currentStepIndex && setStep(s.id)}
                      disabled={i > currentStepIndex}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                        isActive && 'bg-primary text-primary-foreground shadow-md shadow-primary/30',
                        isComplete && 'bg-primary/20 text-primary hover:bg-primary/30',
                        !isActive && !isComplete && 'bg-muted text-muted-foreground',
                        i > currentStepIndex && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {isComplete ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                      <span className="hidden sm:inline">{s.label}</span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <ChevronRight className={cn('h-4 w-4', i < currentStepIndex ? 'text-primary' : 'text-muted-foreground/50')} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {/* Step 1: Type Selection */}
          {step === 'type' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              {/* Templates Section (Simple Mode) */}
              {mode === 'simple' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quick Start Templates</Label>
                    <Tooltip content="Pre-configured jobs for common tasks">
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </Tooltip>
                  </div>

                  {/* Category Filter */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {TEMPLATE_CATEGORIES.map((cat) => {
                      const Icon = cat.icon;
                      const isActive = templateCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setTemplateCategory(cat.id)}
                          className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all',
                            isActive
                              ? 'bg-foreground text-background shadow-sm'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Template Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {filteredTemplates.map((template) => {
                      const TemplateIcon = template.icon;
                      return (
                        <button
                          key={template.id}
                          onClick={() => handleTemplateSelect(template)}
                          className={cn(
                            'flex items-start gap-3 p-3 rounded-xl text-left transition-all hover:scale-[1.01]',
                            selectedTemplate?.id === template.id
                              ? 'bg-primary/5 ring-2 ring-primary/20'
                              : 'bg-muted/30 hover:bg-muted/50'
                          )}
                        >
                          <div className={cn(
                            'p-1.5 rounded-lg shrink-0',
                            selectedTemplate?.id === template.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                          )}>
                            <TemplateIcon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{template.name}</div>
                            <div className="text-[10px] text-muted-foreground line-clamp-2">{template.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {customTemplates.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <Label className="text-xs text-muted-foreground">Your Templates</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {customTemplates.slice(0, 4).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => handleTemplateSelect({
                              id: t.id,
                              name: t.name,
                              category: t.category,
                              description: t.description,
                              jobType: t.jobType,
                              payload: t.payloadTemplate,
                              suggestedCron: t.suggestedCron,
                            } satisfies TemplateSelection)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 hover:bg-muted/50 text-xs"
                          >
                            <FileCode className="h-3 w-3 text-primary" />
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <GuideBox type="tip">
                      Select a template to get started quickly, or choose a job type below for custom configuration.
                    </GuideBox>
                  </div>
                </div>
              )}

              {/* Job Types */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    {mode === 'simple' ? 'Or Choose Job Type' : 'Job Type'}
                  </Label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {JOB_TYPES.map((type) => {
                    const Icon = type.icon;
                    const isSelected = jobType === type.type;
                    return (
                      <button
                        key={type.type}
                        onClick={() => {
                          setJobType(type.type);
                          setSelectedTemplate(null);
                        }}
                        className={cn(
                          'relative overflow-hidden group p-4 rounded-2xl text-left transition-all duration-200',
                          isSelected
                            ? 'bg-primary/5 ring-2 ring-primary/20 scale-[1.02]'
                            : 'bg-muted/30 hover:bg-muted/50 hover:scale-[1.01]'
                        )}
                      >
                        <div className={cn('absolute inset-0 bg-linear-to-br opacity-0 transition-opacity', type.color, isSelected && 'opacity-100', 'group-hover:opacity-50')} />
                        <div className="relative">
                          <div className="flex items-center gap-3 mb-2">
                            <div className={cn('p-2 rounded-lg transition-colors', isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="flex-1">
                              <div className={cn('font-semibold', isSelected && 'text-primary')}>{type.label}</div>
                              <div className="text-xs text-muted-foreground">{type.description}</div>
                            </div>
                            {isSelected && <CheckCircle2 className="h-5 w-5 text-primary" />}
                          </div>
                          {mode === 'advanced' && (
                            <div className="flex flex-wrap gap-1 mt-3">
                              {type.examples.map((ex, i) => (
                                <span key={i} className="px-2 py-0.5 rounded-full bg-muted/80 text-[10px] text-muted-foreground">
                                  {ex}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Type Guide */}
                {currentJobTypeConfig && (
                  <div className="mt-4 space-y-2">
                    <GuideBox type="info">{currentJobTypeConfig.guide}</GuideBox>
                    {currentJobTypeConfig.warning && <GuideBox type="warning">{currentJobTypeConfig.warning}</GuideBox>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Schedule */}
          {step === 'schedule' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">When to Run?</Label>
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {SCHEDULE_TYPES.map((type) => {
                    const Icon = type.icon;
                    const isSelected = scheduleType === type.type;
                    return (
                      <button
                        key={type.type}
                        onClick={() => setScheduleType(type.type)}
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 rounded-xl transition-all',
                          isSelected ? 'bg-primary/5 ring-2 ring-primary/20' : 'bg-muted/30 hover:bg-muted/50'
                        )}
                      >
                        <Icon className={cn('h-6 w-6', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                        <span className={cn('text-xs font-medium', isSelected && 'text-primary')}>{type.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Schedule Config */}
              {scheduleType === 'cron' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <Label htmlFor="cron">Cron Expression</Label>
                    <Input
                      id="cron"
                      placeholder="*/5 * * * *"
                      value={cronExpression}
                      onChange={(e) => setCronExpression(e.target.value)}
                      className="mt-2 font-mono text-sm"
                    />
                    <div className="mt-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="flex items-center gap-2 text-sm text-primary">
                        <Play className="h-4 w-4" />
                        <span className="font-medium">{humanizeCron(cronExpression)}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Presets</Label>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {CRON_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => setCronExpression(preset.value)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                            cronExpression === preset.value ? 'bg-primary text-primary-foreground shadow-md' : 'bg-muted hover:bg-muted/80'
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <GuideBox type="info">
                    Cron format: <code className="font-mono bg-muted px-1 rounded">minute hour day month weekday</code>
                    <br />
                    Use <code className="font-mono bg-muted px-1 rounded">*</code> for any value, <code className="font-mono bg-muted px-1 rounded">*/N</code> for every N units.
                  </GuideBox>
                </div>
              )}

              {scheduleType === 'interval' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <Label htmlFor="interval">Interval (seconds)</Label>
                    <Input
                      id="interval"
                      type="number"
                      min={1}
                      value={intervalSeconds}
                      onChange={(e) => setIntervalSeconds(parseInt(e.target.value) || 60)}
                      className="mt-2"
                    />
                    <div className="mt-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="flex items-center gap-2 text-sm text-primary">
                        <Timer className="h-4 w-4" />
                        <span className="font-medium">
                          {INTERVAL_PRESETS.find((p) => p.value === intervalSeconds)?.humanize || `Every ${intervalSeconds} seconds`}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {INTERVAL_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => setIntervalSeconds(preset.value)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                          intervalSeconds === preset.value ? 'bg-primary text-primary-foreground shadow-md' : 'bg-muted hover:bg-muted/80'
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {scheduleType === 'oneshot' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <Label>Run At</Label>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div>
                        <Input type="date" value={runAtDate} onChange={(e) => setRunAtDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
                        <span className="text-xs text-muted-foreground">Date</span>
                      </div>
                      <div>
                        <Input type="time" value={runAtTime} onChange={(e) => setRunAtTime(e.target.value)} />
                        <span className="text-xs text-muted-foreground">Time</span>
                      </div>
                    </div>
                    {runAtDate && runAtTime && (
                      <div className="mt-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                        <div className="flex items-center gap-2 text-sm text-primary">
                          <Calendar className="h-4 w-4" />
                          <span className="font-medium">{new Date(`${runAtDate}T${runAtTime}`).toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={deleteOnComplete} onChange={(e) => setDeleteOnComplete(e.target.checked)} className="rounded" />
                    <span className="text-muted-foreground">Auto-delete after completion</span>
                  </label>
                  <GuideBox type="info">One-shot jobs run exactly once at the specified time and can optionally be deleted afterward.</GuideBox>
                </div>
              )}

              {scheduleType === 'event' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div>
                    <Label>Event Type</Label>
                    <div className="grid grid-cols-4 gap-2 mt-2">
                      {EVENT_TYPES.map((type) => (
                        <button
                          key={type.type}
                          onClick={() => setEventType(type.type)}
                          className={cn(
                            'flex flex-col items-center p-3 rounded-xl text-center transition-all',
                            eventType === type.type ? 'bg-primary/5 ring-2 ring-primary/20' : 'bg-muted/30 hover:bg-muted/50'
                          )}
                        >
                          <span className={cn('text-xs font-medium', eventType === type.type && 'text-primary')}>{type.label}</span>
                          <span className="text-[9px] text-muted-foreground mt-0.5">{type.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {mode === 'advanced' && (
                    <div>
                      <Label htmlFor="eventConfig">Event Config (JSON)</Label>
                      <Input id="eventConfig" placeholder='{"source": "webhook"}' value={eventConfig} onChange={(e) => setEventConfig(e.target.value)} className="mt-2 font-mono text-xs" />
                    </div>
                  )}
                  <GuideBox type="info">Event-triggered jobs run when specific events occur, like webhooks or file changes.</GuideBox>
                </div>
              )}

              {/* Timezone (Advanced) */}
              {mode === 'advanced' && scheduleType === 'cron' && (
                <div>
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" placeholder="UTC" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="mt-2" />
                  <p className="text-[10px] text-muted-foreground mt-1">Default: UTC. Use IANA timezone names (e.g., America/New_York).</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Configure */}
          {step === 'config' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              {/* Template Guide */}
              {selectedTemplate?.guide && (
                <GuideBox type="tip">
                  <strong>{selectedTemplate.name}:</strong> {selectedTemplate.guide}
                </GuideBox>
              )}
              {selectedTemplate?.warning && <GuideBox type="warning">{selectedTemplate.warning}</GuideBox>}

              {/* Name & Description */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">Job Name *</Label>
                  <Input id="name" placeholder="e.g., Sync GitHub Issues" value={name} onChange={(e) => setName(e.target.value)} className="mt-2 text-lg font-medium" />
                </div>
                <div>
                  <Label htmlFor="description" className="text-xs uppercase tracking-wider text-muted-foreground">Description</Label>
                  <Input id="description" placeholder="What this job does..." value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2" />
                </div>
              </div>

              {/* Payload */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="payload" className="text-xs uppercase tracking-wider text-muted-foreground">Payload (JSON)</Label>
                  {payloadValidation.valid ? (
                    <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Valid</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle className="h-3 w-3" /> {payloadValidation.error}</span>
                  )}
                </div>
                <textarea
                  id="payload"
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  className={cn(
                    'w-full p-4 rounded-xl bg-muted/40 font-mono text-sm resize-none h-32 transition-colors focus:outline-none focus:ring-1 focus:ring-primary/30',
                    !payloadValidation.valid && 'ring-1 ring-red-500'
                  )}
                  placeholder='{"url": "https://..."}'
                />
              </div>

              {/* Advanced Options */}
              {mode === 'advanced' && (
                <div className="p-4 rounded-xl bg-muted/30 space-y-4">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
                    <Settings2 className="h-3.5 w-3.5" />
                    Advanced Options
                  </div>

                  {/* Retry Policy */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RefreshCcw className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Retry on failure</span>
                      </div>
                      <input type="checkbox" checked={retryEnabled} onChange={(e) => setRetryEnabled(e.target.checked)} className="rounded" />
                    </div>
                    {retryEnabled && (
                      <div className="grid grid-cols-2 gap-3 pl-6">
                        <div>
                          <Label className="text-xs">Max Retries</Label>
                          <Input type="number" min={1} max={10} value={retryMaxRetries} onChange={(e) => setRetryMaxRetries(parseInt(e.target.value) || 3)} className="mt-1 h-8 text-xs" />
                        </div>
                        <div>
                          <Label className="text-xs">Backoff</Label>
                          <select value={retryBackoff} onChange={(e) => setRetryBackoff(e.target.value)} className="w-full mt-1 h-8 px-2 rounded-md border bg-background text-xs">
                            <option value="exponential">Exponential</option>
                            <option value="linear">Linear</option>
                            <option value="fixed">Fixed</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Notifications */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Send notifications</span>
                      </div>
                      <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} className="rounded" />
                    </div>
                    {deliveryEnabled && (
                      <div className="pl-6 space-y-2">
                        <Input placeholder="Slack channel, webhook URL, or email" value={deliveryChannel} onChange={(e) => setDeliveryChannel(e.target.value)} className="text-xs" />
                        <div className="flex items-center gap-4 text-xs">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={deliveryOnSuccess} onChange={(e) => setDeliveryOnSuccess(e.target.checked)} className="rounded" />
                            On success
                          </label>
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={deliveryOnFailure} onChange={(e) => setDeliveryOnFailure(e.target.checked)} className="rounded" />
                            On failure
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Limits */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs flex items-center gap-1">
                        Max Runs
                        <Tooltip content="Stop after N runs"><HelpCircle className="h-3 w-3" /></Tooltip>
                      </Label>
                      <Input type="number" min={1} placeholder="Unlimited" value={maxRuns || ''} onChange={(e) => setMaxRuns(e.target.value ? parseInt(e.target.value) : null)} className="mt-1 h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs flex items-center gap-1">
                        Max Failures
                        <Tooltip content="Pause after N consecutive failures"><HelpCircle className="h-3 w-3" /></Tooltip>
                      </Label>
                      <Input type="number" min={1} placeholder="Unlimited" value={maxFailures || ''} onChange={(e) => setMaxFailures(e.target.value ? parseInt(e.target.value) : null)} className="mt-1 h-8 text-xs" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Review */}
          {step === 'review' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-linear-to-br from-primary/20 to-primary/5 mb-3">
                  <CheckCircle2 className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Ready to Create</h3>
                <p className="text-sm text-muted-foreground">Review your job configuration</p>
              </div>

              {/* Summary Card */}
              <div className="p-5 rounded-2xl bg-linear-to-br from-muted/50 to-transparent space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Job Name</div>
                    <div className="text-lg font-semibold mt-1">{name || 'Untitled Job'}</div>
                    {description && <div className="text-sm text-muted-foreground mt-0.5">{description}</div>}
                  </div>
                  {jobType && (
                    <div className={cn('p-2 rounded-lg', jobType === 'http' && 'bg-blue-500/20', jobType === 'tool' && 'bg-indigo-500/20', jobType === 'script' && 'bg-green-500/20', jobType === 'message' && 'bg-orange-500/20')}>
                      {JOB_TYPES.find((t) => t.type === jobType)?.icon && (() => { const Icon = JOB_TYPES.find((t) => t.type === jobType)!.icon; return <Icon className="h-5 w-5" />; })()}
                    </div>
                  )}
                </div>

                <hr className="border-border/50" />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Type</div>
                    <div className="text-sm font-medium mt-1">{JOB_TYPES.find((t) => t.type === jobType)?.label}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Schedule</div>
                    <div className="text-sm font-medium mt-1">{scheduleSummary}</div>
                  </div>
                </div>

                <hr className="border-border/50" />

                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Payload</div>
                  <pre className="p-3 rounded-lg bg-muted/50 text-xs font-mono overflow-x-auto max-h-24">{payload}</pre>
                </div>

                {mode === 'advanced' && (retryEnabled || deliveryEnabled || maxRuns || maxFailures) && (
                  <>
                    <hr className="border-border/50" />
                    <div className="flex flex-wrap gap-2">
                      {retryEnabled && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-xs">
                          <RefreshCcw className="h-3 w-3" />
                          {retryMaxRetries}x {retryBackoff} retries
                        </span>
                      )}
                      {deliveryEnabled && deliveryChannel && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-xs">
                          <Bell className="h-3 w-3" />
                          Notify: {deliveryChannel.slice(0, 15)}...
                        </span>
                      )}
                      {maxRuns && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-xs">
                          <Shield className="h-3 w-3" />
                          Max {maxRuns} runs
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Warnings */}
              {jobType === 'script' && (
                <GuideBox type="warning">
                  <strong>Security Notice:</strong> Script jobs execute shell commands with server permissions. Ensure your command is safe before creating.
                </GuideBox>
              )}

              {/* Error */}
              {createMutation.isError && (
                <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <span>{createMutation.error instanceof Error ? createMutation.error.message : 'Failed to create job'}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/20 p-4 flex items-center justify-between bg-muted/30">
          <Button variant="ghost" onClick={currentStepIndex === 0 ? () => setOpen(false) : goBack} className="gap-2">
            <ChevronLeft className="h-4 w-4" />
            {currentStepIndex === 0 ? 'Cancel' : 'Back'}
          </Button>

          {step === 'review' ? (
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="gap-2 min-w-35 shadow-lg shadow-primary/20">
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Create Job
                </>
              )}
            </Button>
          ) : (
            <Button onClick={goNext} disabled={!canProceed} className="gap-2">
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CreateJobModal;
