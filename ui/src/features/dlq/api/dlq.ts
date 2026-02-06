import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api/client';

export function useDLQTasks() {
  return useQuery({
    queryKey: ['dlq'],
    queryFn: () => api.dlq.list(),
    refetchInterval: 10_000, // Poll every 10 seconds
  });
}

export function useRetryDLQTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.dlq.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dlq'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useRemoveDLQTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.dlq.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dlq'] });
    },
  });
}
