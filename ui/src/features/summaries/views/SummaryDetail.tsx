import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ChevronRight, Copy, Check, FileCode,
  Lightbulb, AlertTriangle, Clock, Bot, Cpu, Link2, ExternalLink
} from 'lucide-react';
import { useState } from 'react';
import { api } from '@/core/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function SummaryDetail() {
  const { id } = useParams<{ id: string }>();
  const [copied, setCopied] = useState(false);

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['summaries', id],
    queryFn: () => api.summaries.get(id!),
    enabled: !!id,
  });

  const copyToClipboard = async () => {
    if (!summary) return;

    const content = `# ${summary.title}

## What Changed
${summary.whatChanged}

${summary.whyChanged ? `## Why Changed\n${summary.whyChanged}\n` : ''}
${summary.howChanged ? `## How Changed\n${summary.howChanged}\n` : ''}
${summary.filesChanged.length > 0 ? `## Files Changed\n${summary.filesChanged.map(f => typeof f === 'string' ? `- ${f}` : `- ${f.path}`).join('\n')}\n` : ''}
${summary.decisions.length > 0 ? `## Key Decisions\n${summary.decisions.map(d => typeof d === 'string' ? `- ${d}` : `- ${d.description}`).join('\n')}\n` : ''}
${summary.blockers.length > 0 ? `## Blockers\n${summary.blockers.map(b => typeof b === 'string' ? `- ${b}` : `- ${b.description}`).join('\n')}\n` : ''}
---
Agent: ${summary.agent}${summary.model ? ` | Model: ${summary.model}` : ''}
Created: ${new Date(summary.createdAt).toLocaleString()}
`;

    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success('Summary copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full skeleton-glass" />
          <Skeleton className="h-4 w-32 skeleton-glass" />
        </div>
        <Skeleton className="h-48 rounded-[24px] skeleton-glass" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64 rounded-[24px] skeleton-glass" />
          <Skeleton className="h-64 rounded-[24px] skeleton-glass" />
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="max-w-5xl mx-auto glass rounded-[24px] p-20 text-center">
        <FileCode className="h-16 w-16 mx-auto text-red-500 mb-4 opacity-20" />
        <h3 className="text-xl font-bold">Summary Not Found</h3>
        <p className="text-muted-foreground mb-6">The summary you're looking for doesn't exist.</p>
        <Link to="/summaries">
          <Button variant="outline" className="rounded-xl px-6">Back to Summaries</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Breadcrumbs & Navigation */}
      <nav className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/summaries" className="p-2 hover:bg-white/5 rounded-full transition-colors group">
            <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          </Link>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Link to="/summaries" className="hover:text-foreground transition-colors">Summaries</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground truncate max-w-[200px]">{summary.title}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={copyToClipboard}
          className="rounded-xl glass border-white/5 hover:bg-white/5"
        >
          {copied ? <Check className="h-4 w-4 mr-2 text-green-400" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </nav>

      {/* Main Header Card */}
      <Card className="glass rounded-[32px] overflow-hidden border-white/5 relative">
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full blur-[100px] opacity-10 bg-indigo-500" />
        <CardContent className="p-8">
          <div className="flex items-start justify-between mb-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3 mb-2">
                <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                  <Bot className="h-3 w-3 mr-1" />
                  {summary.agent}
                </Badge>
                {summary.model && (
                  <Badge variant="outline" className="border-white/10">
                    <Cpu className="h-3 w-3 mr-1" />
                    {summary.model}
                  </Badge>
                )}
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight leading-tight">{summary.title}</h1>
            </div>
          </div>

          {/* Meta Info */}
          <div className="flex flex-wrap gap-4 pt-6 border-t border-white/5">
            <MetaItem icon={Clock} label="Created" value={new Date(summary.createdAt).toLocaleString()} />
            {summary.taskId && (
              <Link to={`/tasks/${summary.taskId}`} className="hover:opacity-80 transition-opacity">
                <MetaItem icon={Link2} label="Task" value={`#${summary.taskId.split('-')[0]}`} isLink />
              </Link>
            )}
            <MetaItem icon={FileCode} label="Files" value={`${summary.filesChanged.length} changed`} />
          </div>
        </CardContent>
      </Card>

      {/* What Changed - Primary Section */}
      <Card className="glass rounded-[28px] border-white/5">
        <CardHeader className="border-b border-white/5 bg-white/[0.02]">
          <CardTitle className="flex items-center gap-3 text-lg font-bold">
            <div className="h-8 w-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <FileCode className="h-4 w-4 text-blue-400" />
            </div>
            What Changed
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{summary.whatChanged}</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Why Changed */}
        {summary.whyChanged && (
          <Card className="glass rounded-[28px] border-white/5">
            <CardHeader className="border-b border-white/5 bg-white/[0.02]">
              <CardTitle className="flex items-center gap-3 text-lg font-bold">
                <div className="h-8 w-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Lightbulb className="h-4 w-4 text-amber-400" />
                </div>
                Why Changed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{summary.whyChanged}</p>
            </CardContent>
          </Card>
        )}

        {/* How Changed */}
        {summary.howChanged && (
          <Card className="glass rounded-[28px] border-white/5">
            <CardHeader className="border-b border-white/5 bg-white/[0.02]">
              <CardTitle className="flex items-center gap-3 text-lg font-bold">
                <div className="h-8 w-8 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <Cpu className="h-4 w-4 text-green-400" />
                </div>
                How Changed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{summary.howChanged}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Files Changed */}
      {summary.filesChanged.length > 0 && (
        <Card className="glass rounded-[28px] border-white/5">
          <CardHeader className="border-b border-white/5 bg-white/[0.02]">
            <CardTitle className="flex items-center gap-3 text-lg font-bold">
              <div className="h-8 w-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                <FileCode className="h-4 w-4 text-cyan-400" />
              </div>
              Files Changed
              <Badge variant="secondary" className="ml-auto">{summary.filesChanged.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-wrap gap-2">
              {summary.filesChanged.map((file, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="font-mono text-xs px-3 py-1.5 bg-white/[0.02] border-white/10 hover:bg-white/5 transition-colors"
                >
                  {typeof file === 'string' ? file : file.path}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Key Decisions */}
        {summary.decisions.length > 0 && (
          <Card className="glass rounded-[28px] border-white/5">
            <CardHeader className="border-b border-white/5 bg-white/[0.02]">
              <CardTitle className="flex items-center gap-3 text-lg font-bold">
                <div className="h-8 w-8 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                  <Lightbulb className="h-4 w-4 text-indigo-400" />
                </div>
                Key Decisions
                <Badge variant="secondary" className="ml-auto">{summary.decisions.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <ul className="space-y-3">
                {summary.decisions.map((decision, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <div className="h-5 w-5 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-indigo-400">{idx + 1}</span>
                    </div>
                    <span className="text-muted-foreground text-sm leading-relaxed">{typeof decision === 'string' ? decision : decision.description}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Blockers */}
        {summary.blockers.length > 0 && (
          <Card className="glass rounded-[28px] border-white/5 border-red-500/10">
            <CardHeader className="border-b border-white/5 bg-red-500/[0.02]">
              <CardTitle className="flex items-center gap-3 text-lg font-bold">
                <div className="h-8 w-8 rounded-xl bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                </div>
                <span className="text-red-400">Blockers</span>
                <Badge className="ml-auto bg-red-500/10 text-red-400 border-red-500/20">{summary.blockers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <ul className="space-y-3">
                {summary.blockers.map((blocker, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <span className="text-red-300 text-sm leading-relaxed">{typeof blocker === 'string' ? blocker : blocker.description}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Related Task Link */}
      {summary.taskId && (
        <Card className="glass rounded-[20px] border-white/5 hover-lift transition-liquid">
          <Link to={`/tasks/${summary.taskId}`} className="block p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <ExternalLink className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Related Task</p>
                  <p className="font-semibold">View Task #{summary.taskId.split('-')[0]}</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </Link>
        </Card>
      )}
    </div>
  );
}

function MetaItem({ icon: Icon, label, value, isLink }: { icon: any; label: string; value: string; isLink?: boolean }) {
  return (
    <div className="flex items-center gap-2 group/meta">
      <div className="h-8 w-8 rounded-lg glass-heavy flex items-center justify-center border-white/5">
        <Icon className={cn("h-3.5 w-3.5 text-muted-foreground", isLink && "group-hover/meta:text-blue-400 transition-colors")} />
      </div>
      <div className="flex flex-col">
        <span className="premium-label">{label}</span>
        <span className={cn("text-[11px] font-bold truncate max-w-[120px]", isLink && "text-blue-400")}>{value}</span>
      </div>
    </div>
  );
}
