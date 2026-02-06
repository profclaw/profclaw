import { useQuery, useMutation } from '@tanstack/react-query';
import type { Task } from '../types';

const API_BASE = 'http://localhost:3000';

export function useTasks(params?: {
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.append('status', params.status);
      if (params?.limit) searchParams.append('limit', params.limit.toString());
      if (params?.offset) searchParams.append('offset', params.offset.toString());

      const url = `${API_BASE}/api/tasks?${searchParams}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.statusText}`);
      }
      
      return response.json() as Promise<Task[]>;
    },
  });
}

export function useCreateTask() {
  return useMutation({
    mutationFn: async (task: Partial<Task>) => {
      const response = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }

      return response.json() as Promise<Task>;
    },
  });
}

export function useTaskById(id: string) {
  return useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => {
      const response = await fetch(`${API_BASE}/api/tasks/${id}`);
      if (!response.ok) {
        throw new Error('Task not found');
      }
      const data = await response.json();
      return data.task as Task;
    },
    enabled: !!id,
  });
}
