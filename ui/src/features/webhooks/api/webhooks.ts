import { useQuery } from '@tanstack/react-query';
import { api } from '@/core/api/client';

export function useIntegrationsStatus() {
  return useQuery({
    queryKey: ['integrations', 'status'],
    queryFn: () => api.integrations.status(),
    staleTime: 60_000, // 1 minute
  });
}
