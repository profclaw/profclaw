import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/core/api/client';
import { BacklogTable } from '../components/BacklogTable';

export function ProjectBacklog() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: sprintsData } = useQuery({
    queryKey: ['sprints', id],
    queryFn: () => api.projects.sprints.list(id!),
    enabled: !!id,
  });

  const sprints = sprintsData?.sprints || [];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <BacklogTable
        projectId={id!}
        sprints={sprints}
        onCreateTicket={() => navigate(`/tickets?projectId=${id}&create=true`)}
      />
    </div>
  );
}
