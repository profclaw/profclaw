import { useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ProjectWithRelations, Sprint } from '@/core/types';
import { api } from '@/core/api/client';
import { SprintBoard } from '../components/SprintBoard';

export function ProjectBoard() {
  const { id } = useParams<{ id: string }>();
  const { project } = useOutletContext<{ project: ProjectWithRelations }>();
  const [selectedSprintId, setSelectedSprintId] = useState<string | undefined>();

  const { data: sprintsData } = useQuery({
    queryKey: ['sprints', id],
    queryFn: () => api.projects.sprints.list(id!),
    enabled: !!id,
  });

  const sprints = sprintsData?.sprints || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 min-w-0">
      {/* Sprint Selection Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 p-1 bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl border border-black/5 dark:border-white/10 backdrop-blur-xl shadow-soft">
            <div className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">
              Active Sprint
            </div>
            <select
              value={selectedSprintId || ''}
              onChange={(e) => setSelectedSprintId(e.target.value || undefined)}
              className="bg-primary/5 border-none focus:ring-0 text-sm font-bold px-4 py-1.5 rounded-xl cursor-pointer appearance-none hover:bg-primary/10 transition-all text-primary min-w-[160px]"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='3' d='M19 9l-7 7-7-7' /%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '14px' }}
            >
              <option value="" className="bg-background">All Project Tickets</option>
              {sprints.map((sprint: Sprint) => (
                <option key={sprint.id} value={sprint.id} className="bg-background">
                  {sprint.name} {sprint.status === 'active' ? '●' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Stats Mini-Bar */}
          <div className="hidden md:flex items-center gap-4 px-5 py-2.5 bg-black/[0.03] dark:bg-white/[0.03] rounded-2xl border border-black/5 dark:border-white/10 backdrop-blur-xl shadow-soft text-[11px] font-bold uppercase tracking-wider">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]" />
              <span className="text-foreground">{project?.stats?.inProgressTickets || 0}</span>
              <span className="text-muted-foreground/60">Doing</span>
            </div>
            <div className="w-px h-4 bg-black/10 dark:bg-white/10" />
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]" />
              <span className="text-foreground">{project?.stats?.doneTickets || 0}</span>
              <span className="text-muted-foreground/60">Done</span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative">
        {/* The Board itself */}
        <SprintBoard projectId={id!} sprintId={selectedSprintId} />
      </div>
    </div>
  );
}
