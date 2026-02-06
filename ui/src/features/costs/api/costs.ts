import { useQuery } from '@tanstack/react-query';
import { api } from '@/core/api/client';

export function useCostAnalytics() {
  return useQuery({
    queryKey: ['costs', 'analytics'],
    queryFn: () => api.costs.analytics(),
  });
}

export function useCostBudget() {
  return useQuery({
    queryKey: ['costs', 'budget'],
    queryFn: () => api.costs.budget(),
  });
}

export function useCostSummary() {
  return useQuery({
    queryKey: ['costs', 'summary'],
    queryFn: () => api.costs.summary(),
  });
}
