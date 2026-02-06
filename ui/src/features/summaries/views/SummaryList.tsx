import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Search, FileText, ChevronRight, Bot, Cpu } from 'lucide-react';
import { api } from '@/core/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function SummaryList() {
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['summaries', { agent: agentFilter === 'all' ? undefined : agentFilter, limit: 50 }],
    queryFn: () =>
      api.summaries.list({
        agent: agentFilter === 'all' ? undefined : agentFilter,
        limit: 50,
      }),
  });

  const summaries = data?.summaries ?? [];

  // Get unique agents for filter
  const agents = Array.from(new Set(summaries.map((s) => s.agent)));

  // Client-side search filter
  const filteredSummaries = summaries.filter((summary) =>
    searchQuery
      ? summary.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        summary.whatChanged.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-destructive">
            Error loading summaries: {(error as Error).message}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>AI Summaries</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search summaries..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            {agents.length > 0 && (
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent} value={agent}>
                      {agent}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Summary Cards */}
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSummaries.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No summaries found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSummaries.map((summary) => (
                <Link
                  key={summary.id}
                  to={`/summaries/${summary.id}`}
                  className="block"
                >
                  <Card className="glass rounded-[16px] hover-lift transition-liquid group border-white/5">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                              {summary.title}
                            </h3>
                            <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                              <Bot className="h-3 w-3 mr-1" />
                              {summary.agent}
                            </Badge>
                            {summary.model && (
                              <Badge variant="outline" className="text-xs border-white/10">
                                <Cpu className="h-3 w-3 mr-1" />
                                {summary.model}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {summary.whatChanged}
                          </p>
                          <div className="flex items-center gap-2 mt-3">
                            {summary.filesChanged?.length > 0 && (
                              <Badge variant="outline" className="text-[10px] border-white/10">
                                <FileText className="h-3 w-3 mr-1" />
                                {summary.filesChanged.length} files
                              </Badge>
                            )}
                            {summary.blockers?.length > 0 && (
                              <Badge className="text-[10px] bg-red-500/10 text-red-400 border-red-500/20">
                                {summary.blockers.length} blockers
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(summary.createdAt).toLocaleDateString()}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
