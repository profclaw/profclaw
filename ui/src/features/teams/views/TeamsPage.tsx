/**
 * Teams Page
 *
 * Create and manage teams with budget tracking, member management,
 * and smart routing status per team.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Users, Plus, ChevronDown, ChevronRight, DollarSign,
  Zap, UserPlus, Loader2, Crown, User,
} from 'lucide-react';

interface Team {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  monthlyBudgetUsd: number;
  smartRoutingEnabled: boolean;
}

interface TeamMember {
  userId: string;
  role: string;
  totalSpentUsd: number;
  requestCount: number;
}

interface TeamUsage {
  totalSpentUsd: number;
  budgetUsd: number;
  budgetUsedPercent: number;
  memberBreakdown: Array<{ userId: string; spentUsd: number; requestCount: number }>;
  alertsTriggered: number[];
}

function BudgetBar({ percent }: { percent: number }) {
  const color =
    percent >= 90
      ? 'bg-red-500'
      : percent >= 70
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Budget used</span>
        <span className={percent >= 90 ? 'text-red-500 font-semibold' : percent >= 70 ? 'text-amber-500 font-semibold' : ''}>{percent.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  const [expanded, setExpanded] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const queryClient = useQueryClient();

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['teams', team.id, 'members'],
    queryFn: () => api.teams.members(team.id),
    enabled: expanded,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['teams', team.id, 'usage'],
    queryFn: () => api.teams.usage(team.id),
    enabled: expanded,
  });

  const inviteMutation = useMutation({
    mutationFn: () => api.teams.invite(team.id, inviteEmail, inviteRole, 'owner'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', team.id] });
      setInviteEmail('');
    },
  });

  const members: TeamMember[] = membersData?.members ?? [];
  const usage: TeamUsage | null = usageData?.usage ?? null;

  const budgetPercent = usage
    ? usage.budgetUsedPercent
    : team.monthlyBudgetUsd > 0
    ? 0
    : 0;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader
        className="cursor-pointer select-none pb-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">{team.name}</CardTitle>
              {team.smartRoutingEnabled && (
                <Badge variant="outline" className="gap-1 text-xs text-violet-600 border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800 dark:text-violet-400">
                  <Zap className="h-3 w-3" />
                  Smart Routing
                </Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              {team.memberCount} member{team.memberCount !== 1 ? 's' : ''} - @{team.slug}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-sm font-medium flex items-center gap-1 justify-end">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                {team.monthlyBudgetUsd > 0 ? `${team.monthlyBudgetUsd}/mo` : 'No budget'}
              </div>
            </div>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 border-t border-border/50 pt-4">
          {/* Budget Usage */}
          {(usageLoading || usage) && (
            <div>
              {usageLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading usage...
                </div>
              ) : usage ? (
                <div className="space-y-2">
                  <BudgetBar percent={budgetPercent} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>${usage.totalSpentUsd.toFixed(2)} spent</span>
                    <span>${usage.budgetUsd.toFixed(2)} budget</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Members */}
          <div>
            <div className="text-sm font-medium mb-2 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Members
              {membersLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            {members.length === 0 && !membersLoading ? (
              <p className="text-xs text-muted-foreground">No members yet</p>
            ) : (
              <div className="space-y-1.5">
                {members.map((member) => (
                  <div key={member.userId} className="flex items-center gap-2 rounded-md p-2 bg-muted/30 text-sm">
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                      {member.role === 'owner' ? (
                        <Crown className="h-3 w-3 text-amber-500" />
                      ) : (
                        <User className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                    <span className="flex-1 truncate font-mono text-xs">{member.userId}</span>
                    <Badge variant="outline" className="text-xs">{member.role}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">${member.totalSpentUsd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invite Member */}
          <div className="space-y-2 pt-2 border-t border-border/30">
            <div className="text-sm font-medium flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Invite Member
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="email@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="text-sm h-8"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button
                size="sm"
                onClick={() => inviteMutation.mutate()}
                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                className="h-8 shrink-0"
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <UserPlus className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function TeamsPage() {
  const queryClient = useQueryClient();
  const [createName, setCreateName] = useState('');
  const [createBudget, setCreateBudget] = useState('');

  // Use a placeholder user ID - in real usage this comes from auth context
  const OWNER_ID = 'owner';

  const { data: teamsData, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', 'list'],
    queryFn: () => api.teams.list(OWNER_ID),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.teams.create({
        name: createName,
        ownerId: OWNER_ID,
        monthlyBudget: createBudget ? parseFloat(createBudget) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setCreateName('');
      setCreateBudget('');
    },
  });

  const teams: Team[] = teamsData?.teams ?? [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Teams
          </h1>
          <p className="text-muted-foreground mt-1">
            {teamsLoading ? 'Loading...' : `${teams.length} team${teams.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Create Team */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Create Team
          </CardTitle>
          <CardDescription>Set up a new team with optional monthly budget</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                placeholder="Engineering"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="sm:w-48 space-y-1.5">
              <Label htmlFor="team-budget">Monthly Budget (USD)</Label>
              <Input
                id="team-budget"
                type="number"
                min="0"
                step="0.01"
                placeholder="100.00"
                value={createBudget}
                onChange={(e) => setCreateBudget(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!createName.trim() || createMutation.isPending}
                className="gap-2 w-full sm:w-auto"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Teams List */}
      {teamsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading teams...
        </div>
      ) : teams.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No teams yet.</p>
          <p className="text-xs mt-1">Create your first team above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      )}
    </div>
  );
}
